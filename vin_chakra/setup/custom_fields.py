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
        ]
    }

    create_custom_fields(custom_fields)
    frappe.db.commit()
    print("Custom fields for Machine Catalog created successfully.")
