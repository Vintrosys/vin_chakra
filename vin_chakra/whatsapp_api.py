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

import hmac
import json
import re
from typing import Optional

import frappe
from frappe import _
from frappe.utils import today

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
	cust.customer_name = (name or "WhatsApp Customer").strip()
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
	doc.subject = subject or f"WhatsApp Service Request - {ctx.get('customer_name') or ctx.get('mobile') or 'Customer'}"
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

	# Lossless capture of all collected form data in the description
	desc_lines = ["<b>Raised via WhatsApp chatbot</b>"]
	if machine_type:
		desc_lines.append(f"Machine Type / Model: {machine_type}")
	if brand:
		desc_lines.append(f"Machine Brand: {brand}")
	if problem:
		desc_lines.append(f"Machine Problem: {problem}")
	if year:
		desc_lines.append(f"Purchase Year: {year}")
	if scss:
		desc_lines.append(f"Purchased at SCSS: {scss}")
	if secondary:
		desc_lines.append(f"Secondary Phone: {secondary}")
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
				results.append(_handle_submission(ev.get("user_number"), ev.get("form_name") or "", ev.get("fields"), user_name=ev.get("user_name") or ""))
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
	return _handle_submission(user_number, form_name, fields, user_name=user_name)


def _handle_submission(user_number, form_name, fields, user_name: str = "") -> dict:
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

	# 1. Audit Log: Insert WhatsApp Form Submission and commit immediately
	sub = frappe.get_doc({
		"doctype": "WhatsApp Form Submission",
		"user_number": user_number,
		"form_name": form_name or form_type,
		"form_type": form_type,
		"received_at": frappe.utils.now_datetime(),
		"processing_status": "Pending",
		"payload": json.dumps(fields, ensure_ascii=False, indent=2, default=str),
	})
	sub.insert(ignore_permissions=True)
	frappe.db.commit()

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
					"type": mtype,
					"is_form": False,
					"form_name": None,
					"fields": {},
					"text": "",
					"profile_name": profile_name,
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
