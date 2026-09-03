import frappe

def execute():
	"""Seed Support Form Template singleton with initial configuration if empty, without overwriting user edits."""
	frappe.clear_cache(doctype="HD Ticket")

	frappe.reload_doc("vin_chakra", "doctype", "support_form_template_field")
	frappe.reload_doc("vin_chakra", "doctype", "support_form_template")

	doc = frappe.get_single("Support Form Template")
	existing_fieldnames = [f.fieldname for f in doc.fields]
	
	if doc.fields:
		# Preserve user modifications. Only append custom_machine_type_list if it is not present.
		if "custom_machine_type_list" not in existing_fieldnames:
			doc.append("fields", {
				"idx": len(doc.fields) + 1,
				"fieldname": "custom_machine_type_list",
				"section": "Machine & Issue Details",
				"step": 2,
				"icon": "wrench",
				"reqd": 1,
			})
			doc.save(ignore_permissions=True)
		return

	fields_config = [
		{"fieldname": "custom_customer_name", "icon": "user", "step": 1, "section": "Customer & Location Info", "reqd": 1},
		{"fieldname": "custom_customer_mobile_number", "icon": "phone", "step": 1, "section": "Customer & Location Info", "reqd": 1},
		{"fieldname": "custom_state", "icon": "map", "step": 1, "section": "Customer & Location Info", "reqd": 1},
		{"fieldname": "custom_city__district_", "icon": "pin", "step": 1, "section": "Customer & Location Info", "reqd": 1},
		{"fieldname": "custom_address", "icon": "home", "step": 1, "section": "Customer & Location Info", "reqd": 1},
		{"fieldname": "custom_date", "icon": "calendar", "step": 1, "section": "Customer & Location Info", "reqd": 1},
		{"fieldname": "custom_machine_type_list", "icon": "wrench", "step": 2, "section": "Machine & Issue Details", "reqd": 1},
		{"fieldname": "custom_machine_name", "icon": "tag", "step": 2, "section": "Machine & Issue Details", "reqd": 0},
		{"fieldname": "custom_machine_problem", "icon": "wrench", "step": 2, "section": "Machine & Issue Details", "reqd": 0},
		{"fieldname": "custom_purchased_at_sree_chakra_sewing_systems", "icon": "tag", "step": 2, "section": "Machine & Issue Details", "reqd": 0},
		{"fieldname": "custom_purchase_year", "icon": "calendar", "step": 2, "section": "Machine & Issue Details", "reqd": 0},
		{"fieldname": "subject", "icon": "tag", "step": 2, "section": "Machine & Issue Details", "reqd": 1},
	]

	for idx, f in enumerate(fields_config, 1):
		doc.append("fields", {
			"idx": idx,
			"fieldname": f["fieldname"],
			"section": f["section"],
			"step": f["step"],
			"icon": f["icon"],
			"reqd": f["reqd"],
		})

	doc.save(ignore_permissions=True)
