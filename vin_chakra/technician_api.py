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
		fields=["machine_type", "machine_name", "machine_brand", "machine_quantity", "machine_problem", "purchased_at_scs", "purchase_year"],
		order_by="idx asc",
	)

	return {
		"name": ticket.name,
		"subject": ticket.subject,
		"description": ticket.description,
		"status": ticket.status,
		"priority": ticket.priority,
		"custom_customer_name": ticket.custom_customer_name,
		"custom_customer_mobile_number": ticket.custom_customer_mobile_number,
		"custom__secondary_phone_number": ticket.get("custom__secondary_phone_number") or ticket.get("custom_secondary_phone_number") or "",
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
	}


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
def technician_checkin(ticket_name: str, latitude: float, longitude: float, location_address: str = "", otp_phone_type: str = "primary", secondary_phone: str = "", skip_otp: Union[bool, int, str] = False, accuracy: float = None) -> dict:
	"""
	Record check-in for a ticket:
	- Verifies day attendance is marked
	- Updates custom__secondary_phone_number if provided
	- Generates a fresh Service OTP (unless skip_otp is True or ticket status is Pending)
	- Sends OTP SMS to chosen phone number (if not skipping OTP)
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
	if secondary_phone:
		sec_phone_clean = secondary_phone.strip()
		if sec_phone_clean and not sec_phone_clean.startswith("+"):
			sec_phone_clean = "+91-" + sec_phone_clean
		ticket.custom__secondary_phone_number = sec_phone_clean
		if hasattr(ticket, "custom_secondary_phone_number"):
			ticket.custom_secondary_phone_number = sec_phone_clean

	sms_sent = False
	sms_msg = ""
	target_phone = None

	if not should_skip_otp:
		# Determine target phone for OTP
		if str(otp_phone_type).lower() == "secondary":
			target_phone = ticket.get("custom__secondary_phone_number") or ticket.get("custom_secondary_phone_number") or secondary_phone
			if target_phone:
				target_phone = target_phone.strip()
				if not target_phone.startswith("+"):
					target_phone = "+91-" + target_phone
			if not target_phone:
				return {"status": "error", "message": _("Secondary phone number is empty. Please enter a secondary phone number.")}
		else:
			target_phone = ticket.custom_customer_mobile_number
			if not target_phone:
				return {"status": "error", "message": _("Customer mobile number is empty.")}

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
def resend_otp(ticket_name: str, otp_phone_type: str = "primary", secondary_phone: str = "") -> dict:
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

	if secondary_phone:
		sec_phone_clean = secondary_phone.strip()
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

	if str(otp_phone_type).lower() == "secondary":
		target_phone = ticket.get("custom__secondary_phone_number") or ticket.get("custom_secondary_phone_number") or secondary_phone
		if target_phone:
			target_phone = target_phone.strip()
			if not target_phone.startswith("+"):
				target_phone = "+91-" + target_phone
		if not target_phone:
			return {"status": "error", "message": _("Secondary phone number is empty.")}
	else:
		target_phone = ticket.custom_customer_mobile_number
		if not target_phone:
			return {"status": "error", "message": _("Customer mobile number is empty.")}

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
