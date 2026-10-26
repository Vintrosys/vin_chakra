"""
WhatsApp (AskEva) chatbot -> HD Ticket intake.

AskEva hosts the "Chakra" chatbot. WhatsApp Flow form submissions are
delivered to this endpoint (`receive_form`). Forms arrive as separate
posts correlated by the sender's WhatsApp number (`userNumber`):

  Existing Customer  -> Customer Name, Mobile Number
  New Customer       -> Name, Phone, Address
  Ticket Machine     -> Ticket Type, Machine Brand, Purchase Year,
                        Machine Problem, Purchase At SCSS,
                        Secondary Phone No, Subject

Business Logic:
1. Existing Customer Journey:
   - Existing Customer form arrives -> Stored as Pending.
   - Ticket Machine form arrives -> Correlated by userNumber.
   - Resolves/maps existing Customer in ERPNext (by mobile number / phone / name).
   - Creates HD Ticket with status strictly set to "Not Specified".
2. New Customer Journey:
   - New Customer form arrives -> Stored as Pending.
   - Ticket Machine form arrives -> Correlated by userNumber.
   - Creates new Customer, Address (with PIN and State), and Contact in ERPNext.
   - Creates HD Ticket with status strictly set to "Not Specified".
3. Unified Flow Fallback:
   - If customer and machine details arrive in a single form payload,
     resolves/creates Customer and creates HD Ticket with status "Not Specified".

Security: Guest-accessible endpoint authenticated via shared secret token:
  POST /api/method/vin_chakra.whatsapp_api.receive_form?token=<SECRET>
"""

import hashlib
import hmac
import json
import re
import time
from typing import Optional

import requests
import frappe
from frappe import _
from frappe.rate_limiter import rate_limit
from frappe.utils import escape_html, formatdate, fmt_money, get_url, today

# How long a signed invoice-PDF download link stays valid (seconds). 30 days.
PDF_LINK_TTL = 30 * 24 * 60 * 60

FORM_EXISTING = "Existing Customer"
FORM_NEW = "New Customer"
FORM_MACHINE = "Ticket Machine"
TICKET_STATUS = "Not Specified"

# Metadata keys that are not form input fields
_META_KEYS = {
	"form_name", "formname", "form", "username", "user_number", "usernumber",
	"userNumber", "to", "from", "wa_id", "waid", "token", "cmd", "fields",
	"data", "responses", "message_id", "id", "responsedtime", "responsed_time",
}


def set_webhook_token(token: str):
	"""Utility to configure the AskEva webhook token from bench execute or CLI."""
	settings = frappe.get_single("AskEva Settings")
	settings.enabled = 1
	settings.webhook_token = token
	settings.save(ignore_permissions=True)
	frappe.db.commit()
	print(f"AskEva webhook token updated successfully: {settings.get_password('webhook_token')[:8]}...")


# ---------------------------------------------------------------------------
# String & Normalization Helpers
# ---------------------------------------------------------------------------
def _norm(s) -> str:
	"""Normalise a key for case/space/underscore-insensitive lookup."""
	return re.sub(r"[^a-z0-9]", "", str(s or "").lower())


def _get(nmap: dict, *names):
	"""First non-empty value in nmap matching any of the given field names or semantic aliases."""
	# 1. Exact normalized match
	for n in names:
		v = nmap.get(_norm(n))
		if v is not None and str(v).strip() != "":
			return str(v).strip()
	# 2. Substring match for compound names (e.g. 'customername' in 'companycustomername')
	for n in names:
		norm_n = _norm(n)
		if len(norm_n) < 5 or norm_n in ("name", "phone", "type", "year", "data", "form", "item"):
			continue
		for k, v in nmap.items():
			if norm_n in k and v is not None and str(v).strip() != "":
				return str(v).strip()
	return ""


def _digits(value) -> str:
	"""Extract only numeric digits from a string."""
	return "".join(ch for ch in str(value or "") if ch.isdigit())


def _clean_name(value) -> str:
	"""Strip HTML tags and control chars from free-text names/subjects.

	Defense in depth: these values are customer-supplied and later rendered
	into HTML attributes by the technician portal, so markup must not survive.
	"""
	s = re.sub(r"<[^>]*>", "", str(value or ""))
	s = re.sub(r"[\r\n\t]+", " ", s).strip()
	return s


def _last10(value) -> str:
	"""Return the last 10 digits of a phone number."""
	d = _digits(value)
	return d[-10:] if len(d) >= 10 else d


def _safe_header(key: str, default=None) -> Optional[str]:
	"""Safely fetch a request header without throwing RuntimeError if unbound."""
	try:
		if getattr(frappe, "request", None) and hasattr(frappe.request, "headers"):
			return frappe.request.headers.get(key, default)
	except Exception:
		pass
	return default


def _parse_request() -> dict:
	"""Merge URL query params, JSON body, and form dict into one dictionary."""
	merged = {}
	try:
		if getattr(frappe, "request", None) and hasattr(frappe.request, "args"):
			for k, v in frappe.request.args.items():
				merged[k] = v
	except Exception:
		pass
	raw = None
	try:
		if getattr(frappe, "request", None):
			raw = frappe.request.get_data(as_text=True)
	except Exception:
		raw = None
	if raw:
		try:
			body = json.loads(raw)
			if isinstance(body, dict):
				merged.update(body)
		except Exception:
			pass
	for k, v in dict(frappe.form_dict or {}).items():
		merged.setdefault(k, v)
	return merged


def _extract_fields(merged: dict) -> dict:
	"""Pull form fields out of the request (nested in fields/data/responses or top-level)."""
	for key in ("fields", "data", "responses"):
		candidate = merged.get(key)
		if isinstance(candidate, str):
			try:
				candidate = json.loads(candidate)
			except Exception:
				candidate = None
		if isinstance(candidate, dict):
			return candidate
	return {k: v for k, v in merged.items() if _norm(k) not in {_norm(m) for m in _META_KEYS}}


def _detect_form_type(form_name: str, nmap: dict) -> str:
	"""Identify whether the incoming form is Existing Customer, New Customer, or Ticket Machine."""
	name = (form_name or "").strip().lower()
	if name:
		if any(w in name for w in ("ticket", "machine", "problem", "issue", "service")):
			return FORM_MACHINE
		if "new" in name:
			return FORM_NEW
		if "exist" in name:
			return FORM_EXISTING

	# Fallback to field signatures
	if any(_get(nmap, alias) for alias in ("Machine Problem", "Machine Problem / Issue", "Problem", "Issue", "Machine Brand", "Brand", "Machine Type", "Model")):
		return FORM_MACHINE
	if any(_get(nmap, alias) for alias in ("Address", "Company Address", "Customer Address", "Location")):
		return FORM_NEW
	if any(_get(nmap, alias) for alias in ("Customer Name", "Company Name", "Mobile Number", "Phone Number")):
		return FORM_EXISTING
	return "Unknown"


def _default_customer_group() -> str:
	return (
		frappe.db.get_default("customer_group")
		or frappe.db.get_value("Customer Group", {"is_group": 0}, "name")
		or "All Customer Groups"
	)


def _default_territory() -> str:
	return (
		frappe.db.get_default("territory")
		or frappe.db.get_value("Territory", {"is_group": 0}, "name")
		or "All Territories"
	)


def _ensure_ticket_status() -> str:
	"""Ensure 'Not Specified' exists in HD Ticket Status, returning it."""
	if frappe.db.exists("HD Ticket Status", TICKET_STATUS):
		return TICKET_STATUS
	try:
		st = frappe.get_doc({
			"doctype": "HD Ticket Status",
			"name": TICKET_STATUS,
			"category": "Open",
			"enabled": 1,
			"color": "Gray",
			"label_agent": TICKET_STATUS,
			"label_customer": TICKET_STATUS,
		})
		st.insert(ignore_permissions=True)
		return st.name
	except Exception:
		for fallback in ("Pending", "Open"):
			if frappe.db.exists("HD Ticket Status", fallback):
				return fallback
		first = frappe.db.get_value("HD Ticket Status", {"enabled": 1}, "name")
		return first or "Open"


# ---------------------------------------------------------------------------
# Brand, Item & Machine Problem Lookups
# ---------------------------------------------------------------------------
def _get_or_create_brand(brand_text: str) -> Optional[str]:
	brand_text = (brand_text or "").strip()
	if not brand_text:
		return None
	existing = frappe.db.get_value("Brand", {"brand": brand_text}, "name")
	if existing:
		return existing
	existing = frappe.db.get_value("Brand", {"brand": ["like", brand_text]}, "name")
	if existing:
		return existing
	try:
		doc = frappe.get_doc({"doctype": "Brand", "brand": brand_text})
		doc.insert(ignore_permissions=True)
		return doc.name
	except Exception:
		frappe.log_error(frappe.get_traceback(), "WhatsApp: Brand create failed")
		return None


