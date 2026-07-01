import frappe

def create_pending_status():
	if not frappe.db.exists("HD Ticket Status", "Pending"):
		doc = frappe.get_doc({
			"doctype": "HD Ticket Status",
			"name": "Pending",
			"status_name": "Pending",
			"label_agent": "Pending",
			"label_customer": "Pending",
			"color": "Gray",
			"category": "Open",
			"order": 3
		})
		doc.insert(ignore_permissions=True)
		frappe.db.commit()
		print("Status 'Pending' created successfully.")
	else:
		print("Status 'Pending' already exists.")

def create_working_status():
	if not frappe.db.exists("HD Ticket Status", "Working"):
		doc = frappe.get_doc({
			"doctype": "HD Ticket Status",
			"name": "Working",
			"status_name": "Working",
			"label_agent": "Working",
			"label_customer": "Working",
			"color": "Orange",
			"category": "Open",
			"order": 2
		})
		doc.insert(ignore_permissions=True)
		frappe.db.commit()
		print("Status 'Working' created successfully.")
	else:
		print("Status 'Working' already exists.")

def create_chief_technician_role():
	if not frappe.db.exists("Role", "Chief Technician"):
		doc = frappe.get_doc({
			"doctype": "Role",
			"role_name": "Chief Technician",
			"desk_access": 1
		})
		doc.insert(ignore_permissions=True)
		frappe.db.commit()
		print("Role 'Chief Technician' created successfully.")
	else:
		print("Role 'Chief Technician' already exists.")

def create_rule():
	if not frappe.db.exists('Assignment Rule', 'Assign Ticket to Admin and Chief Technician'):
		doc = frappe.new_doc('Assignment Rule')
		doc.name = 'Assign Ticket to Admin and Chief Technician'
		doc.document_type = 'HD Ticket'
		doc.rule = 'Round Robin'
		doc.assign_condition = 'True'
		for day in ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']:
			doc.append('assignment_days', {'day': day})
		doc.append('users', {'user': 'Administrator'})
		doc.description = 'Assign all new HD tickets to Administrator and Chief Technician'
		doc.insert(ignore_permissions=True)
		frappe.db.commit()
		print("Assignment Rule created")
	else:
		print("Assignment Rule already exists")

def create_dashboard_page():
	page_name = "chief-technician-das"
	if not frappe.db.exists("Page", page_name):
		doc = frappe.get_doc({
			"doctype": "Page",
			"page_name": page_name,
			"title": "Chief Technician Dashboard",
			"module": "Vin Chakra",
			"standard": "Yes"
		})
		doc.insert(ignore_permissions=True)
		frappe.db.commit()
		print("Page chief-technician-das created successfully")
	else:
		print("Page chief-technician-das already exists")

def create_technician_portal_page():
	page_name = "technician-portal"
	if not frappe.db.exists("Page", page_name):
		doc = frappe.get_doc({
			"doctype": "Page",
			"page_name": page_name,
			"title": "Technician Portal",
			"module": "Vin Chakra",
			"standard": "Yes"
		})
		doc.insert(ignore_permissions=True)
		frappe.db.commit()
		print("Page technician-portal created successfully")
	else:
		print("Page technician-portal already exists")

