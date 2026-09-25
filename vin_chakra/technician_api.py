from typing import Dict, List, Optional, Union

import frappe
from frappe import _
from frappe.utils import now_datetime


def _is_technician(user=None):
	"""Returns True if the user is a regular agent/technician (not a manager/admin)."""
	if not user:
		user = frappe.session.user
	if user == "Administrator":
		return False
	roles = frappe.get_roles(user)
	return not ({"Agent Manager", "System Manager"} & set(roles))


def enrich_tickets_customer_details(tickets: Union[List[dict], dict]) -> Union[List[dict], dict]:
	"""
	Enrich ticket dictionary/dictionaries with customer details.
	If HD Ticket fields (custom_customer_name, custom_customer_mobile_number, custom_address, etc.)
	are empty or blank, retrieve details from linked Customer, Contact, and Address doctypes.
	Also resolves the valid Customer docname (Link ID) if customer field is missing or unlinked.
	"""
	if not tickets:
		return tickets

	is_single = isinstance(tickets, dict)
	ticket_list = [tickets] if is_single else tickets

	# Gather customer and contact names for bulk fetching
	customer_ids = list({t.get("customer") for t in ticket_list if t.get("customer")})
	contact_ids = list({t.get("contact") for t in ticket_list if t.get("contact")})

	# Gather missing customer names & phones for secondary lookup
	missing_names = list({t.get("custom_customer_name") for t in ticket_list if t.get("custom_customer_name") and not t.get("customer")})
	missing_phones = list({t.get("custom_customer_mobile_number") for t in ticket_list if t.get("custom_customer_mobile_number") and not t.get("customer")})

	cust_map = {}
	if customer_ids:
		cust_rows = frappe.get_all(
			"Customer",
			filters={"name": ["in", customer_ids]},
			fields=["name", "customer_name", "mobile_no", "customer_primary_contact", "customer_primary_address", "custom_secondary_phone"]
		)
		for c in cust_rows:
			cust_map[c.name] = c
			if c.customer_primary_contact and c.customer_primary_contact not in contact_ids:
				contact_ids.append(c.customer_primary_contact)

	if missing_names:
		name_rows = frappe.get_all(
			"Customer",
			filters={"customer_name": ["in", missing_names]},
			fields=["name", "customer_name", "mobile_no", "customer_primary_contact", "customer_primary_address", "custom_secondary_phone"]
		)
		for c in name_rows:
			if c.customer_name not in cust_map:
				cust_map[c.customer_name] = c

	if missing_phones:
		phone_rows = frappe.get_all(
			"Customer",
			filters={"mobile_no": ["in", missing_phones]},
			fields=["name", "customer_name", "mobile_no", "customer_primary_contact", "customer_primary_address", "custom_secondary_phone"]
		)
		for c in phone_rows:
			if c.mobile_no not in cust_map:
				cust_map[c.mobile_no] = c

	# Fetch primary addresses
	address_ids = list({c.customer_primary_address for c in cust_map.values() if isinstance(c, dict) and c.get("customer_primary_address")})
	addr_map = {}
	if address_ids:
		addr_rows = frappe.get_all(
			"Address",
			filters={"name": ["in", address_ids]},
			fields=["name", "address_line1", "city", "state"]
		)
		for a in addr_rows:
			addr_map[a.name] = a

	# Fetch address links for customers without customer_primary_address
	missing_addr_cust_ids = [c_id for c_id, c in cust_map.items() if isinstance(c, dict) and not c.get("customer_primary_address")]
	dyn_link_map = {}
	if missing_addr_cust_ids:
		dyn_links = frappe.get_all(
			"Dynamic Link",
			filters={"link_doctype": "Customer", "link_name": ["in", missing_addr_cust_ids], "parenttype": "Address"},
			fields=["link_name", "parent"]
		)
		extra_addr_ids = [d.parent for d in dyn_links if d.parent not in addr_map]
		if extra_addr_ids:
			extra_addrs = frappe.get_all(
				"Address",
				filters={"name": ["in", extra_addr_ids]},
				fields=["name", "address_line1", "city", "state"]
			)
			for a in extra_addrs:
				addr_map[a.name] = a
		dyn_link_map = {d.link_name: d.parent for d in dyn_links}

	# Fetch contact details
	contact_map = {}
	if contact_ids:
		c_rows = frappe.get_all(
			"Contact",
			filters={"name": ["in", contact_ids]},
			fields=["name", "first_name", "last_name", "mobile_no", "phone"]
		)
		for c in c_rows:
			full_name = f"{c.first_name or ''} {c.last_name or ''}".strip()
			contact_map[c.name] = {
				"full_name": full_name,
				"phone": c.mobile_no or c.phone or ""
			}

	# Enrich each ticket
	for t in ticket_list:
		c_id = t.get("customer")
		cust_doc = None
		if c_id and c_id in cust_map:
			cust_doc = cust_map[c_id]
		elif t.get("custom_customer_name") and t.get("custom_customer_name") in cust_map:
			cust_doc = cust_map[t.get("custom_customer_name")]
		elif t.get("custom_customer_mobile_number") and t.get("custom_customer_mobile_number") in cust_map:
			cust_doc = cust_map[t.get("custom_customer_mobile_number")]

		if cust_doc:
			t["customer"] = cust_doc.get("name")

		# 1. Customer Name
		if not t.get("custom_customer_name") or str(t.get("custom_customer_name")).strip() == "":
			if cust_doc and cust_doc.get("customer_name"):
				t["custom_customer_name"] = cust_doc.customer_name
			elif t.get("contact") and contact_map.get(t.get("contact"), {}).get("full_name"):
				t["custom_customer_name"] = contact_map[t.get("contact")]["full_name"]
			elif c_id:
				t["custom_customer_name"] = c_id

		# 2. Customer Mobile Number
		if not t.get("custom_customer_mobile_number") or str(t.get("custom_customer_mobile_number")).strip() == "":
			if cust_doc and cust_doc.get("mobile_no"):
				t["custom_customer_mobile_number"] = cust_doc.mobile_no
			elif t.get("contact") and contact_map.get(t.get("contact"), {}).get("phone"):
				t["custom_customer_mobile_number"] = contact_map[t.get("contact")]["phone"]

		# 3. Address
		if not t.get("custom_address") or str(t.get("custom_address")).strip() == "":
			addr_obj = None
			if cust_doc and cust_doc.get("customer_primary_address"):
				addr_obj = addr_map.get(cust_doc.customer_primary_address)
			elif cust_doc and dyn_link_map.get(cust_doc.get("name")):
				addr_obj = addr_map.get(dyn_link_map[cust_doc.get("name")])
			
			if addr_obj:
				t["custom_address"] = addr_obj.get("address_line1") or ""
				if not t.get("custom_city__district_"):
					t["custom_city__district_"] = addr_obj.get("city") or ""
				if not t.get("custom_state"):
					t["custom_state"] = addr_obj.get("state") or ""

		# 4. Secondary phone
		if not t.get("custom__secondary_phone_number") and cust_doc and cust_doc.get("custom_secondary_phone"):
			t["custom__secondary_phone_number"] = cust_doc.custom_secondary_phone

	return ticket_list[0] if is_single else ticket_list