def _match_machine_problem(problem_text: str) -> Optional[str]:
	"""Match an existing Machine Problem in ERPNext or return None."""
	problem_text = (problem_text or "").strip()
	if not problem_text:
		return None
	# 1. Exact name match
	name = frappe.db.get_value("Machine Problem", problem_text, "name")
	if name:
		return name
	# 2. Case-insensitive exact / LIKE match
	name = frappe.db.get_value("Machine Problem", {"machine_problem": ["like", problem_text]}, "name")
	if name:
		return name
	# 3. Fuzzy keyword checks
	prob_lower = problem_text.lower()
	if "not work" in prob_lower or "not run" in prob_lower:
		return frappe.db.get_value("Machine Problem", "M/c Not Running", "name") or "Others"
	if "break" in prob_lower or "cut" in prob_lower:
		return frappe.db.get_value("Machine Problem", "Thread Breakage", "name") or "Others"
	return frappe.db.get_value("Machine Problem", "Others", "name")


def _match_or_default_item(brand_name: str = None, machine_type: str = None) -> Optional[str]:
	"""Find an Item matching machine type and brand, or fall back to an existing Machine item."""
	b_clean = (brand_name or "").strip()
	m_clean = (machine_type or "").strip()

	# 1. Best match: both machine type and brand match
	if m_clean and b_clean:
		item = frappe.db.get_value(
			"Item",
			{"item_name": ["like", f"%{m_clean}%"], "brand": ["like", f"%{b_clean}%"]},
			"name",
		)
		if item:
			return item
		item = frappe.db.get_value(
			"Item",
			{"item_name": ["like", f"%{m_clean}%"], "item_group": ["like", f"%{b_clean}%"]},
			"name",
		)
		if item:
			return item

	# 2. Match by brand alone
	if b_clean:
		item = frappe.db.get_value("Item", {"brand": b_clean}, "name")
		if item:
			return item
		item = frappe.db.get_value("Item", {"brand": ["like", f"%{b_clean}%"]}, "name")
		if item:
			return item
		item = frappe.db.get_value("Item", {"item_group": ["like", f"%{b_clean}%"]}, "name")
		if item:
			return item

	# 3. Match by machine type alone
	if m_clean:
		if frappe.db.exists("Item", m_clean):
			return m_clean
		item = frappe.db.get_value("Item", {"item_name": ["like", f"%{m_clean}%"]}, "name")
		if item:
			return item
		item = frappe.db.get_value("Item", {"name": ["like", f"%{m_clean}%"]}, "name")
		if item:
			return item

	# 4. Fallback to any machine item
	item = frappe.db.get_value("Item", {"item_group": ["like", "%Machine%"]}, "name")
	if item:
		return item
	return frappe.db.get_value("Item", {}, "name")


# ---------------------------------------------------------------------------
# Customer, Contact & Address Management
# ---------------------------------------------------------------------------
def _detect_state(address_text: str) -> str:
	text = (address_text or "").lower()
	for st in ("Tamil Nadu", "Kerala", "Karnataka", "Andhra Pradesh", "Telangana", "Puducherry", "Maharashtra", "Delhi"):
		if st.lower() in text:
			return st
	return "Tamil Nadu"


def _create_address(customer: str, title: str, address_text: str):
	address_text = (address_text or "").strip()
	if not customer or not address_text:
		return
	try:
		parts = [p.strip() for p in re.split(r"[\r\n]+", address_text) if p.strip()]
		line1 = parts[0] if parts else address_text[:140]
		line2 = " ".join(parts[1:])[:140] if len(parts) > 1 else None
		pin_match = re.search(r"\b\d{6}\b", address_text)
		addr = frappe.get_doc({
			"doctype": "Address",
			"address_title": (title or customer)[:140],
			"address_type": "Billing",
			"address_line1": line1,
			"address_line2": line2,
			"pincode": pin_match.group(0) if pin_match else None,
			"state": _detect_state(address_text),
			"country": "India",
			"links": [{"link_doctype": "Customer", "link_name": customer}],
		})
		addr.flags.ignore_mandatory = True
		addr.insert(ignore_permissions=True)
		if not frappe.db.get_value("Customer", customer, "customer_primary_address"):
			frappe.db.set_value("Customer", customer, "customer_primary_address", addr.name)
	except Exception:
		frappe.log_error(frappe.get_traceback(), "WhatsApp: Address create failed")


def _get_or_create_contact(customer: str, name: str, phone10: str) -> Optional[str]:
	"""Retrieve or create a primary Contact for the Customer with their phone number."""
	if not customer or not phone10:
		return None
	existing_contact = frappe.db.get_value("Customer", customer, "customer_primary_contact")
	if existing_contact:
		return existing_contact

	linked_contact = frappe.db.get_value(
		"Dynamic Link",
		{"link_doctype": "Customer", "link_name": customer, "parenttype": "Contact"},
		"parent"
	)
	if linked_contact:
		frappe.db.set_value("Customer", customer, "customer_primary_contact", linked_contact)
		return linked_contact

	try:
		contact = frappe.get_doc({
			"doctype": "Contact",
			"first_name": (name or customer)[:140],
			"links": [{"link_doctype": "Customer", "link_name": customer}],
			"phone_nos": [{
				"phone": phone10,
				"is_primary_phone": 1,
				"is_primary_mobile_no": 1
			}]
		})
		contact.flags.ignore_mandatory = True
		contact.insert(ignore_permissions=True)
		frappe.db.set_value("Customer", customer, "customer_primary_contact", contact.name)
		return contact.name
	except Exception:
		frappe.log_error(frappe.get_traceback(), "WhatsApp: Contact create failed")
		return None


def _find_customer_by_phone(phone: str) -> Optional[str]:
	"""Match a Customer whose mobile_no, secondary phone, or linked Contact phone contains the last 10 digits."""
	p = _last10(phone)
	if not p or len(p) < 10:
		return None
	# 1. Check Customer mobile_no
	name = frappe.db.get_value("Customer", {"mobile_no": ["like", f"%{p}%"]}, "name")
	if name:
		return name
	# 2. Check Customer custom_secondary_phone
	if frappe.db.has_column("Customer", "custom_secondary_phone"):
		name = frappe.db.get_value(
			"Customer", {"custom_secondary_phone": ["like", f"%{p}%"]}, "name"
		)
		if name:
			return name
	# 3. Check linked Contact phone numbers
	try:
		contact_match = frappe.db.sql(
			"""
			SELECT dl.link_name
			FROM `tabContact Phone` cp
			JOIN `tabDynamic Link` dl ON dl.parent = cp.parent AND dl.parenttype = 'Contact'
			WHERE dl.link_doctype = 'Customer'
			  AND cp.phone LIKE %s
			LIMIT 1
			""",
			(f"%{p}%",),
			as_dict=True
		)
		if contact_match:
			return contact_match[0].link_name
	except Exception:
		pass
	return None


def _find_customer_by_name(name: str) -> Optional[str]:
	"""Match a Customer by name if exact or clean match exists."""
	clean_name = (name or "").strip()
	if not clean_name:
		return None
	# Exact match
	match = frappe.db.get_value("Customer", clean_name, "name")
	if match:
		return match
	# Case-insensitive match on customer_name
	return frappe.db.get_value("Customer", {"customer_name": clean_name}, "name")


def _create_customer(name: str, phone: str, address_text: str = "") -> dict:
	"""Create a new Customer record in ERPNext with linked Address and Contact."""
	phone10 = _last10(phone)
	# Check if customer already exists by phone
	existing = _find_customer_by_phone(phone10)
	if existing:
		contact = _get_or_create_contact(existing, name, phone10)
		return {
			"customer": existing,
			"customer_name": frappe.db.get_value("Customer", existing, "customer_name") or name,
			"mobile": phone10,
			"contact": contact,
		}

	cust = frappe.new_doc("Customer")
	cust.customer_name = _clean_name(name) or "WhatsApp Customer"
	cust.customer_type = "Individual"
	cust.customer_group = _default_customer_group()
	cust.territory = _default_territory()
	if cust.meta.has_field("mobile_no"):
		cust.mobile_no = phone10
	cust.flags.ignore_mandatory = True
	cust.insert(ignore_permissions=True)

	if address_text:
		_create_address(cust.name, cust.customer_name, address_text)

	contact = _get_or_create_contact(cust.name, cust.customer_name, phone10)
	return {"customer": cust.name, "customer_name": cust.customer_name, "mobile": phone10, "contact": contact}


