import frappe

def execute():
	"""Seed Support Form Template record with initial configuration if empty, without overwriting user edits."""
	frappe.clear_cache(doctype="HD Ticket")

	frappe.reload_doc("vin_chakra", "doctype", "support_form_template_field")
	frappe.reload_doc("vin_chakra", "doctype", "support_form_template")

	if frappe.db.exists("Support Form Template", "Default"):
		doc = frappe.get_doc("Support Form Template", "Default")
	else:
		existing = frappe.get_all("Support Form Template", pluck="name")
		if existing:
			doc = frappe.get_doc("Support Form Template", existing[0])
		else:
			doc = frappe.new_doc("Support Form Template")
			doc.template_name = "Default"
			doc.is_default = 1

	fields_config = [
		{"fieldname": "customer", "icon": "user", "step": 1, "section": "Customer & Location Info", "reqd": 1},
		{"fieldname": "custom_date", "icon": "calendar", "step": 1, "section": "Customer & Location Info", "reqd": 1},
		{"fieldname": "custom_machine_type_list", "icon": "wrench", "step": 2, "section": "Machine & Issue Details", "reqd": 1},
		{"fieldname": "subject", "icon": "tag", "step": 2, "section": "Machine & Issue Details", "reqd": 1},
		{"fieldname": "ticket_type", "icon": "tag", "step": 2, "section": "Machine & Issue Details", "reqd": 1},
	]

	# If doc has old legacy fields (e.g. custom_customer_name), clear and re-populate clean fields
	target_fieldnames = {f["fieldname"] for f in fields_config}
	existing_fieldnames = [f.fieldname for f in doc.fields] if doc.fields else []

	if not doc.fields or any(fn not in target_fieldnames for fn in existing_fieldnames):
		doc.fields = []
		for idx, f in enumerate(fields_config, 1):
			doc.append("fields", {
				"idx": idx,
				"fieldname": f["fieldname"],
				"section": f["section"],
				"step": f["step"],
				"icon": f["icon"],
				"reqd": f["reqd"],
			})

	if doc.is_new():
		doc.insert(ignore_permissions=True)
	else:
		doc.save(ignore_permissions=True)
