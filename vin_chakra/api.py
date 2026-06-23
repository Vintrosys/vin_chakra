import frappe
import json
import random
from typing import Union


@frappe.whitelist(allow_guest=True)
def get_form_schema() -> dict:
	"""Return the Web Form field schema for dynamic form rendering."""
	web_form = frappe.get_doc("Web Form", "raise-a-ticket")

	form_fields = []
	for f in web_form.web_form_fields:
		if f.hidden:
			continue

		options_list = []
		if f.fieldtype == "Select" and f.options:
			options_list = [opt.strip() for opt in f.options.split("\n") if opt.strip()]
		elif f.fieldtype == "Link" and f.options:
			try:
				options_list = frappe.get_all(f.options, pluck="name")
			except Exception:
				options_list = []

		form_fields.append({
			"fieldname": f.fieldname,
			"fieldtype": f.fieldtype,
			"label": f.label,
			"reqd": f.reqd,
			"options": options_list
		})

	return {
		"title": web_form.title,
		"fields": form_fields
	}


@frappe.whitelist(allow_guest=True)
def submit_ticket(data: Union[dict, str]) -> dict:
	"""Create a new HD Ticket from the public form submission."""
	if isinstance(data, str):
		data = json.loads(data)

	try:
		# VULNERABILITY FIX: Prevent Mass Assignment by validating against Web Form fields
		web_form = frappe.get_doc("Web Form", "raise-a-ticket")
		allowed_fields = [f.fieldname for f in web_form.web_form_fields if not f.hidden]
		
		doc = frappe.new_doc("HD Ticket")
		meta = frappe.get_meta("HD Ticket")
		phone_fields = {df.fieldname for df in meta.fields if df.fieldtype == "Phone"}

		for key, value in data.items():
			if key in allowed_fields:
				# Auto-prefix +91- for Phone fields if no country code present
				if key in phone_fields and value and not value.startswith("+"):
					value = "+91-" + value
				doc.set(key, value)

		# Generate a random 4-digit Service OTP
		otp = str(random.randint(1000, 9999))
		doc.custom_service_otp = otp

		doc.insert(ignore_permissions=True)
		frappe.db.commit()

		# Trigger Customer Notification SMS via api.co3.live
		if doc.custom_customer_mobile_number:
			try:
				from vin_chakra.vin_chakra.co3_sms import send_sms
				settings = frappe.get_single("CO3 SMS Settings")
				if settings.enabled:
					dlt_template_id = settings.ticket_creation_dlt_id
					# Fallback matches the DLT-registered OTP template exactly
					raw_template = settings.ticket_creation_template or \
						"Dear Customer, OTP for your service request: {otp}. Share it with the technician after service completion. - Sree Chakra"
					# Handle DLT template format {#var#}
					if "{#var#}" in raw_template:
						# First {#var#} is OTP, second is validity
						message = raw_template.replace("{#var#}", otp, 1)
						if "{#var#}" in message:
							message = message.replace("{#var#}", "24 hours", 1)
					else:
						# Fallback for named placeholders
						message = raw_template.replace("{otp}", otp).replace("{ticket_id}", doc.name)
					
					send_sms(doc.custom_customer_mobile_number, message, dlt_template_id, ticket=doc.name)
			except Exception as ex:
				frappe.log_error(f"Error sending ticket creation SMS: {str(ex)}", "CO3 SMS Send Failure")

		return {"status": "success", "ticket_name": doc.name}
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Ticket Submission Failed")
		return {"status": "error", "message": str(e)}