def _resolve_customer_context(user_number: str, current_nmap: dict = None, user_name: str = "") -> dict:
	"""
	Resolve customer context for HD Ticket intake:
	- Flow 1 (Existing Customer): Match existing Customer by phone or name in ERPNext.
	- Flow 2 (New Customer): Create new Customer with Address & Contact in ERPNext.
	- Flow 3 (Unified): Parse customer details directly from current_nmap.
	"""
	ctx = {
		"customer": None,
		"customer_name": "",
		"mobile": _last10(user_number),
		"address": "",
		"contact": None,
	}

	# 1. Check for pending Customer form submission for this WhatsApp number
	rows = frappe.get_all(
		"WhatsApp Form Submission",
		filters={
			"user_number": user_number,
			"form_type": ["in", [FORM_NEW, FORM_EXISTING]],
			"processing_status": "Pending",
		},
		fields=["name", "form_type", "payload"],
		order_by="creation desc",
		limit=1,
	)

	if rows:
		row = rows[0]
		try:
			fields = json.loads(row.payload or "{}")
		except Exception:
			fields = {}
		nmap = {_norm(k): v for k, v in fields.items()}

		if row.form_type == FORM_NEW:
			# New Customer journey -> Create Customer & Address
			name = _get(nmap, "Customer Name", "Company / Customer Name", "Company Name", "Client Name", "Full Name", "Name", "Customer", "Company") or user_name
			phone = _get(nmap, "Phone Number", "Mobile Number", "Contact Number", "Phone", "Mobile", "Cell") or user_number
			address = _get(nmap, "Address", "Company Address", "Customer Address", "Location", "Full Address")
			res = _create_customer(name, phone, address)
			ctx.update({
				"customer": res["customer"],
				"customer_name": res["customer_name"],
				"mobile": res["mobile"] or ctx["mobile"],
				"address": address,
				"contact": res.get("contact"),
			})
			return ctx
		else:
			# Existing Customer journey -> Match existing Customer in ERPNext
			name = _get(nmap, "Customer Name", "Company / Customer Name", "Company Name", "Client Name", "Full Name", "Name", "Customer", "Company") or user_name
			mobile = _get(nmap, "Phone Number", "Mobile Number", "Contact Number", "Phone", "Mobile")
			# 1. Match by phone
			match = _find_customer_by_phone(mobile) or _find_customer_by_phone(user_number)
			# 2. Match by customer name if not found by phone
			if not match and name:
				match = _find_customer_by_name(name)

			if not match:
				# Fall back to creating so the ticket is never orphaned
				res = _create_customer(name, mobile or user_number)
				match = res["customer"]
				contact = res.get("contact")
			else:
				contact = _get_or_create_contact(match, name, _last10(mobile or user_number))

			ctx.update({
				"customer": match,
				"customer_name": name or frappe.db.get_value("Customer", match, "customer_name"),
				"mobile": _last10(mobile) or ctx["mobile"],
				"contact": contact,
			})
			return ctx

	# 2. Unified submission (both customer & machine in current form)
	if current_nmap:
		name = _get(current_nmap, "Customer Name", "Company / Customer Name", "Company Name", "Client Name", "Full Name", "Name", "Customer", "Company") or user_name
		phone = _get(current_nmap, "Phone Number", "Mobile Number", "Contact Number", "Phone", "Mobile") or user_number
		address = _get(current_nmap, "Address", "Company Address", "Customer Address", "Location", "Full Address")
		if name or address:
			res = _create_customer(name, phone, address)
			ctx.update({
				"customer": res["customer"],
				"customer_name": res["customer_name"],
				"mobile": res["mobile"] or ctx["mobile"],
				"address": address,
				"contact": res.get("contact"),
			})
			return ctx
		elif phone:
			match = _find_customer_by_phone(phone) or _find_customer_by_phone(user_number)
			if match:
				contact = _get_or_create_contact(match, "", _last10(phone))
				ctx.update({
					"customer": match,
					"customer_name": frappe.db.get_value("Customer", match, "customer_name") or "",
					"mobile": _last10(phone) or ctx["mobile"],
					"contact": contact,
				})
				return ctx

	# 3. Direct lookup by WhatsApp user_number
	match = _find_customer_by_phone(user_number)
	if match:
		contact = _get_or_create_contact(match, "", _last10(user_number))
		ctx.update({
			"customer": match,
			"customer_name": frappe.db.get_value("Customer", match, "customer_name") or "",
			"mobile": _last10(user_number),
			"contact": contact,
		})
	return ctx


# ---------------------------------------------------------------------------
# HD Ticket Assembly
# ---------------------------------------------------------------------------
_YEAR_OPTIONS = {str(y) for y in range(2010, 2027)}


def _assemble_ticket(nmap: dict, ctx: dict) -> str:
	"""Assemble and insert the HD Ticket in status 'Not Specified'."""
	brand = _get(nmap, "Machine Brand", "Brand", "Make", "Brand / Make", "Machine Brand / Make")
	machine_type = _get(nmap, "Machine Type / Model", "Machine Type", "Model", "Machine Model", "Type / Model", "Machine")
	year = _get(nmap, "Purchase Year", "Year of Purchase", "Year", "Machine Year")
	scss = _get(nmap, "Purchase At SCSS", "Purchased At SCS", "Purchased At SCSS", "Purchase At SCS", "Purchased from Sree Chakra", "Purchased from SCSS")
	problem = _get(nmap, "Machine Problem / Issue", "Machine Problem", "Problem / Issue", "Problem", "Issue", "Machine Issue", "Complaint", "Description")
	subject = _get(nmap, "Subject", "Title")
	ticket_type = _get(nmap, "Ticket Type", "Type")
	secondary = _get(nmap, "Secondary Phone No", "Secondary Phone Number", "Secondary Mobile", "Alternate Phone", "Alternative Number", "Alternate Mobile", "Secondary Contact")

	doc = frappe.new_doc("HD Ticket")
	subject = _clean_name(subject)
	doc.subject = subject or f"WhatsApp Service Request - {_clean_name(ctx.get('customer_name')) or ctx.get('mobile') or 'Customer'}"
	doc.status = _ensure_ticket_status()
	doc.custom_date = today()

	if ticket_type and frappe.db.exists("HD Ticket Type", ticket_type):
		doc.ticket_type = ticket_type

	if ctx.get("customer"):
		doc.customer = ctx["customer"]
	if ctx.get("contact"):
		doc.contact = ctx["contact"]
	if ctx.get("customer_name"):
		doc.custom_customer_name = ctx["customer_name"]
	if ctx.get("mobile"):
		doc.custom_customer_mobile_number = ctx["mobile"]
	if secondary:
		doc.custom__secondary_phone_number = _last10(secondary)
	if ctx.get("address"):
		doc.custom_address = ctx["address"]
		doc.custom_state = _detect_state(ctx["address"])

	if brand:
		doc.custom_machine_brand = brand
	if year in _YEAR_OPTIONS:
		doc.custom_purchase_year = year
	if scss in ("Yes", "No"):
		doc.custom_purchased_at_sree_chakra_sewing_systems = scss
	mp = _match_machine_problem(problem)
	if mp:
		doc.custom_machine_problem = mp

	# Lossless capture of all collected form data in the description.
	# Values are customer-controlled free text, so escape them to prevent
	# stored XSS in the agent/helpdesk UI (HD Ticket description is HTML).
	desc_lines = ["<b>Raised via WhatsApp chatbot</b>"]
	if machine_type:
		desc_lines.append(f"Machine Type / Model: {escape_html(machine_type)}")
	if brand:
		desc_lines.append(f"Machine Brand: {escape_html(brand)}")
	if problem:
		desc_lines.append(f"Machine Problem: {escape_html(problem)}")
	if year:
		desc_lines.append(f"Purchase Year: {escape_html(year)}")
	if scss:
		desc_lines.append(f"Purchased at SCSS: {escape_html(scss)}")
	if secondary:
		desc_lines.append(f"Secondary Phone: {escape_html(secondary)}")
	doc.description = "<br>".join(desc_lines)

	# Child Table: Machine type list
	row = {"machine_quantity": 1}
	brand_link = _get_or_create_brand(brand) if brand else None
	matched_item = _match_or_default_item(brand, machine_type)
	if matched_item:
		row["machine_type"] = matched_item
		if not brand_link:
			brand_link = frappe.db.get_value("Item", matched_item, "brand")
	if not brand_link:
		brand_link = frappe.db.get_value("Brand", {}, "name") or _get_or_create_brand("Generic")
	row["machine_brand"] = brand_link

	if year in _YEAR_OPTIONS:
		row["purchase_year"] = year
	if scss in ("Yes", "No"):
		row["purchased_at_scs"] = scss
	if mp:
		row["machine_problem"] = mp
	doc.append("custom_machine_type_list", row)
	if hasattr(doc, "custom_total_machine"):
		doc.custom_total_machine = 1

	doc.flags.ignore_mandatory = True
	doc.insert(ignore_permissions=True)

	# STRICT ENFORCEMENT: Ensure status remains "Not Specified" despite Helpdesk communication hooks
	frappe.db.set_value("HD Ticket", doc.name, {
		"status": TICKET_STATUS,
		"status_category": "Open",
	})
	doc.reload()

	return doc.name