@frappe.whitelist()
def get_invoice_init_details(ticket_name: str = None, customer: str = None, phone: str = None) -> dict:
	"""
	Helper method to resolve valid Customer Link ID, Phone number, and Machine Type List before creating a Sales Invoice.
	"""
	customer_id = ""
	customer_name = ""
	phone_num = (phone or "").strip()
	if phone_num == "N/A":
		phone_num = ""

	machines = []

	if ticket_name and frappe.db.exists("HD Ticket", ticket_name):
		t_dict = get_ticket_detail(ticket_name)
		customer_id = t_dict.get("customer") or ""
		customer_name = t_dict.get("custom_customer_name") or ""
		if not phone_num:
			phone_num = t_dict.get("primary_phone") or t_dict.get("custom_customer_mobile_number") or ""
		machines = t_dict.get("custom_machine_type_list") or []

	if customer and customer != "N/A":
		cust_str = str(customer).strip()
		if frappe.db.exists("Customer", cust_str):
			customer_id = cust_str
			customer_name = frappe.db.get_value("Customer", cust_str, "customer_name") or cust_str
		else:
			cust_by_name = frappe.db.get_value(
				"Customer",
				{"customer_name": cust_str},
				["name", "customer_name", "mobile_no"],
				as_dict=True
			)
			if cust_by_name:
				customer_id = cust_by_name.name
				customer_name = cust_by_name.customer_name
				if not phone_num and cust_by_name.mobile_no:
					phone_num = cust_by_name.mobile_no

	if customer_id and not phone_num:
		phone_num = frappe.db.get_value("Customer", customer_id, "mobile_no") or ""

	return {
		"customer_id": customer_id,
		"customer_name": customer_name,
		"phone": phone_num,
		"machines": machines
	}


# ---------------------------------------------------------------------------
# Called from the www page (requires login)
# ---------------------------------------------------------------------------

