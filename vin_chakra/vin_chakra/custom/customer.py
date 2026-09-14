import frappe

def sync_secondary_phone_to_contact(doc, method=None):
	"""
	When custom_secondary_phone is set on Customer, add it as a new row in the phone_nos child table
	of Customer's linked Contact (or doc.phone_nos if phone_nos exists on Customer).
	"""
	if not getattr(doc, "custom_secondary_phone", None):
		return

	sec_phone = str(doc.custom_secondary_phone).strip()
	if not sec_phone:
		return

	# 1. If Customer itself has a phone_nos child table directly
	if hasattr(doc, "phone_nos") and isinstance(doc.phone_nos, list):
		existing_phones = [str(r.phone).strip() for r in doc.phone_nos if getattr(r, "phone", None)]
		if sec_phone not in existing_phones:
			doc.append("phone_nos", {"phone": sec_phone})

	# 2. Sync to linked Contact(s)
	contact_names = []
	if getattr(doc, "customer_primary_contact", None):
		contact_names.append(doc.customer_primary_contact)

	# Also search for contacts linked via Dynamic Link
	linked_contacts = frappe.get_all(
		"Dynamic Link",
		filters={
			"link_doctype": "Customer",
			"link_name": doc.name,
			"parenttype": "Contact"
		},
		pluck="parent"
	)
	for c_name in linked_contacts:
		if c_name not in contact_names:
			contact_names.append(c_name)

	if contact_names:
		for contact_name in contact_names:
			if frappe.db.exists("Contact", contact_name):
				contact_doc = frappe.get_doc("Contact", contact_name)
				existing_phones = [str(r.phone).strip() for r in (contact_doc.phone_nos or []) if getattr(r, "phone", None)]
				if sec_phone not in existing_phones:
					contact_doc.append("phone_nos", {
						"phone": sec_phone,
						"is_primary_phone": 0,
						"is_primary_mobile_no": 0
					})
					contact_doc.save(ignore_permissions=True)
	else:
		# If no contact exists yet for this customer, create one
		try:
			contact_doc = frappe.get_doc({
				"doctype": "Contact",
				"first_name": doc.customer_name or doc.name,
				"links": [{
					"link_doctype": "Customer",
					"link_name": doc.name
				}],
				"phone_nos": []
			})
			if getattr(doc, "mobile_no", None):
				contact_doc.append("phone_nos", {
					"phone": str(doc.mobile_no).strip(),
					"is_primary_phone": 1,
					"is_primary_mobile_no": 1
				})
			contact_doc.append("phone_nos", {
				"phone": sec_phone,
				"is_primary_phone": 0 if getattr(doc, "mobile_no", None) else 1,
				"is_primary_mobile_no": 0
			})
			contact_doc.insert(ignore_permissions=True)
			frappe.db.set_value("Customer", doc.name, "customer_primary_contact", contact_doc.name)
		except Exception as e:
			frappe.log_error(title="Customer Secondary Phone Sync Error", message=f"Failed to create Contact for Customer {doc.name}: {str(e)}")
