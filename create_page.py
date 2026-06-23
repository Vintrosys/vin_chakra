import frappe

def create_pages():
    frappe.init(site="chakra.local", sites_path="../../sites")
    frappe.connect()
    
    pages = [
        {
            "page_name": "chief-technician-das",
            "title": "Chief Technician Dashboard",
            "module": "Vin Chakra",
            "standard": "Yes"
        },
        {
            "page_name": "technician-portal",
            "title": "Technician Portal",
            "module": "Vin Chakra",
            "standard": "Yes"
        }
    ]
    
    for page_data in pages:
        if not frappe.db.exists("Page", page_data["page_name"]):
            doc = frappe.get_doc({
                "doctype": "Page",
                **page_data
            })
            doc.insert(ignore_permissions=True)
            frappe.db.commit()
            print(f"Page '{page_data['title']}' created successfully.")
        else:
            print(f"Page '{page_data['title']}' already exists.")

if __name__ == "__main__":
    create_pages()