@frappe.whitelist()
def get_my_tickets() -> list:
	"""Return all HD Tickets assigned to the logged-in technician."""
	user = frappe.session.user
	if user == "Guest":
		frappe.throw(_("You must be logged in to view your tickets."), frappe.PermissionError)

	escaped_user = frappe.db.escape(user)
	tickets = frappe.db.sql(
		"""
		SELECT
			name,
			subject,
			status,
			priority,
			custom_customer_name,
			custom_customer_mobile_number,
			custom__secondary_phone_number,
			custom_address,
			custom_city__district_,
			custom_state,
			custom_machine_name,
			custom_machine_problem,
			custom_date,
			creation,
			modified,
			customer,
			contact
		FROM `tabHD Ticket`
		WHERE JSON_SEARCH(`_assign`, 'one', {user}) IS NOT NULL
		ORDER BY creation DESC
		""".format(user=escaped_user),
		as_dict=True,
	)
	return enrich_tickets_customer_details(tickets)


def _verify_day_attendance(user):
	"""Verify if user has checked in for today (log_type == 'IN' on current date)."""
	if user == "Administrator":
		return True
	employees = frappe.get_all("Employee", filters={"user_id": user, "status": "Active"}, pluck="name")
	if not employees:
		return False
	
	employee_id = employees[0]
	today_start = f"{frappe.utils.today()} 00:00:00"
	today_end = f"{frappe.utils.today()} 23:59:59"

	# Get the latest check-in log for today from HRMS / Employee Checkin
	logs_today = frappe.get_all(
		"Employee Checkin",
		filters={
			"employee": employee_id,
			"time": ["between", [today_start, today_end]]
		},
		fields=["log_type"],
		order_by="time desc",
		limit=1
	)
	
	return bool(logs_today and logs_today[0].log_type == "IN")


def _send_otp_sms(ticket, target_mobile_number):
	"""Send service OTP SMS via CO3 SMS integration."""
	if not target_mobile_number:
		return False
	try:
		from vin_chakra.vin_chakra.co3_sms import send_sms
		settings = frappe.get_single("CO3 SMS Settings")
		if settings.enabled:
			dlt_template_id = settings.ticket_creation_dlt_id
			raw_template = settings.ticket_creation_template or \
				"Dear Customer, OTP for your service request: {otp}. Share it with the technician after service completion. - Sree Chakra"
			otp = ticket.custom_service_otp
			if "{#var#}" in raw_template:
				message = raw_template.replace("{#var#}", otp, 1)
				if "{#var#}" in message:
					message = message.replace("{#var#}", "24 hours", 1)
			else:
				message = raw_template.replace("{otp}", otp).replace("{ticket_id}", ticket.name)
			
			return send_sms(target_mobile_number, message, dlt_template_id, ticket=ticket.name)
	except Exception as ex:
		frappe.log_error(f"Error sending ticket OTP SMS: {str(ex)}", "CO3 SMS Send Failure")
	return False


