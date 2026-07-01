import frappe

frappe.init(site="chakra.local")
frappe.connect()

web_form = frappe.get_doc("Web Form", "raise-a-ticket")

new_fields = []
for f in web_form.web_form_fields:
    if f.fieldname in ["custom_machine_name", "description"]:
        continue
    if f.fieldname == "custom_machine_problem":
        f.allow_read_on_all_link_options = 1
    new_fields.append(f)

web_form.web_form_fields = new_fields
web_form.save(ignore_permissions=True)
frappe.db.commit()
print("Web Form updated in DB")