# ---------------------------------------------------------------------------
# Inbound Webhook Endpoint
# ---------------------------------------------------------------------------
@frappe.whitelist(allow_guest=True)
@rate_limit(key="token", limit=120, seconds=60)
def receive_form() -> dict:
	"""Receive one AskEva WhatsApp Flow form submission."""
	settings = frappe.get_single("AskEva Settings")
	if not settings.enabled:
		raise frappe.PermissionError(_("WhatsApp intake is disabled."))

	expected = settings.get_password("webhook_token", raise_exception=False)
	if not expected:
		frappe.log_error("AskEva Settings: Webhook Secret Token not set", "WhatsApp Intake")
		raise frappe.ValidationError(_("WhatsApp intake is not configured."))

	merged = _parse_request()
	query_token = None
	try:
		if getattr(frappe, "request", None) and hasattr(frappe.request, "args"):
			query_token = frappe.request.args.get("token")
	except Exception:
		query_token = None

	token = (
		query_token
		or frappe.form_dict.get("token")
		or _safe_header("X-Askeva-Token")
		or (merged.get("token") if isinstance(merged, dict) else None)
	)

	if not token or not hmac.compare_digest(str(token).strip(), str(expected).strip()):
		raise frappe.PermissionError(_("Invalid webhook token."))

	# Handle Meta WhatsApp Cloud API envelope (interactive nfm_reply)
	if isinstance(merged, dict) and merged.get("object") == "whatsapp_business_account":
		results = []
		for ev in _parse_meta_envelope(merged):
			if ev.get("is_form"):
				results.append(_handle_submission(
					ev.get("user_number"), ev.get("form_name") or "", ev.get("fields"),
					user_name=ev.get("user_name") or "", message_id=ev.get("message_id"),
				))
			else:
				_log_other(ev)
		frappe.db.commit()
		return {"status": "received", "count": len(results), "results": results}

	# Handle direct JSON submission (AskEva standard webhook)
	form_name = merged.get("form_name") or merged.get("formName") or ""
	fields = _extract_fields(merged)
	user_number = (
		merged.get("userNumber") or merged.get("user_number")
		or merged.get("wa_id") or merged.get("from") or merged.get("to") or ""
	)
	user_name = (
		merged.get("userName") or merged.get("user_name")
		or merged.get("name") or merged.get("contact_name") or ""
	)
	message_id = merged.get("message_id") or merged.get("messageId") or merged.get("id")
	return _handle_submission(user_number, form_name, fields, user_name=user_name, message_id=message_id)


def _dedup_key(message_id, user_number, form_name, fields) -> str:
	"""Stable idempotency key for an inbound submission.

	Prefers the provider message id; otherwise hashes sender + form + payload so
	a retried webhook (same content) maps to the same key.
	"""
	if message_id:
		return f"msg:{str(message_id).strip()}"
	digest = hashlib.sha256(
		json.dumps(
			{"u": user_number, "f": form_name, "d": fields},
			sort_keys=True, ensure_ascii=False, default=str,
		).encode("utf-8")
	).hexdigest()[:32]
	return f"hash:{digest}"


def _handle_submission(user_number, form_name, fields, user_name: str = "", message_id=None) -> dict:
	"""Process one form submission: store customer form or assemble HD Ticket for machine form."""
	fields = fields or {}
	nmap = {_norm(k): v for k, v in fields.items()}
	user_number = _digits(
		user_number or _get(nmap, "userNumber", "user_number", "wa_id", "from", "to")
	)
	form_type = _detect_form_type(form_name, nmap)

	if not user_number:
		frappe.log_error(
			f"userNumber not found. form={form_name} field keys={list(fields.keys())}",
			"WhatsApp Intake: missing userNumber",
		)
		return {"status": "error", "message": "Missing userNumber"}

	# 0. Idempotency: ignore webhook retries / duplicate deliveries of the same message.
	dedup = _dedup_key(message_id, user_number, form_name, fields)
	existing = frappe.db.get_value(
		"WhatsApp Form Submission",
		{"dedup_key": dedup},
		["name", "processing_status", "hd_ticket"],
		as_dict=True,
	)
	if existing:
		return {
			"status": "duplicate",
			"submission": existing.name,
			"processing_status": existing.processing_status,
			"ticket": existing.hd_ticket,
		}

	# 1. Audit Log: Insert WhatsApp Form Submission and commit immediately
	sub = frappe.get_doc({
		"doctype": "WhatsApp Form Submission",
		"user_number": user_number,
		"form_name": form_name or form_type,
		"form_type": form_type,
		"dedup_key": dedup,
		"received_at": frappe.utils.now_datetime(),
		"processing_status": "Pending",
		"payload": json.dumps(fields, ensure_ascii=False, indent=2, default=str),
	})
	try:
		sub.insert(ignore_permissions=True)
		frappe.db.commit()
	except (frappe.UniqueValidationError, frappe.DuplicateEntryError):
		# Concurrent duplicate won the race on the unique dedup_key index.
		frappe.db.rollback()
		existing = frappe.db.get_value(
			"WhatsApp Form Submission", {"dedup_key": dedup},
			["name", "processing_status", "hd_ticket"], as_dict=True,
		) or {}
		return {
			"status": "duplicate",
			"submission": existing.get("name"),
			"processing_status": existing.get("processing_status"),
			"ticket": existing.get("hd_ticket"),
		}

	# Customer forms (Existing Customer / New Customer) are held until Ticket Machine arrives
	if form_type != FORM_MACHINE:
		return {"status": "stored", "form_type": form_type, "submission": sub.name}

	# 2. Machine form has arrived: Assemble Customer and HD Ticket
	orig_user = frappe.session.user
	try:
		# Run intake with Administrator privileges to satisfy Helpdesk contact validation
		frappe.set_user("Administrator")
		ctx = _resolve_customer_context(user_number, current_nmap=nmap, user_name=user_name)
		ticket_name = _assemble_ticket(nmap, ctx)

		sub.reload()
		sub.hd_ticket = ticket_name
		sub.customer = ctx.get("customer")
		sub.processing_status = "Processed"
		sub.save(ignore_permissions=True)

		# Mark preceding customer forms as Processed
		for row in frappe.get_all(
			"WhatsApp Form Submission",
			filters={
				"user_number": user_number,
				"form_type": ["in", [FORM_NEW, FORM_EXISTING]],
				"processing_status": "Pending",
			},
			pluck="name",
		):
			frappe.db.set_value("WhatsApp Form Submission", row, {
				"processing_status": "Processed",
				"hd_ticket": ticket_name,
				"customer": ctx.get("customer"),
			})

		frappe.db.commit()
		return {
			"status": "success",
			"ticket": ticket_name,
			"ticket_status": TICKET_STATUS,
			"customer": ctx.get("customer"),
			"customer_name": ctx.get("customer_name"),
		}
	except Exception as e:
		frappe.db.rollback()
		try:
			sub.reload()
			sub.processing_status = "Error"
			sub.error_message = frappe.get_traceback()
			sub.save(ignore_permissions=True)
			frappe.db.commit()
		except Exception:
			pass
		frappe.log_error(frappe.get_traceback(), "WhatsApp: ticket creation failed")
		return {"status": "error", "message": str(e), "submission": sub.name}
	finally:
		frappe.set_user(orig_user)


def _parse_meta_envelope(body: dict) -> list:
	"""Flatten a Meta WhatsApp Cloud API webhook body into a list of events."""
	events = []
	for entry in body.get("entry", []) or []:
		for change in entry.get("changes", []) or []:
			value = change.get("value", {}) or {}
			contacts = value.get("contacts", []) or []
			default_from = contacts[0].get("wa_id") if contacts else None
			profile_name = (contacts[0].get("profile", {}) or {}).get("name") if contacts else None
			for m in value.get("messages", []) or []:
				mtype = m.get("type")
				ev = {
					"user_number": m.get("from") or default_from,
					"message_id": m.get("id"),
					"type": mtype,
					"is_form": False,
					"form_name": None,
					"fields": {},
					"text": "",
					"profile_name": profile_name,
					"user_name": profile_name or "",
				}
				if mtype == "interactive":
					inter = m.get("interactive", {}) or {}
					itype = inter.get("type")
					if itype == "nfm_reply":
						nfm = inter.get("nfm_reply", {}) or {}
						ev["form_name"] = nfm.get("name") or ""
						raw = nfm.get("response_json")
						try:
							resp = json.loads(raw) if isinstance(raw, str) else (raw or {})
						except Exception:
							resp = {}
						if isinstance(resp, dict):
							ev["fields"] = resp
						ev["is_form"] = True
					else:
						reply = inter.get(itype, {}) or {}
						ev["text"] = reply.get("title") or reply.get("id") or ""
				elif mtype == "text":
					ev["text"] = (m.get("text", {}) or {}).get("body") or ""
				events.append(ev)
	return events


