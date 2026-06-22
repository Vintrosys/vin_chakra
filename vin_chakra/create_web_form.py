import frappe

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
