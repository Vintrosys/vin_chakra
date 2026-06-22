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
