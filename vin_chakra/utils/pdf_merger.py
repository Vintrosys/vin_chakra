import frappe
from pypdf import PdfReader, PdfWriter
import io
import os
from frappe.utils.print_format import download_pdf as orig_download_pdf

def get_file_path(file_url):
    """Get absolute file path from file_url."""
    if file_url.startswith("/private/files/"):
        return frappe.get_site_path("private", "files", file_url.split("/private/files/")[1])
    elif file_url.startswith("/files/"):
        return frappe.get_site_path("public", "files", file_url.split("/files/")[1])
    return None

def merge_machine_catalogs(original_pdf_bytes, doctype, name):
    if doctype != "Quotation":
        return original_pdf_bytes

    doc = frappe.get_doc(doctype, name)
    catalog_urls = []
    
    # Collect all unique machine_catalog URLs from items
    for item in doc.get("items"):
        if item.get("machine_catalog"):
            if item.machine_catalog not in catalog_urls:
                catalog_urls.append(item.machine_catalog)
    
    if not catalog_urls:
        return original_pdf_bytes
        
    writer = PdfWriter()
    
    # Add the original Quotation PDF
    original_pdf = PdfReader(io.BytesIO(original_pdf_bytes))
    for page in original_pdf.pages:
        writer.add_page(page)
        
    # Append each catalog PDF
    for file_url in catalog_urls:
        file_path = get_file_path(file_url)
        if file_path and os.path.exists(file_path):
            try:
                catalog_pdf = PdfReader(file_path)
                for page in catalog_pdf.pages:
                    writer.add_page(page)
            except Exception as e:
                frappe.logger().error(f"Failed to merge catalog {file_path}: {e}")
                
    output_stream = io.BytesIO()
    writer.write(output_stream)
    return output_stream.getvalue()

@frappe.whitelist()
def custom_download_pdf(doctype, name, format=None, doc=None, no_letterhead=0, language=None, letterhead=None):
    # Call original method to let it set up frappe.local.response
    orig_download_pdf(doctype, name, format, doc, no_letterhead, language, letterhead)
    
    # Merge the machine catalogs into the generated PDF
    if doctype == "Quotation" and hasattr(frappe.local, "response") and frappe.local.response.get("filecontent"):
        try:
            merged_pdf = merge_machine_catalogs(frappe.local.response.filecontent, doctype, name)
            frappe.local.response.filecontent = merged_pdf
        except Exception as e:
            frappe.logger().error(f"Error merging machine catalogs: {e}")