def _log_other(ev: dict) -> None:
	"""Record a non-form inbound message (text, button tap) as an Ignored row."""
	try:
		frappe.get_doc({
			"doctype": "WhatsApp Form Submission",
			"user_number": _digits(ev.get("user_number")) or "unknown",
			"form_name": ev.get("type") or "message",
			"form_type": "Unknown",
			"received_at": frappe.utils.now_datetime(),
			"processing_status": "Ignored",
			"payload": json.dumps(ev, ensure_ascii=False, indent=2, default=str),
		}).insert(ignore_permissions=True)
	except Exception:
		pass


# ---------------------------------------------------------------------------
# Outbound WhatsApp Notification (Sales Invoice)
# ---------------------------------------------------------------------------

def _invoice_pdf_secret() -> bytes:
	"""Site-specific secret for signing invoice download links."""
	secret = frappe.local.conf.get("encryption_key") or frappe.local.conf.get("secret_key")
	if not secret:
		frappe.throw(_("Site encryption key is not configured; cannot sign invoice links."))
	return secret.encode("utf-8")


def _generate_invoice_pdf_token(invoice_name: str, exp: int, print_format: str = None) -> str:
	"""Internal HMAC signature binding an invoice name, print format, and expiry timestamp.

	NOT whitelisted on purpose: exposing this as a guest endpoint would let
	anyone mint valid download links for arbitrary invoices (IDOR oracle).
	"""
	fmt_part = f":{print_format.strip()}" if print_format else ""
	return hmac.new(
		_invoice_pdf_secret(),
		f"wa_invoice_pdf:{invoice_name}:{int(exp)}{fmt_part}".encode("utf-8"),
		hashlib.sha256,
	).hexdigest()


def _verify_invoice_pdf_token(invoice_name: str, key: str, exp, print_format: str = None) -> bool:
	"""Constant-time verify of an invoice link signature, rejecting expired links."""
	if not key or exp in (None, ""):
		return False
	try:
		exp_int = int(exp)
	except (TypeError, ValueError):
		return False
	if exp_int < int(time.time()):
		return False  # link has expired

	# Verify with format if provided
	expected = _generate_invoice_pdf_token(invoice_name, exp_int, print_format)
	if hmac.compare_digest(str(key).strip(), expected):
		return True

	# Fallback verification without format for backward compatibility
	expected_legacy = _generate_invoice_pdf_token(invoice_name, exp_int, None)
	return hmac.compare_digest(str(key).strip(), expected_legacy)


def get_invoice_print_formats(selected_format: str = None) -> tuple[list[str], str]:
	"""Return active Print Formats for Sales Invoice and the selected/default choice."""
	formats = frappe.get_all(
		"Print Format",
		filters={"doc_type": "Sales Invoice", "disabled": 0},
		pluck="name",
		order_by="name asc"
	)
	doc_meta = frappe.get_meta("Sales Invoice")
	meta_default = doc_meta.default_print_format
	preferred = selected_format or meta_default
	if not preferred or preferred not in formats:
		for cand in ["Service invoice", "Sales Invoice Standard", "GST Tax Invoice"]:
			if cand in formats:
				preferred = cand
				break
	if not preferred and formats:
		preferred = formats[0]
	return formats, (preferred or "Standard")


@frappe.whitelist(allow_guest=True)
@rate_limit(key="name", limit=30, seconds=60)
def download_invoice_pdf(name: str, key: str = None, exp=None, format: str = None, print_format: str = None):
	"""
	Public guest-accessible endpoint to download/view the Sales Invoice PDF.
	Supports selecting custom Print Formats.
	Secured by a time-limited HMAC key to prevent IDOR / unauthorized scraping.
	"""
	if not name or not frappe.db.exists("Sales Invoice", name):
		frappe.throw(_("Invoice not found"), frappe.DoesNotExistError)

	docstatus = frappe.db.get_value("Sales Invoice", name, "docstatus")
	if docstatus == 2:
		frappe.throw(_("This invoice has been cancelled."), frappe.ValidationError)

	chosen_format = (print_format or format or "").strip() or None

	# Security: If user is logged in and has read permission on Sales Invoice, allow access
	is_authorized = False
	if frappe.session.user != "Guest":
		is_authorized = frappe.has_permission("Sales Invoice", "read", name)

	# If guest or user without direct permission, verify the signed, time-limited key
	if not is_authorized:
		if not _verify_invoice_pdf_token(name, key, exp, chosen_format):
			frappe.throw(_("Invalid or expired invoice download link."), frappe.PermissionError)

	orig_user = frappe.session.user
	host_name_set = False
	orig_host_name = frappe.local.conf.get("host_name")
	try:
		# In dev/bench environments without a local DNS entry, ensure host_name can
		# render assets. Restored in finally so this never leaks across requests.
		if not orig_host_name and "localhost" not in frappe.utils.get_url() and "127.0.0.1" not in frappe.utils.get_url():
			frappe.local.conf.host_name = f"http://127.0.0.1:{frappe.local.conf.get('webserver_port') or 8001}"
			host_name_set = True

		# Temporarily elevate to Administrator context for PDF rendering so guest can receive their verified document
		frappe.set_user("Administrator")
		pdf_opts = {"load-error-handling": "ignore", "load-media-error-handling": "ignore"}
		pdf = None
		try:
			if chosen_format:
				pdf = frappe.get_print("Sales Invoice", name, print_format=chosen_format, as_pdf=True, pdf_options=pdf_opts)
			else:
				pdf = frappe.get_print("Sales Invoice", name, as_pdf=True, pdf_options=pdf_opts)
		except Exception as pf_err:
			if chosen_format:
				frappe.log_error(f"Custom print format '{chosen_format}' failed for {name}: {str(pf_err)}. Falling back to default format.", "Invoice PDF Generation Fallback")
				pdf = frappe.get_print("Sales Invoice", name, as_pdf=True, pdf_options=pdf_opts)
			else:
				raise

		safe_name = name.replace("/", "-")
		frappe.local.response.filename = f"{safe_name}.pdf"
		frappe.local.response.filecontent = pdf
		frappe.local.response.type = "pdf"
	except Exception as e:
		frappe.log_error(f"Failed to generate invoice PDF for {name} ({chosen_format}): {str(e)}", "Invoice PDF Generation Error")
		frappe.throw(_("Unable to generate PDF invoice."), frappe.ValidationError)
	finally:
		frappe.set_user(orig_user)
		if host_name_set:
			frappe.local.conf.host_name = orig_host_name


def _resolve_invoice_phone_numbers(doc) -> dict:
	"""
	Collect all potential customer mobile numbers for a Sales Invoice.
	Returns a dict with 'primary' phone and 'all_phones' list.
	"""
	phones = []

	def _add(p, is_primary=False):
		if not p:
			return
		cleaned = _digits(p)
		if len(cleaned) >= 10:
			last_10 = cleaned[-10:]
			if not any(item["phone"] == last_10 for item in phones):
				if is_primary:
					phones.insert(0, {"phone": last_10, "raw": p})
				else:
					phones.append({"phone": last_10, "raw": p})

	# 1. Direct Sales Invoice fields
	if hasattr(doc, "contact_mobile") and doc.contact_mobile:
		_add(doc.contact_mobile, is_primary=True)

	# 2. Linked HD Ticket fields
	hd_ticket_id = doc.get("custom_hd_ticket")
	if hd_ticket_id and frappe.db.exists("HD Ticket", hd_ticket_id):
		t_primary = frappe.db.get_value("HD Ticket", hd_ticket_id, "custom_customer_mobile_number")
		t_secondary = frappe.db.get_value("HD Ticket", hd_ticket_id, "custom__secondary_phone_number")
		if t_primary:
			_add(t_primary, is_primary=True)
		if t_secondary:
			_add(t_secondary)

	# 3. Linked Customer master
	if doc.customer and frappe.db.exists("Customer", doc.customer):
		cust = frappe.get_doc("Customer", doc.customer)
		if getattr(cust, "mobile_no", None):
			_add(cust.mobile_no, is_primary=len(phones) == 0)
		if getattr(cust, "custom_secondary_phone", None):
			_add(cust.custom_secondary_phone)

		# 4. Linked Contact records
		contact_id = getattr(cust, "customer_primary_contact", None) or doc.get("contact_person")
		if contact_id and frappe.db.exists("Contact", contact_id):
			c_doc = frappe.get_doc("Contact", contact_id)
			for r in (c_doc.get("phone_nos") or []):
				if r.phone:
					_add(r.phone, is_primary=bool(r.is_primary_phone or r.is_primary_mobile_no))

	primary_phone = phones[0]["phone"] if phones else ""
	return {
		"primary": primary_phone,
		"all_phones": [p["phone"] for p in phones]
	}


