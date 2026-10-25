import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

def execute():
    custom_fields = {
        "Item": [
            {
                "fieldname": "machine_catalog",
                "label": "Machine Catalog",
                "fieldtype": "Attach",
                "insert_after": "item_group"
            }
        ],
        "Quotation Item": [
            {
                "fieldname": "machine_catalog",
                "label": "Machine Catalog",
                "fieldtype": "Attach",
                "fetch_from": "item_code.machine_catalog",
                "insert_after": "item_code"
            }
        ],
        "Sales Invoice": [
            {
                "fieldname": "custom_hd_ticket",
                "label": "HD Ticket",
                "fieldtype": "Link",
                "options": "HD Ticket",
                "insert_after": "customer",
                "read_only": 0,
                "no_copy": 1
            }
        ]
    }

    create_custom_fields(custom_fields)
    frappe.db.commit()
    print("Custom fields for Machine Catalog created successfully.")
