import frappe
import json
import random
from typing import Union


@frappe.whitelist(allow_guest=True)
def get_form_schema() -> dict:
	"""Return the Web Form field schema for dynamic form rendering."""
	web_form = frappe.get_doc("Web Form", "raise-a-ticket")

	form_fields = []
	has_purchase_year = False
	
	for f in web_form.web_form_fields:
		if f.fieldname == "custom_purchase_year":
			has_purchase_year = True
			f.hidden = 0  # Force unhide for the API response

		if getattr(f, 'hidden', 0):
			continue

		options_list = []
		if f.fieldtype == "Select" and f.options:
			options_list = [opt.strip() for opt in f.options.split("\n") if opt.strip()]
		elif f.fieldtype == "Link" and f.options:
			try:
				options_list = frappe.get_all(f.options, pluck="name", ignore_permissions=True)
			except Exception:
				options_list = []

		form_fields.append({
			"fieldname": f.fieldname,
			"fieldtype": f.fieldtype,
			"label": f.label,
			"reqd": f.reqd,
			"options": options_list
		})

	if not has_purchase_year:
		form_fields.append({
			"fieldname": "custom_purchase_year",
			"fieldtype": "Select",
			"label": "Purchase Year",
			"reqd": 1,
			"options": [str(year) for year in range(2010, 2027)]
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
		allowed_fields = [f.fieldname for f in web_form.web_form_fields if not getattr(f, 'hidden', 0)]
		if "custom_purchase_year" not in allowed_fields:
			allowed_fields.append("custom_purchase_year")
		
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
		# Suppress Frappe's auto-assignment "Already in ToDo list" msgprint
		# that leaks to the client via the JSON response's _server_messages field.
		frappe.local.message_log = []
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


@frappe.whitelist()
def get_ticket_info(ticket_name: str) -> dict:
	"""Return ticket document values, meta fields, and options for popup modal editing."""
	if not ticket_name:
		frappe.throw("Ticket ID is required")

	if not frappe.has_permission("HD Ticket", "read", doc=ticket_name):
		frappe.throw("No permission to view this ticket", frappe.PermissionError)

	doc = frappe.get_doc("HD Ticket", ticket_name)
	meta = frappe.get_meta("HD Ticket")

	# Fetch template fields configured in HD Ticket Template (defaulting to 'Default')
	template_name = doc.get("template") or "Default"
	template_fields = frappe.get_all(
		"HD Ticket Template Field",
		filters={"parent": template_name},
		pluck="fieldname",
		order_by="idx"
	)

	if not template_fields and template_name != "Default":
		template_fields = frappe.get_all(
			"HD Ticket Template Field",
			filters={"parent": "Default"},
			pluck="fieldname",
			order_by="idx"
		)

	core_fieldnames = ["subject", "status", "priority", "ticket_type", "agent_group", "raised_by", "customer"]

	ignored_fieldtypes = ["Section Break", "Column Break", "Tab Break", "HTML", "Button", "Fold"]
	ignored_fieldnames = ["amended_from", "docstatus", "name", "owner", "creation", "modified", "modified_by"]

	meta_fields_dict = {df.fieldname: df for df in meta.fields}

	ordered_fieldnames = []
	for fn in core_fieldnames:
		if fn in meta_fields_dict and fn not in ordered_fieldnames:
			ordered_fieldnames.append(fn)

	for fn in template_fields:
		if fn in meta_fields_dict and fn not in ordered_fieldnames:
			ordered_fieldnames.append(fn)

	fields_meta = []
	options_map = {}

	for fn in ordered_fieldnames:
		df = meta_fields_dict[fn]
		if df.fieldtype in ignored_fieldtypes or df.fieldname in ignored_fieldnames:
			continue

		field_info = {
			"fieldname": df.fieldname,
			"label": df.label or df.fieldname,
			"fieldtype": df.fieldtype,
			"options": df.options,
			"reqd": df.reqd,
			"read_only": df.read_only,
			"hidden": df.hidden
		}
		fields_meta.append(field_info)

		if df.fieldtype == "Select" and df.options:
			opts = [o.strip() for o in df.options.split("\n") if o.strip()]
			options_map[df.fieldname] = opts
		elif df.fieldtype == "Link" and df.options:
			try:
				link_opts = frappe.get_all(df.options, pluck="name", limit_page_length=500, ignore_permissions=True)
				options_map[df.fieldname] = link_opts
			except Exception:
				options_map[df.fieldname] = []

	return {
		"status": "success",
		"ticket_name": ticket_name,
		"doc": doc.as_dict(),
		"fields": fields_meta,
		"options": options_map,
		"core_fields": core_fieldnames,
		"template_fields": template_fields
	}



@frappe.whitelist()
def update_ticket_info(ticket_name: str, values: Union[dict, str]) -> dict:
	"""Update HD Ticket fields from the popup modal."""
	if not ticket_name:
		frappe.throw("Ticket ID is required")

	if isinstance(values, str):
		values = json.loads(values)

	if not frappe.has_permission("HD Ticket", "write", doc=ticket_name):
		frappe.throw("No permission to edit this ticket", frappe.PermissionError)

	doc = frappe.get_doc("HD Ticket", ticket_name)
	meta = frappe.get_meta("HD Ticket")
	valid_fieldnames = {df.fieldname for df in meta.fields if not df.read_only and df.fieldtype not in ["Section Break", "Column Break", "Tab Break"]}

	updated_count = 0
	for k, v in values.items():
		if k in valid_fieldnames:
			doc.set(k, v)
			updated_count += 1

	if updated_count > 0:
		doc.save(ignore_permissions=True)
		frappe.db.commit()

	return {
		"status": "success",
		"message": f"Updated {updated_count} fields successfully",
		"ticket": doc.as_dict()
	}

