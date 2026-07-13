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
			custom_address,
			custom_city__district_,
			custom_state,
			custom_machine_name,
			custom_machine_problem,
			custom_date,
			creation,
			modified
		FROM `tabHD Ticket`
		WHERE JSON_SEARCH(`_assign`, 'one', {user}) IS NOT NULL
		ORDER BY creation DESC
		""".format(user=escaped_user),
		as_dict=True,
	)
	return tickets


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

	return {
		"name": ticket.name,
		"subject": ticket.subject,
		"description": ticket.description,
		"status": ticket.status,
		"priority": ticket.priority,
		"custom_customer_name": ticket.custom_customer_name,
		"custom_customer_mobile_number": ticket.custom_customer_mobile_number,
		"custom_address": ticket.custom_address,
		"custom_city__district_": ticket.custom_city__district_,
		"custom_state": ticket.custom_state,
		"custom_machine_name": ticket.custom_machine_name,
		"custom_machine_problem": ticket.custom_machine_problem,
		"custom_date": str(ticket.custom_date) if ticket.custom_date else "",
		"custom_service_otp": ticket.custom_service_otp,
		"check_log": check_log,
		"pending_reason_options": pending_reason_options,
		"mop_options": mop_options,
		"gst_options": gst_options,
	}


@frappe.whitelist()
def technician_checkin(ticket_name: str, latitude: float, longitude: float, location_address: str = "") -> dict:
	"""
	Record check-in for a ticket:
	- Appends a 'Check-in' row to the child table
	- Updates ticket status → 'Working'
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

	# Prevent double check-in (if already checked in and not checked out)
	existing_logs = frappe.get_all(
		"HD Ticket Check Log",
		filters={"parent": ticket_name, "parenttype": "HD Ticket"},
		fields=["check_type"],
		order_by="timestamp desc",
	)
	if existing_logs and existing_logs[0].check_type == "Check-in":
		return {"status": "error", "message": "Already checked in. Please check out first."}

	now = now_datetime()

	# Append child row
	ticket.append("custom_check_log", {
		"check_type": "Check-in",
		"timestamp": now,
		"technician": user,
		"latitude": float(latitude),
		"longitude": float(longitude),
		"location_address": location_address,
	})

	# Update status to Working
	ticket.status = "Working"
	ticket.flags.from_technician_api = True
	ticket.save(ignore_permissions=True)
	frappe.db.commit()

	return {
		"status": "success",
		"message": "Checked in successfully. Ticket status set to Working.",
		"timestamp": str(now),
	}


@frappe.whitelist()
def technician_checkout(ticket_name: str, otp: str, latitude: float, longitude: float, location_address: str = "", mode_of_payment: str = "", gst_bill_required: str = "") -> dict:
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
def technician_mark_pending(ticket_name: str, reason: str, latitude: float, longitude: float, location_address: str = "", custom_reason: str = "") -> dict:
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
	"""Get current check-in status for the day for the logged-in technician."""
	user = frappe.session.user
	if user == "Guest":
		return {"status": "error", "message": "Authentication required."}
	
	employees = frappe.get_all("Employee", filters={"user_id": user, "status": "Active"}, pluck="name")
	if not employees:
		return {"status": "error", "message": "No active Employee found for current user."}
	
	employee_id = employees[0]
	
	# Get the latest check-in for today
	today = frappe.utils.today()
	latest_log = frappe.get_all(
		"Employee Checkin",
		filters={"employee": employee_id, "time": ["like", f"{today}%"]},
		fields=["log_type"],
		order_by="time desc",
		limit=1
	)
	
	if latest_log and latest_log[0].log_type == "IN":
		return {"status": "success", "state": "IN"}
	
	return {"status": "success", "state": "OUT"}

@frappe.whitelist()
def mark_day_attendance(log_type: str, latitude: float, longitude: float) -> dict:
	"""Mark Day Attendance (IN or OUT) for the technician."""
	user = frappe.session.user
	if user == "Guest":
		return {"status": "error", "message": "Authentication required."}
		
	if log_type not in ["IN", "OUT"]:
		return {"status": "error", "message": "Invalid log type."}
	
	employees = frappe.get_all("Employee", filters={"user_id": user, "status": "Active"}, pluck="name")
	if not employees:
		return {"status": "error", "message": "No active Employee found for current user."}
	
	employee_id = employees[0]
	
	try:
		checkin = frappe.get_doc({
			"doctype": "Employee Checkin",
			"employee": employee_id,
			"time": frappe.utils.now_datetime(),
			"log_type": log_type,
			"latitude": float(latitude),
			"longitude": float(longitude),
			"device_id": "Technician Portal"
		})
		checkin.insert(ignore_permissions=True)
		frappe.db.commit()
		
		return {
			"status": "success", 
			"message": f"Successfully checked {log_type.lower()}.",
			"state": log_type
		}
	except Exception as e:
		frappe.log_error("Day Attendance Checkin Failed", str(e))
		return {"status": "error", "message": str(e)}