def _sanitize_meta_param(val) -> str:
	"""
	Sanitize parameter values according to Meta WhatsApp Cloud API rules:
	- No newlines, carriage returns, or tabs
	- No more than 4 consecutive spaces
	- Max length 1000 characters
	"""
	if val is None:
		return ""
	s = str(val)
	s = re.sub(r"[\r\n\t]+", " ", s)
	s = re.sub(r" {4,}", "   ", s)
	s = s.strip()
	return s[:1000]


DEFAULT_INVOICE_MESSAGE_TEMPLATE = (
	"Dear {customer_name},\n\n"
	"Thank you for choosing {company_name}! Your service invoice {invoice_no} for {amount} has been generated.\n\n"
	"Mode of Payment: {payment_mode}\n"
	"Technician: {technician_name}\n\n"
	"For any queries, please feel free to reach out to us."
)


def _strip_direct_links_from_message(text: str) -> str:
	"""
	Ensure no direct invoice PDF links are included in the message text.
	Strips lines containing download_invoice_pdf or {pdf_link} along with any
	preceding 'View / Download Invoice PDF:' headings.
	"""
	if not text:
		return ""
	lines = text.split("\n")
	cleaned = []
	for line in lines:
		# Check if this line is a direct PDF link or placeholder
		if "{pdf_link}" in line or "download_invoice_pdf" in line:
			# If previous line was a link header like "View / Download Invoice PDF:", remove it too
			if cleaned and any(k in cleaned[-1].lower() for k in ["download invoice", "view invoice", "invoice pdf", "download pdf", "view / download"]):
				cleaned.pop()
			continue
		cleaned.append(line)
	result = "\n".join(cleaned)
	result = re.sub(r"\n{3,}", "\n\n", result)
	return result.strip()


def _is_public_accessible_url(url: str) -> bool:
	"""Check if URL points to a public FQDN/domain (not localhost, local IP, or private host)."""
	if not url:
		return False
	try:
		from urllib.parse import urlparse
		import ipaddress
		parsed = urlparse(url)
		scheme = (parsed.scheme or "").lower()
		host = (parsed.hostname or "").lower()
		if not host or scheme not in ["http", "https"]:
			return False
		if host in ["localhost", "127.0.0.1", "0.0.0.0", "chakra"]:
			return False
		if host.endswith(".local") or host.endswith(".lan"):
			return False
		try:
			ip = ipaddress.ip_address(host)
			return not ip.is_private and not ip.is_loopback
		except ValueError:
			return "." in host
	except Exception:
		return False


def _inspect_template_capabilities(template_name: str) -> dict:
	"""
	Determine if a Meta template has a Document Header, number of params, etc.
	Uses cached AskEva template data when available.
	"""
	t_name = (template_name or "").strip()
	if not t_name:
		return {"has_document_header": False, "header_format": None, "param_count": 0}

	# Known default templates
	if t_name == "service_invoice_with_pdf":
		return {
			"has_document_header": True,
			"header_format": "DOCUMENT",
			"param_count": 5
		}

	cached = frappe.cache().get_value("askeva_templates_cache")
	if cached and isinstance(cached, list):
		for t in cached:
			if t.get("name") == t_name:
				return {
					"has_document_header": bool(t.get("has_document_header")),
					"header_format": t.get("header_format"),
					"param_count": t.get("param_count", 0)
				}

	has_doc = ("pdf" in t_name.lower() or "doc" in t_name.lower() or "attach" in t_name.lower())
	return {
		"has_document_header": has_doc,
		"header_format": "DOCUMENT" if has_doc else None,
		"param_count": 5
	}


def _build_invoice_context(doc, print_format: str = None) -> dict:
	"""Assemble template placeholders dictionary for a Sales Invoice."""
	settings = frappe.get_single("AskEva Settings")
	base_url = (
		(settings.get("public_base_url") or "").strip().rstrip("/")
		or (frappe.get_site_config().get("host_name") or "").strip().rstrip("/")
		or frappe.utils.get_url().rstrip("/")
	)
	exp = int(time.time()) + PDF_LINK_TTL
	pdf_token = _generate_invoice_pdf_token(doc.name, exp, print_format)
	fmt_param = f"&format={requests.utils.quote(print_format)}" if print_format else ""
	pdf_link = (
		f"{base_url}/api/method/vin_chakra.whatsapp_api.download_invoice_pdf"
		f"?name={doc.name}{fmt_param}&key={pdf_token}&exp={exp}"
	)

	formatted_amount = frappe.utils.fmt_money(doc.grand_total, currency=doc.currency)
	cust_name = doc.customer_name or frappe.db.get_value("Customer", doc.customer, "customer_name") or doc.customer or "Customer"
	tech_name = doc.get("custom_technician") or "Technician"
	payment_mode = doc.get("custom_mode_of_payment") or "N/A"
	ticket_id = doc.get("custom_hd_ticket") or "N/A"
	company_name = doc.company or "Sree Chakra Sewing Systems"
	posting_date = frappe.utils.formatdate(doc.posting_date)

	return {
		"customer_name": cust_name,
		"invoice_no": doc.name,
		"amount": formatted_amount,
		"grand_total": str(doc.grand_total),
		"payment_mode": payment_mode,
		"technician_name": tech_name,
		"ticket_no": ticket_id,
		"company_name": company_name,
		"posting_date": posting_date,
		"pdf_link": pdf_link,
		"print_format": print_format or "",
	}