def _get_ticket_phone_numbers(ticket):
	"""
	Fetch phone numbers for a ticket from:
	1. Linked Contact's phone_nos child table (Row 1 / is_primary = Primary, subsequent rows = Secondary)
	2. Linked Customer's phone_nos child table or custom_secondary_phone
	3. Ticket's custom_customer_mobile_number & custom__secondary_phone_number
	"""
	phone_nos_list = []

	customer_name = ticket.get("customer")
	contact_name = ticket.get("contact")

	if not contact_name and customer_name:
		contact_name = frappe.db.get_value("Customer", customer_name, "customer_primary_contact")
		if not contact_name:
			c_names = frappe.get_all(
				"Dynamic Link",
				filters={"link_doctype": "Customer", "link_name": customer_name, "parenttype": "Contact"},
				pluck="parent"
			)
			if c_names:
				contact_name = c_names[0]

	if contact_name and frappe.db.exists("Contact", contact_name):
		c_doc = frappe.get_doc("Contact", contact_name)
		if hasattr(c_doc, "phone_nos") and c_doc.phone_nos:
			for idx, r in enumerate(c_doc.phone_nos):
				p = (r.phone or "").strip()
				if p:
					is_prim = bool(r.is_primary_phone or r.is_primary_mobile_no or idx == 0)
					if not any(item["phone"] == p for item in phone_nos_list):
						phone_nos_list.append({
							"phone": p,
							"is_primary": is_prim,
							"idx": len(phone_nos_list) + 1
						})

	if customer_name and frappe.db.exists("Customer", customer_name):
		cust_doc = frappe.get_doc("Customer", customer_name)
		if hasattr(cust_doc, "phone_nos") and cust_doc.phone_nos:
			for idx, r in enumerate(cust_doc.phone_nos):
				p = (r.phone or "").strip()
				if p and not any(item["phone"] == p for item in phone_nos_list):
					phone_nos_list.append({
						"phone": p,
						"is_primary": len(phone_nos_list) == 0,
						"idx": len(phone_nos_list) + 1
					})
		cust_sec = getattr(cust_doc, "custom_secondary_phone", None)
		if cust_sec and str(cust_sec).strip():
			p = str(cust_sec).strip()
			if not any(item["phone"] == p for item in phone_nos_list):
				phone_nos_list.append({
					"phone": p,
					"is_primary": len(phone_nos_list) == 0,
					"idx": len(phone_nos_list) + 1
				})

	t_primary = (ticket.custom_customer_mobile_number or "").strip()
	if t_primary and not any(item["phone"] == t_primary for item in phone_nos_list):
		if not any(item["is_primary"] for item in phone_nos_list):
			phone_nos_list.insert(0, {"phone": t_primary, "is_primary": True, "idx": 1})
		else:
			phone_nos_list.append({"phone": t_primary, "is_primary": False, "idx": len(phone_nos_list) + 1})

	t_sec = (ticket.get("custom__secondary_phone_number") or ticket.get("custom_secondary_phone_number") or "").strip()
	if t_sec and not any(item["phone"] == t_sec for item in phone_nos_list):
		phone_nos_list.append({"phone": t_sec, "is_primary": False, "idx": len(phone_nos_list) + 1})

	primary_phone = ""
	secondary_phones = []

	for item in phone_nos_list:
		if item["is_primary"] and not primary_phone:
			primary_phone = item["phone"]

	if not primary_phone and phone_nos_list:
		primary_phone = phone_nos_list[0]["phone"]
		phone_nos_list[0]["is_primary"] = True

	for item in phone_nos_list:
		if item["phone"] != primary_phone and item["phone"] not in secondary_phones:
			secondary_phones.append(item["phone"])

	return {
		"primary_phone": primary_phone,
		"secondary_phones": secondary_phones,
		"phone_nos_list": phone_nos_list
	}


@frappe.whitelist()
def get_ticket_detail(ticket_name: str) -> dict:
	"""Return full ticket detail for the technician, including check log."""
	user = frappe.session.user
	if user == "Guest":
		frappe.throw(_("Authentication required."), frappe.PermissionError)

	ticket = frappe.get_doc("HD Ticket", ticket_name)

	# Verify this ticket is assigned to the technician
	import json
	assigned = json.loads(ticket._assign or "[]")
	if user != "Administrator" and user not in assigned:
		roles = frappe.get_roles(user)
		if not ({"Agent Manager", "System Manager"} & set(roles)):
			frappe.throw(_("You do not have permission to view this ticket."), frappe.PermissionError)

	check_log = frappe.get_all(
		"HD Ticket Check Log",
		filters={"parent": ticket_name, "parenttype": "HD Ticket"},
		fields=["check_type", "timestamp", "technician", "latitude", "longitude", "location_address"],
		order_by="timestamp asc",
	)

	meta = frappe.get_meta("HD Ticket")
	pending_reason_field = meta.get_field("custom_pending_reason")
	pending_reason_options = pending_reason_field.options.split("\n") if pending_reason_field and pending_reason_field.options else ["Test", "Others"]

	mop_field = meta.get_field("custom_mode_of_payment")
	mop_options = mop_field.options.split("\n") if mop_field and mop_field.options else ["Cash", "UPI", "Bank Transfer"]

	gst_field = meta.get_field("custom_gst_bill_required")
	gst_options = gst_field.options.split("\n") if gst_field and gst_field.options else ["Yes", "No"]

	machine_type_list = frappe.get_all(
		"Machine type list",
		filters={"parent": ticket_name, "parenttype": "HD Ticket"},
		fields=["machine_type", "machine_name", "machine_brand", "machine_quantity", "machine_problem", "purchased_at_scs", "purchase_year", "model_no"],
		order_by="idx asc",
	)

	phone_info = _get_ticket_phone_numbers(ticket)

	t_dict = {
		"name": ticket.name,
		"subject": ticket.subject,
		"description": ticket.description,
		"status": ticket.status,
		"priority": ticket.priority,
		"custom_customer_name": ticket.custom_customer_name,
		"custom_customer_mobile_number": ticket.custom_customer_mobile_number,
		"custom__secondary_phone_number": ticket.get("custom__secondary_phone_number") or ticket.get("custom_secondary_phone_number") or "",
		"primary_phone": phone_info["primary_phone"],
		"secondary_phones": phone_info["secondary_phones"],
		"phone_nos_list": phone_info["phone_nos_list"],
		"custom_address": ticket.custom_address,
		"custom_city__district_": ticket.custom_city__district_,
		"custom_state": ticket.custom_state,
		"custom_machine_name": ticket.custom_machine_name,
		"custom_machine_problem": ticket.custom_machine_problem,
		"custom_date": str(ticket.custom_date) if ticket.custom_date else "",
		"custom_service_otp": ticket.custom_service_otp,
		"custom_machine_type_list": machine_type_list,
		"check_log": check_log,
		"pending_reason_options": pending_reason_options,
		"mop_options": mop_options,
		"gst_options": gst_options,
		"customer": ticket.get("customer"),
		"contact": ticket.get("contact"),
	}
	return enrich_tickets_customer_details(t_dict)


