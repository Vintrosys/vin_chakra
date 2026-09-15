import frappe
from pypdf import PdfWriter
import io
import os

def execute():
    frappe.init(site="chakra.localhost")
    frappe.connect()
    
    try:
        from vin_chakra.utils.pdf_merger import merge_machine_catalogs
        
        # Create a dummy base Quotation PDF since wkhtmltopdf is missing
        writer = PdfWriter()
        # Add a blank page to represent the Quotation PDF
        writer.add_blank_page(width=595, height=842) # A4 size
        base_pdf_stream = io.BytesIO()
        writer.write(base_pdf_stream)
        dummy_base_pdf = base_pdf_stream.getvalue()
        
        # Now merge the machine catalogs for the Quotation
        merged_pdf_content = merge_machine_catalogs(dummy_base_pdf, "Quotation", "SCSS_26-27/CR/004")
        
        out_path = "/home/ramya/.gemini/antigravity-ide/brain/e70bb192-176c-436c-84e9-ad106cd8229f/Final_Merged_Quotation.pdf"
        with open(out_path, "wb") as f:
            f.write(merged_pdf_content)
            
        print(f"Generated successfully at {out_path}")
    except Exception as e:
        print(f"Error: {e}")
        
if __name__ == "__main__":
    execute()