def dispatch_askeva_whatsapp(
	to_number: str,
	send_mode: str = "Template Message",
	template_name: str = None,
	template_language: str = "en",
	parameters: list = None,
	text_message: str = None,
	media_url: str = None,
	document_filename: str = None,
	reference_doctype: str = None,
	reference_name: str = None,
) -> dict:
	"""
	Modular engine to send WhatsApp messages (templates or direct text) via AskEva API.
	Reusable for Sales Invoices, Quotations, HD Tickets, and Customer Alerts.

	In Direct Text mode, if ``media_url`` is given the message is sent as a
	WhatsApp *document* (the PDF is delivered as an actual file) with
	``text_message`` as the caption, instead of a plain text message.
	"""
	settings = frappe.get_single("AskEva Settings")
	if not settings.enabled:
		return {
			"status": "error",
			"message": _("AskEva WhatsApp integration is disabled. Please enable it in AskEva Settings.")
		}

	# Fallback to webhook_token if api_token is empty or invalid hex
	api_token = settings.get_password("api_token", raise_exception=False)
	if not api_token or (len(api_token) % 2 != 0 and len(api_token) < 32):
		api_token = settings.get_password("webhook_token", raise_exception=False)

	if not api_token:
		return {
			"status": "error",
			"message": _("AskEva Send Message API Token is not configured in AskEva Settings.")
		}

	digits = _digits(to_number)
	if len(digits) < 10:
		return {
			"status": "error",
			"message": _("Invalid mobile number: {0}. Must contain at least 10 digits.").format(to_number)
		}

	# Format for WhatsApp (Indian numbers: prefix with 91 if 10 digits)
	if len(digits) == 10:
		whatsapp_number = "91" + digits
	elif len(digits) == 12 and digits.startswith("91"):
		whatsapp_number = digits
	else:
		whatsapp_number = digits

	api_url = (settings.api_url or "https://backend.askeva.io/v1/message/send-message").strip()

	payload = {
		"to": whatsapp_number,
		"number": whatsapp_number,
		"phone": whatsapp_number,
		"userNumber": whatsapp_number,
	}

	if send_mode == "Template Message":
		t_name = (template_name or settings.invoice_template_name or "service_invoice").strip()
		lang = (template_language or settings.invoice_template_language or settings.default_language_code or "en").strip()

		sanitized_params = [_sanitize_meta_param(p) for p in (parameters or [])]

		template_obj = {
			"name": t_name,
			"language": {
				"code": lang
			}
		}

		filename = None
		if media_url:
			filename = (document_filename or "invoice.pdf").strip()
			if not filename.lower().endswith(".pdf"):
				filename = f"{filename}.pdf"

		# Meta Cloud API template components. A document header attaches the PDF
		# as a real file and (unlike free-form messages) is allowed outside the
		# 24h session window. The chosen template MUST have a Document header for
		# this to be accepted by Meta.
		components = []
		if media_url and t_name != "test":
			components.append({
				"type": "header",
				"parameters": [{
					"type": "document",
					"document": {"link": media_url, "filename": filename}
				}]
			})
		if t_name != "test" and sanitized_params:
			components.append({
				"type": "body",
				"parameters": [{"type": "text", "text": str(v)} for v in sanitized_params]
			})
		if components:
			template_obj["components"] = components

		payload.update({
			"type": "template",
			"template": template_obj,
			"template_name": t_name,
			"templateName": t_name,
			"language_code": lang,
			"language": lang,
			"parameters": sanitized_params,
			"template_parameters": sanitized_params,
			"body_parameters": sanitized_params,
			"params": sanitized_params,
		})
		if media_url:
			payload["media_url"] = media_url
			payload["url"] = media_url
			payload["filename"] = filename
	else:
		rendered_text = (text_message or "").strip()

		if media_url:
			# Deliver the PDF as an actual WhatsApp document, with the message
			# text as the caption. WhatsApp caps media captions at 1024 chars.
			caption = rendered_text[:1024]
			filename = (document_filename or "invoice.pdf").strip()
			if not filename.lower().endswith(".pdf"):
				filename = f"{filename}.pdf"
			document_obj = {"link": media_url, "filename": filename}
			if caption:
				document_obj["caption"] = caption
			payload.update({
				"type": "document",
				"document": document_obj,
				# redundant flat keys for AskEva wrapper variants
				"media_url": media_url,
				"url": media_url,
				"filename": filename,
				"caption": caption,
				"message": caption,
			})
		else:
			if not rendered_text:
				return {
					"status": "error",
					"message": _("Direct text message body cannot be empty.")
				}

			payload.update({
				"type": "text",
				"text": {
					"body": rendered_text
				},
				"message": rendered_text,
			})

	headers = {
		"Content-Type": "application/json",
		"Authorization": f"Bearer {api_token}",
	}

	try:
		resp = requests.post(
			api_url,
			params={"token": api_token},
			json=payload,
			headers=headers,
			timeout=20,
		)
		resp_text = resp.text.strip() if resp.text else ""

		is_success = False
		error_detail = ""

		if resp.status_code in [200, 201]:
			try:
				resp_json = resp.json()
				if isinstance(resp_json, dict) and resp_json.get("status") in ["error", "failed", False]:
					error_detail = resp_json.get("message") or resp_json.get("error") or resp_text
				elif isinstance(resp_json, dict) and "error" in resp_json:
					err_obj = resp_json.get("error")
					error_detail = err_obj.get("message") if isinstance(err_obj, dict) else str(err_obj)
				else:
					is_success = True
			except Exception:
				is_success = True
		else:
			try:
				err_json = resp.json()
				if isinstance(err_json, dict):
					details = ""
					if isinstance(err_json.get("error_data"), dict):
						details = err_json["error_data"].get("details", "")
					elif isinstance(err_json.get("error"), dict) and isinstance(err_json["error"].get("error_data"), dict):
						details = err_json["error"]["error_data"].get("details", "")

					err_obj = err_json.get("error") or err_json.get("message")
					if isinstance(err_obj, dict):
						error_detail = err_obj.get("message") or str(err_obj)
					elif err_obj:
						error_detail = str(err_obj)
					else:
						error_detail = resp_text

					if details and details not in error_detail:
						error_detail = f"{error_detail}: {details}" if error_detail else details
				else:
					error_detail = resp_text
			except Exception:
				error_detail = resp_text

			# Auto-recovery: If the template literally does not have a Header component in Meta,
			# Meta rejects with "header: Template does not contain title component, no parameters allowed".
			# In that specific case, strip the header component and retry dispatch as body-only template.
			# NOTE: If Meta rejected because the URL is invalid (e.g. not a public URI), do NOT strip the header!
			# Stripping the header when the user chose a document template would silently degrade the message to SMS-only.
			has_header_param = any(
				c.get("type") == "header"
				for c in payload.get("template", {}).get("components", [])
			)
			if has_header_param and (
				"Template does not contain title component" in resp_text
				or "no parameters allowed" in resp_text
			):
				payload["template"]["components"] = [
					c for c in payload["template"]["components"] if c.get("type") != "header"
				]
				if not payload["template"]["components"]:
					payload["template"].pop("components", None)
				payload.pop("media_url", None)
				payload.pop("url", None)
				payload.pop("filename", None)

				try:
					retry_resp = requests.post(
						api_url,
						params={"token": api_token},
						json=payload,
						headers=headers,
						timeout=20,
					)
					if retry_resp.status_code in [200, 201]:
						retry_json = retry_resp.json() if retry_resp.text else {}
						if not (isinstance(retry_json, dict) and (retry_json.get("status") in ["error", "failed", False] or "error" in retry_json)):
							resp = retry_resp
							resp_text = retry_resp.text.strip() if retry_resp.text else ""
							is_success = True
							error_detail = ""

							# If the Meta template lacks a document header, dispatch the invoice PDF as an attached document message
							if media_url:
								try:
									doc_payload = {
										"to": whatsapp_number,
										"number": whatsapp_number,
										"phone": whatsapp_number,
										"userNumber": whatsapp_number,
										"type": "document",
										"document": {
											"link": media_url,
											"filename": filename or "invoice.pdf",
											"caption": f"Attached Invoice PDF: {reference_name or 'Invoice'}"
										},
										"media_url": media_url,
										"url": media_url,
										"filename": filename or "invoice.pdf",
										"caption": f"Attached Invoice PDF: {reference_name or 'Invoice'}"
									}
									requests.post(
										api_url,
										params={"token": api_token},
										json=doc_payload,
										headers=headers,
										timeout=15,
									)
								except Exception:
									pass
				except Exception:
					pass

			# User-friendly clarifications for common WhatsApp / AskEva responses
			if "encoding" in error_detail and "Received 'hex'" in error_detail:
				error_detail = (
					"Invalid AskEva API Token format (odd length hex error). "
					"Please verify your Send Message API Token in AskEva Settings."
				)
			elif "Session is not opened" in error_detail:
				error_detail = (
					f"WhatsApp 24-hour customer session is closed for +{whatsapp_number}. "
					"Under Meta WhatsApp policy, sending unprompted messages outside the 24h window requires an "
					"approved Template Message. Please configure and select an approved Template Message in AskEva Settings."
				)
			elif "Template is not valid" in error_detail:
				t_name = payload.get("template", {}).get("name") or payload.get("template_name")
				error_detail = (
					f"Template '{t_name}' was not found or is not approved in your AskEva / Meta WhatsApp account. "
					"Please check your approved template names in AskEva Settings."
				)
			elif "Number of parameters does not match" in error_detail or "localizable_params" in error_detail:
				error_detail = (
					"Template parameter count mismatch: Meta WhatsApp template expected a different number "
					"of parameters. Please check 'Template Parameters' in AskEva Settings."
				)
			elif "document.link" in resp_text or "valid uri" in resp_text.lower():
				error_detail = (
					f"Meta WhatsApp Cloud API rejected the attached PDF because '{media_url}' is not a valid public HTTPS URL. "
					"Meta requires a publicly accessible domain to download and attach the file. "
					"Please configure 'Public Base URL' in AskEva Settings (e.g. your public domain or ngrok tunnel URL)."
				)

		if not is_success:
			masked_token = f"{api_token[:4]}...{api_token[-4:]}" if len(api_token) > 8 else "***"
			frappe.log_error(
				f"AskEva Dispatch Failed to +{whatsapp_number}\nURL: {api_url}\nToken: {masked_token}\nStatus: {resp.status_code}\nResponse: {resp_text}\nPayload:\n{json.dumps(payload, indent=2)}",
				"AskEva WhatsApp Dispatch Failure"
			)
			return {
				"status": "error",
				"message": f"AskEva API rejected message: {error_detail or 'Unknown error'}",
				"number": whatsapp_number
			}

		return {
			"status": "success",
			"message": f"Invoice successfully sent to +{whatsapp_number} via WhatsApp.",
			"number": whatsapp_number,
			"payload": payload
		}

	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "AskEva WhatsApp Dispatch Failure")
		return {
			"status": "error",
			"message": f"Failed to connect to AskEva API: {str(e)}"
		}


