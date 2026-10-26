import json

import frappe


@frappe.whitelist()
@frappe.validate_and_sanitize_search_inputs
def get_email_templates(
	doctype: str,
	txt: str,
	searchfield: str,
	start: int,
	page_len: int,
	filters: dict | str | None = None,
):
	"""Override: browser anuppura filters string-a irundhaalum dict-a maathum."""
	if isinstance(filters, str):
		filters = json.loads(filters)

	reference_doctype = (filters or {}).get("reference_doctype", "")

	return frappe.get_all(
		"Email Template",
		filters={"name": ("like", f"%{txt}%")},
		or_filters=[
			["reference_doctype", "=", reference_doctype],
			["reference_doctype", "is", "not set"],
			["reference_doctype", "=", ""],
		],
		fields=["name", "reference_doctype"],
		limit_start=start,
		limit_page_length=page_len,
		as_list=True,
	)