def create_web_form():
	if not frappe.db.exists('Web Form', 'raise-a-ticket'):
		doc = frappe.new_doc('Web Form')
		doc.title = 'Raise a Ticket'
		doc.route = 'raise-ticket'
		doc.doc_type = 'HD Ticket'
		doc.module = 'vin_chakra'
		doc.is_standard = 1
		doc.published = 1
		doc.login_required = 0
		doc.allow_multiple = 1
		doc.allow_incomplete = 0
		doc.success_message = 'Your ticket has been raised successfully.'
		fields = [
			{'fieldname': 'custom_customer_name', 'fieldtype': 'Data', 'label': 'Customer Name', 'reqd': 1},
			{'fieldname': 'custom_customer_mobile_number', 'fieldtype': 'Phone', 'label': 'Customer Mobile Number', 'reqd': 1},
			{'fieldname': 'custom_state', 'fieldtype': 'Data', 'label': 'State', 'reqd': 1},
			{'fieldname': 'custom_city__district_', 'fieldtype': 'Data', 'label': 'City / District', 'reqd': 1},
			{'fieldname': 'custom_address', 'fieldtype': 'Small Text', 'label': 'Address', 'reqd': 1},
			{'fieldname': 'custom_date', 'fieldtype': 'Date', 'label': 'Date', 'reqd': 1},
			{'fieldname': 'custom_machine_problem', 'fieldtype': 'Link', 'options': 'Machine Problem', 'label': 'Machine Problem', 'reqd': 1, 'allow_read_on_all_link_options': 1},
			{'fieldname': 'custom_purchased_at_sree_chakra_sewing_systems', 'fieldtype': 'Select', 'options': 'Yes\nNo', 'label': 'Purchased at Sree Chakra Sewing Systems'},
			{'fieldname': 'subject', 'fieldtype': 'Data', 'label': 'Subject', 'reqd': 1}
		]
		for f in fields:
			doc.append('web_form_fields', f)
		doc.insert(ignore_permissions=True)
		frappe.db.commit()
		print("Web form created")
	else:
		doc = frappe.get_doc('Web Form', 'raise-a-ticket')
		updated = False
		for f in doc.web_form_fields:
			if f.fieldname == 'custom_machine_problem' and not f.allow_read_on_all_link_options:
				f.allow_read_on_all_link_options = 1
				updated = True
		fields_to_keep = [f for f in doc.web_form_fields if f.fieldname not in ('custom_machine_name', 'description')]
		if len(fields_to_keep) != len(doc.web_form_fields):
			doc.web_form_fields = fields_to_keep
			updated = True
		if updated:
			doc.save(ignore_permissions=True)
			frappe.db.commit()
			print("Web form updated")
		else:
			print("Web form already exists")


def enforce_field_visibility():
	"""Ensure Machine Name and Description fields are hidden on HD Ticket."""
	# Hide custom_machine_name (Custom Field)
	if frappe.db.exists("Custom Field", "HD Ticket-custom_machine_name"):
		frappe.db.set_value("Custom Field", "HD Ticket-custom_machine_name", {
			"hidden": 1,
			"reqd": 0
		})

	# Hide description (core DocField) via Property Setter
	for prop, val, prop_type in [("hidden", "1", "Check"), ("reqd", "0", "Check")]:
		ps_name = f"HD Ticket-description-{prop}"
		if not frappe.db.exists("Property Setter", ps_name):
			frappe.get_doc({
				"doctype": "Property Setter",
				"name": ps_name,
				"doctype_or_field": "DocField",
				"doc_type": "HD Ticket",
				"field_name": "description",
				"property": prop,
				"value": val,
				"property_type": prop_type,
				"is_system_generated": 0
			}).insert(ignore_permissions=True)
		else:
			frappe.db.set_value("Property Setter", ps_name, "value", val)

	frappe.db.commit()
	frappe.clear_cache(doctype="HD Ticket")
	print("Field visibility enforced: Machine Name and Description hidden.")


def run_setup():
	print("Starting post-install/migrate setup for Vin Chakra...")

	try:
		create_pending_status()
		create_working_status()
		create_chief_technician_role()
	except Exception as e:
		frappe.log_error(message=f"Setup Ticket Status Error: {e}", title="Vin Chakra Setup Error")

	try:
		create_rule()
	except Exception as e:
		frappe.log_error(message=f"Setup Assignment Rule Error: {e}", title="Vin Chakra Setup Error")

	try:
		create_dashboard_page()
		create_technician_portal_page()
	except Exception as e:
		frappe.log_error(message=f"Setup Pages Error: {e}", title="Vin Chakra Setup Error")

	try:
		create_web_form()
	except Exception as e:
		frappe.log_error(message=f"Setup Web Form Error: {e}", title="Vin Chakra Setup Error")

	try:
		enforce_field_visibility()
	except Exception as e:
		frappe.log_error(message=f"Enforce Field Visibility Error: {e}", title="Vin Chakra Setup Error")

	try:
		frappe.reload_doc('vin_chakra', 'page', 'chief-technician-das', force=True)
		frappe.reload_doc('vin_chakra', 'page', 'technician-portal', force=True)
		print("Successfully reloaded pages metadata and synchronized role permissions.")
	except Exception as e:
		frappe.log_error(message=f"Reload Pages Meta Error: {e}", title="Vin Chakra Setup Error")

	print("Vin Chakra setup execution complete.")