@frappe.whitelist()
def check_active_ticket(current_ticket_name: str = None) -> dict:
	"""Check if the technician already has an active working ticket."""
	user = frappe.session.user
	if user == "Guest":
		frappe.throw(_("Authentication required."), frappe.PermissionError)

	if current_ticket_name:
		active_ticket = frappe.db.sql(
			"""
			SELECT name FROM `tabHD Ticket`
			WHERE status = 'Working'
			  AND JSON_SEARCH(`_assign`, 'one', %s) IS NOT NULL
			  AND name != %s
			LIMIT 1
			""",
			(user, current_ticket_name)
		)
	else:
		active_ticket = frappe.db.sql(
			"""
			SELECT name FROM `tabHD Ticket`
			WHERE status = 'Working'
			  AND JSON_SEARCH(`_assign`, 'one', %s) IS NOT NULL
			LIMIT 1
			""",
			(user,)
		)

	if active_ticket:
		ticket_name = active_ticket[0][0]
		return {
			"has_active": True,
			"ticket_name": ticket_name,
			"message": f"Please close your existing ticket ({ticket_name}) before checking into a new one."
		}

	return {"has_active": False}


@frappe.whitelist()
def technician_checkin(ticket_name: str, latitude: float, longitude: float, location_address: str = "", otp_phone_type: str = "primary", secondary_phone: str = "", selected_phone: str = "", skip_otp: Union[bool, int, str] = False, accuracy: float = None) -> dict:
	"""
	Record check-in for a ticket:
	- Verifies day attendance is marked
	- Updates custom__secondary_phone_number if provided
	- Generates a fresh Service OTP (unless skip_otp is True or ticket status is Pending)
	- Sends OTP SMS to chosen phone number (from phone_nos table or direct selection)
	- Appends a 'Check-in' row to the child table
	- Updates ticket status → 'Working'
	"""
	user = frappe.session.user
	if user == "Guest":
		frappe.throw(_("Authentication required."), frappe.PermissionError)

	# 1. Day Attendance Verification
	if not _verify_day_attendance(user):
		return {
			"status": "error",
			"message": _("You must check in your day attendance first before checking into a ticket.")
		}

	ticket = frappe.get_doc("HD Ticket", ticket_name)

	# Permission check
	import json
	assigned = json.loads(ticket._assign or "[]")
	if user != "Administrator" and user not in assigned:
		roles = frappe.get_roles(user)
		if not ({"Agent Manager", "System Manager"} & set(roles)):
			frappe.throw(_("You are not assigned to this ticket."), frappe.PermissionError)

	# Check if technician is already working on another ticket
	active_ticket = frappe.db.sql(
		"""
		SELECT name FROM `tabHD Ticket`
		WHERE status = 'Working'
		  AND JSON_SEARCH(`_assign`, 'one', %s) IS NOT NULL
		  AND name != %s
		LIMIT 1
		""",
		(user, ticket_name)
	)
	if active_ticket:
		return {
			"status": "error",
			"message": f"Please close your existing ticket ({active_ticket[0][0]}) before checking into a new one."
		}

	# Prevent double check-in
	existing_logs = frappe.get_all(
		"HD Ticket Check Log",
		filters={"parent": ticket_name, "parenttype": "HD Ticket"},
		fields=["check_type"],
		order_by="timestamp desc",
	)
	if existing_logs and existing_logs[0].check_type == "Check-in":
		return {"status": "error", "message": "Already checked in. Please check out first."}

	# Parse skip_otp option
	if isinstance(skip_otp, str):
		skip_otp = frappe.parse_json(skip_otp)
	should_skip_otp = bool(skip_otp) or (ticket.status == "Pending")

	# Update secondary phone if provided
	eff_sec_phone = selected_phone or secondary_phone
	if eff_sec_phone and str(otp_phone_type).lower() == "secondary":
		sec_phone_clean = eff_sec_phone.strip()
		if sec_phone_clean and not sec_phone_clean.startswith("+"):
			sec_phone_clean = "+91-" + sec_phone_clean
		ticket.custom__secondary_phone_number = sec_phone_clean
		if hasattr(ticket, "custom_secondary_phone_number"):
			ticket.custom_secondary_phone_number = sec_phone_clean

	sms_sent = False
	sms_msg = ""
	target_phone = None

	if not should_skip_otp:
		phone_info = _get_ticket_phone_numbers(ticket)
		if selected_phone and selected_phone.strip():
			target_phone = selected_phone.strip()
		elif str(otp_phone_type).lower() == "secondary":
			target_phone = secondary_phone or (phone_info["secondary_phones"][0] if phone_info["secondary_phones"] else "")
		else:
			target_phone = phone_info["primary_phone"] or ticket.custom_customer_mobile_number

		if target_phone:
			target_phone = target_phone.strip()
			if not target_phone.startswith("+"):
				target_phone = "+91-" + target_phone
		else:
			return {"status": "error", "message": _("Target phone number is empty. Please select or enter a valid mobile number.")}

		# Generate a random 4-digit Service OTP
		import random
		otp = str(random.randint(1000, 9999))
		ticket.custom_service_otp = otp

	now = now_datetime()

	# Append child row
	ticket.append("custom_check_log", {
		"check_type": "Check-in",
		"timestamp": now,
		"technician": user,
		"latitude": float(latitude),
		"longitude": float(longitude),
		"accuracy": float(accuracy) if accuracy is not None else None,
		"location_address": location_address,
	})

	# Update status to Working
	ticket.status = "Working"
	ticket.flags.from_technician_api = True
	ticket.save(ignore_permissions=True)
	frappe.db.commit()

	if not should_skip_otp and target_phone:
		# Trigger OTP SMS
		sms_sent = _send_otp_sms(ticket, target_phone)
		sms_msg = f" OTP sent to {target_phone}." if sms_sent else " (Note: SMS delivery failed or disabled)."

	return {
		"status": "success",
		"message": f"Checked in successfully. Ticket status set to Working.{sms_msg}",
		"timestamp": str(now),
		"otp_sent": sms_sent
	}


