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

def create_rule():
	if not frappe.db.exists('Assignment Rule', 'Assign Ticket to Admin and Chief Technician'):
		doc = frappe.new_doc('Assignment Rule')
		doc.name = 'Assign Ticket to Admin and Chief Technician'
		doc.document_type = 'HD Ticket'
		doc.rule = 'Assign Ticket to Admin and Chief Technician'
		doc.assign_condition = 'True'
		for day in ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']:
			doc.append('assignment_days', {'day': day})
		doc.append('users', {'user': 'Administrator'})
		doc.append('users', {'user': 'chieftechnician@gmail.com'})
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
	if not frappe.db.exists('Web Form', 'raise-ticket'):
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
			{'fieldname': 'custom_machine_name', 'fieldtype': 'Link', 'options': 'Item', 'label': 'Machine Name', 'reqd': 1},
			{'fieldname': 'custom_machine_problem', 'fieldtype': 'Link', 'options': 'Machine Problem', 'label': 'Machine Problem', 'reqd': 1},
			{'fieldname': 'custom_purchased_at_sree_chakra_sewing_systems', 'fieldtype': 'Select', 'options': 'Yes\nNo', 'label': 'Purchased at Sree Chakra Sewing Systems'},
			{'fieldname': 'subject', 'fieldtype': 'Data', 'label': 'Subject', 'reqd': 1},
			{'fieldname': 'description', 'fieldtype': 'Text Editor', 'label': 'Detailed Explanation', 'reqd': 1}
		]
		for f in fields:
			doc.append('web_form_fields', f)
		doc.insert(ignore_permissions=True)
		frappe.db.commit()
		print("Web form created")
	else:
		print("Web form already exists")


def run_setup():
	print("Starting post-install/migrate setup for Vin Chakra...")

	try:
		create_pending_status()
	except Exception as e:
		frappe.log_error(message=f"Setup Pending Status Error: {e}", title="Vin Chakra Setup Error")

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
		frappe.reload_doc('vin_chakra', 'page', 'chief-technician-das', force=True)
		frappe.reload_doc('vin_chakra', 'page', 'technician-portal', force=True)
		print("Successfully reloaded pages metadata and synchronized role permissions.")
	except Exception as e:
		frappe.log_error(message=f"Reload Pages Meta Error: {e}", title="Vin Chakra Setup Error")

	print("Vin Chakra setup execution complete.")
