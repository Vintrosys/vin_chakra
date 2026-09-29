import frappe

def remove_empty_items(doc, method=None):
	"""Remove rows with empty item_code from items table before validating Sales Invoice."""
	if hasattr(doc, "items") and doc.items:
		doc.items = [row for row in doc.items if row.item_code and str(row.item_code).strip()]
		for idx, row in enumerate(doc.items, 1):
			row.idx = idx