@frappe.whitelist(allow_guest=True)
def get_invoice_notification_preview(invoice_name: str, target_phone: str = None, print_format: str = None) -> dict:
	"""Fetch details, recipient phones, print formats, and message preview for the Send Invoice dialog."""
	if not invoice_name or not frappe.db.exists("Sales Invoice", invoice_name):
		frappe.throw(_("Sales Invoice {0} not found").format(invoice_name))

	doc = frappe.get_doc("Sales Invoice", invoice_name)
	if frappe.session.user != "Guest" and not frappe.has_permission("Sales Invoice", "read", doc):
		frappe.throw(_("Not permitted to view Sales Invoice {0}").format(invoice_name), frappe.PermissionError)

	settings = frappe.get_single("AskEva Settings")
	phone_info = _resolve_invoice_phone_numbers(doc)

	selected_phone = target_phone or phone_info["primary"]
	formats, default_pf = get_invoice_print_formats(print_format)
	chosen_format = print_format if (print_format and print_format in formats) else default_pf
	ctx = _build_invoice_context(doc, print_format=chosen_format)

	# Direct message preview (without direct download URL link)
	direct_template = settings.invoice_message_template or DEFAULT_INVOICE_MESSAGE_TEMPLATE
	rendered_text = direct_template
	for k, v in ctx.items():
		if k != "pdf_link":
			rendered_text = rendered_text.replace(f"{{{k}}}", str(v))
	rendered_text = _strip_direct_links_from_message(rendered_text)

	# Meta template parameters preview
	param_string = settings.invoice_template_params or "{customer_name}, {ticket_no}, {amount}, {payment_mode}, {technician_name}"
	param_tokens = [p.strip() for p in param_string.split(",") if p.strip()]
	param_values = []
	for token in param_tokens:
		val = token
		for k, v in ctx.items():
			if k == "pdf_link":
				# Meta variables cannot be empty; indicate PDF is attached instead of passing raw link
				val = val.replace("{pdf_link}", "Attached with this message")
			else:
				val = val.replace(f"{{{k}}}", str(v))
		param_values.append(val)

	t_name = settings.invoice_template_name or "service_invoice_with_pdf"
	t_cap = _inspect_template_capabilities(t_name)
	is_public_base = _is_public_accessible_url(ctx["pdf_link"])
	base_url = (
		(settings.get("public_base_url") or "").strip().rstrip("/")
		or (frappe.get_site_config().get("host_name") or "").strip().rstrip("/")
		or frappe.utils.get_url().rstrip("/")
	)

	return {
		"invoice_name": doc.name,
		"customer_name": ctx["customer_name"],
		"grand_total": ctx["amount"],
		"target_phone": selected_phone,
		"available_phones": phone_info["all_phones"],
		"send_mode": settings.invoice_send_mode or "Template Message",
		"template_name": t_name,
		"template_language": settings.invoice_template_language or settings.default_language_code or "en",
		"rendered_text": rendered_text,
		"param_values": param_values,
		"pdf_link": ctx["pdf_link"],
		"print_formats": formats,
		"default_print_format": chosen_format,
		"print_format": chosen_format,
		"include_pdf_link": True,
		"has_document_header": t_cap.get("has_document_header", False),
		"header_format": t_cap.get("header_format"),
		"is_public_base_url": is_public_base,
		"public_base_url": base_url,
		"is_configured": bool(
			settings.enabled
			and (
				settings.get_password("api_token", raise_exception=False)
				or settings.get_password("webhook_token", raise_exception=False)
			)
		)
	}


@frappe.whitelist(allow_guest=True)
def send_sales_invoice_whatsapp(invoice_name: str, target_phone: str = None, print_format: str = None) -> dict:
	"""
	Dispatch the Sales Invoice and its attached PDF to the customer's WhatsApp mobile number via AskEva API.
	Includes print format selection, direct link removal from message body, rate-limiting, and audit comments.
	"""
	if frappe.session.user == "Guest":
		frappe.throw(_("Your login session has expired. Please refresh the page and log in to send invoices."), frappe.PermissionError)

	if not invoice_name or not frappe.db.exists("Sales Invoice", invoice_name):
		frappe.throw(_("Sales Invoice {0} not found").format(invoice_name))

	doc = frappe.get_doc("Sales Invoice", invoice_name)
	if not frappe.has_permission("Sales Invoice", "read", doc):
		frappe.throw(_("Not permitted to view or send Sales Invoice {0}").format(invoice_name), frappe.PermissionError)

	# Idempotency lock to prevent duplicate clicks
	lock_key = f"wa_invoice_lock_{invoice_name}"
	if frappe.cache().get_value(lock_key):
		frappe.throw(_("Invoice is already being dispatched to WhatsApp. Please wait a moment."), frappe.DuplicateEntryError)
	frappe.cache().set_value(lock_key, 1, expires_in_sec=15)

	try:
		settings = frappe.get_single("AskEva Settings")
		if not settings.enabled:
			frappe.throw(_("AskEva WhatsApp integration is disabled. Please enable it in AskEva Settings."))

		# Resolve target phone
		if not target_phone:
			phone_info = _resolve_invoice_phone_numbers(doc)
			target_phone = phone_info["primary"]

		if not target_phone:
			frappe.throw(_("No customer mobile number found for this Sales Invoice. Please enter a valid phone number."))

		formats, default_pf = get_invoice_print_formats(print_format)
		chosen_format = print_format if (print_format and print_format in formats) else default_pf
		ctx = _build_invoice_context(doc, print_format=chosen_format)
		send_mode = settings.invoice_send_mode or "Template Message"

		param_values = []
		if send_mode == "Template Message":
			param_string = settings.invoice_template_params or "{customer_name}, {ticket_no}, {amount}, {payment_mode}, {technician_name}"
			param_tokens = [p.strip() for p in param_string.split(",") if p.strip()]
			for token in param_tokens:
				val = token
				for k, v in ctx.items():
					if k == "pdf_link":
						val = val.replace("{pdf_link}", "Attached with this message")
					else:
						val = val.replace(f"{{{k}}}", str(v))
				param_values.append(val)
			rendered_text = None
		else:
			direct_template = settings.invoice_message_template or DEFAULT_INVOICE_MESSAGE_TEMPLATE
			rendered_text = direct_template
			for k, v in ctx.items():
				if k != "pdf_link":
					rendered_text = rendered_text.replace(f"{{{k}}}", str(v))
			rendered_text = _strip_direct_links_from_message(rendered_text)

		# Invoice names contain "/", which is not a valid filename character.
		safe_filename = f"{doc.name.replace('/', '-')}.pdf"

		# Always attach the invoice PDF as requested
		media_url = ctx["pdf_link"]

		res = dispatch_askeva_whatsapp(
			to_number=target_phone,
			send_mode=send_mode,
			template_name=settings.invoice_template_name,
			template_language=settings.invoice_template_language,
			parameters=param_values,
			text_message=rendered_text,
			media_url=media_url,
			document_filename=safe_filename,
			reference_doctype="Sales Invoice",
			reference_name=doc.name
		)

		if res.get("status") == "success":
			mode_label = f"template '{settings.invoice_template_name}'" if send_mode == "Template Message" else "direct document message"
			pf_label = f" (Format: '{chosen_format}')" if chosen_format else ""
			doc.add_comment(
				"Comment",
				f"<b>WhatsApp Notification Sent</b><br>Sales Invoice dispatched to customer mobile <code>+{res.get('number')}</code> using {mode_label}{pf_label} with attached PDF."
			)

			if doc.get("custom_hd_ticket") and frappe.db.exists("HD Ticket", doc.custom_hd_ticket):
				try:
					t_doc = frappe.get_doc("HD Ticket", doc.custom_hd_ticket)
					t_doc.add_comment(
						"Comment",
						f"<b>Sales Invoice {doc.name}</b> sent to customer via WhatsApp (<code>+{res.get('number')}</code>) with attached PDF."
					)
				except Exception:
					pass

			frappe.db.commit()

		return res

	finally:
		frappe.cache().delete_value(lock_key)


@frappe.whitelist()
def get_askeva_templates() -> dict:
	"""
	Fetch all approved Meta WhatsApp templates from AskEva API.
	Enables testing API credentials and displaying available templates in AskEva Settings.
	"""
	settings = frappe.get_single("AskEva Settings")
	api_token = (
		settings.get_password("api_token", raise_exception=False)
		or settings.get_password("webhook_token", raise_exception=False)
	)
	if not api_token:
		return {
			"status": "error",
			"message": _("AskEva Send Message API Token is not configured in AskEva Settings.")
		}

	url = "https://backend.askeva.io/v1/templates"
	headers = {
		"Authorization": f"Bearer {api_token}",
		"Content-Type": "application/json"
	}
	try:
		resp = requests.get(url, params={"token": api_token}, headers=headers, timeout=15)
		if resp.status_code != 200:
			return {
				"status": "error",
				"message": f"AskEva API returned HTTP {resp.status_code}: {resp.text}"
			}

		data = resp.json().get("data", [])
		templates = []
		import re
		for t in data:
			body_text = ""
			header_format = None
			for c in t.get("components", []):
				c_type = (c.get("type") or "").upper()
				if c_type == "BODY":
					body_text = c.get("text", "")
				elif c_type == "HEADER":
					header_format = (c.get("format") or "TEXT").upper()
			param_matches = re.findall(r"\{\{(\d+)\}\}", body_text)
			templates.append({
				"name": t.get("name"),
				"language": t.get("language") or "en",
				"status": t.get("status"),
				"category": t.get("category"),
				"rejected_reason": t.get("rejected_reason"),
				"body": body_text,
				"param_count": len(param_matches),
				"header_format": header_format,
				"has_document_header": (header_format == "DOCUMENT"),
				"components": t.get("components", []),
			})

		# Cache templates for quick capability lookups
		frappe.cache().set_value("askeva_templates_cache", templates, expires_in_sec=600)

		return {
			"status": "success",
			"templates": templates,
			"total": len(templates)
		}
	except Exception as e:
		return {
			"status": "error",
			"message": f"Failed to connect to AskEva: {str(e)}"
		}