@frappe.whitelist()
def resend_otp(ticket_name: str, otp_phone_type: str = "primary", secondary_phone: str = "", selected_phone: str = "") -> dict:
	"""Resend OTP SMS for an active ticket."""
	user = frappe.session.user
	if user == "Guest":
		frappe.throw(_("Authentication required."), frappe.PermissionError)

	ticket = frappe.get_doc("HD Ticket", ticket_name)

	import json
	assigned = json.loads(ticket._assign or "[]")
	if user != "Administrator" and user not in assigned:
		roles = frappe.get_roles(user)
		if not ({"Agent Manager", "System Manager"} & set(roles)):
			frappe.throw(_("You are not assigned to this ticket."), frappe.PermissionError)

	eff_sec_phone = selected_phone or secondary_phone
	if eff_sec_phone and str(otp_phone_type).lower() == "secondary":
		sec_phone_clean = eff_sec_phone.strip()
		if sec_phone_clean and not sec_phone_clean.startswith("+"):
			sec_phone_clean = "+91-" + sec_phone_clean
		ticket.custom__secondary_phone_number = sec_phone_clean
		if hasattr(ticket, "custom_secondary_phone_number"):
			ticket.custom_secondary_phone_number = sec_phone_clean

	if not ticket.custom_service_otp:
		import random
		ticket.custom_service_otp = str(random.randint(1000, 9999))

	ticket.flags.from_technician_api = True
	ticket.save(ignore_permissions=True)
	frappe.db.commit()

	phone_info = _get_ticket_phone_numbers(ticket)
	if selected_phone and selected_phone.strip():
		target_phone = selected_phone.strip()
	elif str(otp_phone_type).lower() == "secondary":
		target_phone = secondary_phone or (phone_info["secondary_phones"][0] if phone_info["secondary_phones"] else "")
	else:
		target_phone = phone_info["primary_phone"] or ticket.custom_customer_mobile_number

	if target_phone:
		target_phone = target_phone.strip()
		if not target_phone.startswith("+"):
			target_phone = "+91-" + target_phone
	else:
		return {"status": "error", "message": _("Mobile number is empty. Please select a phone number.")}

	sms_sent = _send_otp_sms(ticket, target_phone)
	if sms_sent:
		return {"status": "success", "message": f"OTP successfully resent to {target_phone}."}
	else:
		return {"status": "error", "message": "Failed to send OTP SMS. Please check SMS settings or mobile number."}


