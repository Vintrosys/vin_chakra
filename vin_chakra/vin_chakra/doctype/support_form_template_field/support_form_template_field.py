import frappe
from frappe.model.document import Document

class SupportFormTemplateField(Document):
	def validate(self):
		if self.fieldname:
			meta = frappe.get_meta("HD Ticket")
			valid_fields = {df.fieldname for df in meta.fields}
			if self.fieldname not in valid_fields:
				frappe.throw(f"Field '{self.fieldname}' does not exist in HD Ticket doctype")
