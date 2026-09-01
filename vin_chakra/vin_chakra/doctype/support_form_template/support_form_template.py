import frappe
from frappe.model.document import Document

class SupportFormTemplate(Document):
	def validate(self):
		meta = frappe.get_meta("HD Ticket")
		valid_fields = {df.fieldname for df in meta.fields}
		for row in self.fields:
			if row.fieldname and row.fieldname not in valid_fields:
				frappe.throw(f"Field '{row.fieldname}' does not exist in HD Ticket doctype")

	def on_update(self):
		sync_web_form(self)



def sync_web_form(doc, method=None):
	"""Sync Support Form Template fields into the raise-a-ticket Web Form."""
	try:
		if not frappe.db.exists("Web Form", "raise-a-ticket"):
			return

		web_form = frappe.get_doc("Web Form", "raise-a-ticket")
		hd_meta = frappe.get_meta("HD Ticket")

		web_form.web_form_fields = []
		for idx, row in enumerate(doc.fields, 1):
			df = hd_meta.get_field(row.fieldname)
			default_label = df.label if df else row.fieldname
			default_reqd = df.reqd if df else 0
			default_fieldtype = df.fieldtype if df else "Data"
			default_options = df.options if df else None

			label = row.label or default_label
			reqd = int(row.reqd) if row.reqd is not None else int(default_reqd or 0)

			web_form.append("web_form_fields", {
				"fieldname": row.fieldname,
				"fieldtype": default_fieldtype,
				"label": label,
				"reqd": reqd,
				"options": default_options,
			})

		in_patch = frappe.flags.in_patch
		frappe.flags.in_patch = True
		try:
			web_form.save(ignore_permissions=True)
		finally:
			frappe.flags.in_patch = in_patch
	except Exception:
		frappe.log_error(frappe.get_traceback(), "Support Form Template Web Form Sync Failed")