@frappe.whitelist()
def technician_checkout(ticket_name: str, otp: str, latitude: float, longitude: float, location_address: str = "", mode_of_payment: str = "", gst_bill_required: str = "", accuracy: float = None) -> dict:
	"""
	Validate OTP and record check-out for a ticket:
	- Validates the OTP against custom_service_otp
	- Appends a 'Check-out' row to the child table
	- Updates ticket status → 'Resolved'
	"""
	user = frappe.session.user
	if user == "Guest":
		frappe.throw(_("Authentication required."), frappe.PermissionError)

	ticket = frappe.get_doc("HD Ticket", ticket_name)

	# Permission check
	import json
	assigned = json.loads(ticket._assign or "[]")
	if user != "Administrator" and user not in assigned:
		roles = frappe.get_roles(user)
		if not ({"Agent Manager", "System Manager"} & set(roles)):
			frappe.throw(_("You are not assigned to this ticket."), frappe.PermissionError)

	# Ensure there's an open check-in first
	existing_logs = frappe.get_all(
		"HD Ticket Check Log",
		filters={"parent": ticket_name, "parenttype": "HD Ticket"},
		fields=["check_type"],
		order_by="timestamp desc",
	)
	if not existing_logs or existing_logs[0].check_type != "Check-in":
		return {"status": "error", "message": "No active check-in found. Please check in first."}

	# Validate OTP
	stored_otp = (ticket.custom_service_otp or "").strip()
	if not stored_otp:
		return {"status": "error", "message": "No OTP is set for this ticket. Contact administrator."}

	if str(otp).strip() != stored_otp:
		return {"status": "error", "message": "Invalid OTP. Please ask the customer for the correct OTP."}

	now = now_datetime()

	# Append check-out row
	ticket.append("custom_check_log", {
		"check_type": "Check-out",
		"timestamp": now,
		"technician": user,
		"latitude": float(latitude),
		"longitude": float(longitude),
		"accuracy": float(accuracy) if accuracy is not None else None,
		"location_address": location_address,
	})

	# Update ticket status to Resolved and save custom fields
	ticket.status = "Resolved"
	if mode_of_payment:
		ticket.custom_mode_of_payment = mode_of_payment
	if gst_bill_required:
		ticket.custom_gst_bill_required = gst_bill_required
	ticket.flags.from_technician_api = True
	ticket.save(ignore_permissions=True)
	frappe.db.commit()

	return {
		"status": "success",
		"message": "OTP verified. Checked out successfully. Ticket marked as Resolved.",
		"timestamp": str(now),
	}

@frappe.whitelist()
def technician_mark_pending(ticket_name: str, reason: str, latitude: float, longitude: float, location_address: str = "", custom_reason: str = "", accuracy: float = None) -> dict:
	"""
	Mark a ticket as Pending:
	- Appends a 'Check-out' row to the child table (since they are leaving)
	- Adds a comment to the ticket with the pending reason
	- Updates ticket status → 'Pending'
	- Sets custom_pending_reason and custom_reason
	"""
	user = frappe.session.user
	if user == "Guest":
		frappe.throw(_("Authentication required."), frappe.PermissionError)

	ticket = frappe.get_doc("HD Ticket", ticket_name)

	# Permission check
	import json
	assigned = json.loads(ticket._assign or "[]")
	if user != "Administrator" and user not in assigned:
		roles = frappe.get_roles(user)
		if not ({"Agent Manager", "System Manager"} & set(roles)):
			frappe.throw(_("You are not assigned to this ticket."), frappe.PermissionError)

	if not reason or not str(reason).strip():
		return {"status": "error", "message": "Pending reason is mandatory."}

	# Ensure there's an open check-in first
	existing_logs = frappe.get_all(
		"HD Ticket Check Log",
		filters={"parent": ticket_name, "parenttype": "HD Ticket"},
		fields=["check_type"],
		order_by="timestamp desc",
	)
	if not existing_logs or existing_logs[0].check_type != "Check-in":
		return {"status": "error", "message": "No active check-in found. Please check in first."}

	now = now_datetime()

	# Append check-out row
	ticket.append("custom_check_log", {
		"check_type": "Check-out",
		"timestamp": now,
		"technician": user,
		"latitude": float(latitude),
		"longitude": float(longitude),
		"accuracy": float(accuracy) if accuracy is not None else None,
		"location_address": location_address,
	})

	# Update ticket status to Pending and save reasons
	ticket.status = "Pending"
	ticket.custom_pending_reason = reason
	if reason == "Others" and custom_reason:
		ticket.custom_reason = custom_reason
	else:
		ticket.custom_reason = ""
		
	ticket.flags.from_technician_api = True
	ticket.save(ignore_permissions=True)

	# Add a comment for the pending reason
	comment_reason = f"{reason} - {custom_reason}" if reason == "Others" and custom_reason else reason
	frappe.get_doc({
		"doctype": "Comment",
		"comment_type": "Comment",
		"reference_doctype": "HD Ticket",
		"reference_name": ticket_name,
		"content": f"**Marked as Pending**<br>Reason: {comment_reason}",
	}).insert(ignore_permissions=True)

	frappe.db.commit()

	return {
		"status": "success",
		"message": "Ticket marked as Pending.",
		"timestamp": str(now),
	}

