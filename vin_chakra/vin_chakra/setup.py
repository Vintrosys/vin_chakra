import frappe

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
			{'fieldname': 'custom_purchase_year', 'fieldtype': 'Select', 'label': 'Purchase Year', 'options': '2010\n2011\n2012\n2013\n2014\n2015\n2016\n2017\n2018\n2019\n2020\n2021\n2022\n2023\n2024\n2025\n2026', 'reqd': 0},
			{'fieldname': 'subject', 'fieldtype': 'Data', 'label': 'Subject', 'reqd': 1}
		]
		for f in fields:
			doc.append('web_form_fields', f)
		doc.insert(ignore_permissions=True)
		frappe.db.commit()
		print("Web form created")
	else:
		print("Web form 'raise-a-ticket' already exists.")

def configure_hr_settings():
	if frappe.db.exists("DocType", "HR Settings"):
		hr_settings = frappe.get_single("HR Settings")
		hr_settings.allow_geolocation_tracking = 1
		hr_settings.allow_employee_checkin_from_mobile_app = 1
		hr_settings.save(ignore_permissions=True)
		frappe.db.commit()
		print("HR Settings configured with geolocation tracking enabled.")

def run_setup():
	print("Starting post-install/migrate setup for Vin Chakra...")

	try:
		create_chief_technician_role()
	except Exception as e:
		frappe.log_error(message=f"Setup Ticket Status Error: {e}", title="Vin Chakra Setup Error")

	try:
		create_web_form()
	except Exception as e:
		frappe.log_error(message=f"Setup Web Form Error: {e}", title="Vin Chakra Setup Error")

	try:
		configure_hr_settings()
	except Exception as e:
		frappe.log_error(message=f"Setup HR Settings Error: {e}", title="Vin Chakra Setup Error")

	print("Vin Chakra setup execution complete.")
