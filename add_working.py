import frappe
def run():
    frappe.init(site="chakra.local")
    frappe.connect()
    
    if not frappe.db.exists("HD Ticket Status", "Working"):
        doc = frappe.new_doc("HD Ticket Status")
        doc.label_agent = "Working"
        doc.label_customer = "Working"
        doc.color = "Orange"
        doc.category = "Open"
        doc.order = 2
        doc.insert(ignore_permissions=True)
        frappe.db.commit()
        print("Working status created.")
    else:
        print("Working status already exists.")

run()