@frappe.whitelist()
def get_day_attendance_status() -> dict:
	"""Get current check-in status for today for the logged-in technician from HRMS, including location metadata."""
	user = frappe.session.user
	if user == "Guest":
		return {"status": "error", "message": "Authentication required."}
	
	employees = frappe.get_all("Employee", filters={"user_id": user, "status": "Active"}, pluck="name")
	if not employees:
		return {"status": "error", "message": "No active Employee found for current user."}
	
	employee_id = employees[0]
	today_start = f"{frappe.utils.today()} 00:00:00"
	today_end = f"{frappe.utils.today()} 23:59:59"

	# Get the latest check-in log for today from HRMS / Employee Checkin
	logs_today = frappe.get_all(
		"Employee Checkin",
		filters={
			"employee": employee_id,
			"time": ["between", [today_start, today_end]]
		},
		fields=["log_type", "latitude", "longitude", "custom_accuracy", "device_id", "time"],
		order_by="time desc",
		limit=1
	)
	
	if logs_today and logs_today[0].log_type == "IN":
		log = logs_today[0]
		return {
			"status": "success",
			"state": "IN",
			"device_id": log.device_id or "hrms",
			"latitude": log.latitude,
			"longitude": log.longitude,
			"accuracy": log.custom_accuracy,
			"time": str(log.time)
		}
	
	latest_log = logs_today[0] if logs_today else None
	return {
		"status": "success",
		"state": "OUT",
		"device_id": latest_log.device_id if latest_log else None,
		"latitude": latest_log.latitude if latest_log else None,
		"longitude": latest_log.longitude if latest_log else None,
		"time": str(latest_log.time) if latest_log else None
	}

@frappe.whitelist()
def mark_day_attendance(log_type: str, latitude: float = None, longitude: float = None, accuracy: float = None, device_id: str = "Technician Portal") -> dict:
	"""Mark Day Attendance (IN or OUT) for the technician with location and device_id."""
	user = frappe.session.user
	if user == "Guest":
		return {"status": "error", "message": "Authentication required."}
		
	if log_type not in ["IN", "OUT"]:
		return {"status": "error", "message": "Invalid log type."}
	
	employees = frappe.get_all("Employee", filters={"user_id": user, "status": "Active"}, pluck="name")
	if not employees:
		return {"status": "error", "message": "No active Employee found for current user."}
	
	employee_id = employees[0]
	
	# Determine device ID: use parameter or default to "Technician Portal"
	effective_device_id = device_id.strip() if device_id and str(device_id).strip() else "Technician Portal"

	try:
		checkin = frappe.get_doc({
			"doctype": "Employee Checkin",
			"employee": employee_id,
			"time": frappe.utils.now_datetime(),
			"log_type": log_type,
			"latitude": float(latitude) if latitude is not None and str(latitude).strip() != "" else None,
			"longitude": float(longitude) if longitude is not None and str(longitude).strip() != "" else None,
			"custom_accuracy": float(accuracy) if accuracy is not None and str(accuracy).strip() != "" else None,
			"device_id": effective_device_id
		})
		checkin.insert(ignore_permissions=True)
		frappe.db.commit()
		
		return {
			"status": "success", 
			"message": f"Successfully checked {log_type.lower()}.",
			"state": log_type,
			"device_id": effective_device_id,
			"latitude": checkin.latitude,
			"longitude": checkin.longitude,
			"accuracy": checkin.custom_accuracy
		}
	except Exception as e:
		frappe.log_error("Day Attendance Checkin Failed", str(e))
		return {"status": "error", "message": str(e)}
