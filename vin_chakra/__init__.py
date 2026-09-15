__version__ = "0.0.1"

import frappe

def patch_attach_print():
    if getattr(frappe, "_attach_print_patched", False):
        return

    orig_attach_print = frappe.attach_print

    def custom_attach_print(doctype, name, file_name=None, print_format=None, style=None, html=None, doc=None, lang=None, print_letterhead=None):
        result = orig_attach_print(doctype, name, file_name, print_format, style, html, doc, lang, print_letterhead)
        
        if doctype == "Quotation" and result and result.get("fcontent"):
            try:
                from vin_chakra.utils.pdf_merger import merge_machine_catalogs
                merged_content = merge_machine_catalogs(result["fcontent"], doctype, name)
                result["fcontent"] = merged_content
            except Exception as e:
                frappe.logger().error(f"Error merging machine catalogs for email: {e}")
                
        return result

    frappe.attach_print = custom_attach_print
    frappe._attach_print_patched = True

try:
    patch_attach_print()
except Exception:
    pass
