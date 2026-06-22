import frappe

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

