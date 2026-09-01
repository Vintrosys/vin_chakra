import frappe
import json
import random
from typing import Union


@frappe.whitelist(allow_guest=True)
def get_form_schema() -> dict:
	"""Return the field schema grouped by steps and sections for dynamic form rendering."""
	try:
		template = frappe.get_single("Support Form Template")
		if not template.fields:
			return _get_legacy_form_schema()
	except Exception:
		return _get_legacy_form_schema()

	meta = frappe.get_meta("HD Ticket")
	meta_fields = {df.fieldname: df for df in meta.fields}

	steps_map = {}

	for row in sorted(template.fields, key=lambda x: (x.step or 1, x.idx)):
		step_num = int(row.step or 1)
		sec_label = row.section or "General"

		df = meta_fields.get(row.fieldname)
		fieldtype = df.fieldtype if df else "Data"
		default_label = df.label if df else row.fieldname
		default_reqd = df.reqd if df else 0

		options_list = []
		child_fields = []
		if df and df.fieldtype == "Table" and df.options:
			try:
				child_meta = frappe.get_meta(df.options)
				for cdf in child_meta.fields:
					if cdf.fieldtype in ["Section Break", "Column Break"]:
						continue
					c_opts = []
					if cdf.fieldtype == "Select" and cdf.options:
						c_opts = [opt.strip() for opt in cdf.options.split("\n") if opt.strip()]
					elif cdf.fieldtype == "Link" and cdf.options:
						if cdf.options == "Item":
							try:
								items = frappe.get_all("Item", fields=["name", "item_name", "brand"], ignore_permissions=True, limit_page_length=500)
								c_opts = [{"value": item.name, "label": item.item_name or item.name, "item_name": item.item_name or item.name, "brand": item.brand or ""} for item in items]
							except Exception:
								c_opts = []
						else:
							try:
								c_opts = frappe.get_all(cdf.options, pluck="name", ignore_permissions=True, limit_page_length=500)
							except Exception:
								c_opts = []
					child_fields.append({
						"fieldname": cdf.fieldname,
						"fieldtype": cdf.fieldtype,
						"label": cdf.label or cdf.fieldname,
						"reqd": int(cdf.reqd or 0),
						"options": c_opts,
						"fetch_from": cdf.fetch_from
					})
			except Exception:
				child_fields = []
		elif df and df.fieldtype == "Select" and df.options:
			options_list = [opt.strip() for opt in df.options.split("\n") if opt.strip()]
		elif df and df.fieldtype == "Link" and df.options:
			try:
				options_list = frappe.get_all(df.options, pluck="name", ignore_permissions=True)
			except Exception:
				options_list = []

		if row.fieldname == "custom_purchase_year" and not options_list:
			options_list = [str(year) for year in range(2010, 2027)]

		field_info = {
			"fieldname": row.fieldname,
			"fieldtype": fieldtype,
			"label": row.label or default_label,
			"reqd": int(row.reqd) if row.reqd is not None else int(default_reqd or 0),
			"options": df.options if (df and df.fieldtype == "Table") else options_list,
			"child_fields": child_fields,
			"icon": row.icon or "tag"
		}

		if step_num not in steps_map:
			steps_map[step_num] = []

		sections_in_step = steps_map[step_num]
		sec_obj = next((s for s in sections_in_step if s["label"] == sec_label), None)
		if not sec_obj:
			sec_obj = {"label": sec_label, "fields": []}
			sections_in_step.append(sec_obj)

		sec_obj["fields"].append(field_info)

	steps_list = []
	for step_num in sorted(steps_map.keys()):
		steps_list.append({
			"step": step_num,
			"sections": steps_map[step_num]
		})

	web_form_title = "Raise a Support Ticket"
	if frappe.db.exists("Web Form", "raise-a-ticket"):
		web_form_title = frappe.db.get_value("Web Form", "raise-a-ticket", "title") or web_form_title

	return {
		"title": web_form_title,
		"steps": steps_list
	}


def _get_legacy_form_schema() -> dict:
	"""Fallback schema when Support Form Template does not exist or has no rows."""
	web_form = frappe.get_doc("Web Form", "raise-a-ticket")

	form_fields = []
	has_purchase_year = False

	for f in web_form.web_form_fields:
		if f.fieldname == "custom_purchase_year":
			has_purchase_year = True
			f.hidden = 0

		if getattr(f, 'hidden', 0):
			continue

		options_list = []
		if f.fieldtype == "Select" and f.options:
			options_list = [opt.strip() for opt in f.options.split("\n") if opt.strip()]
		elif f.fieldtype == "Link" and f.options:
			try:
				options_list = frappe.get_all(f.options, pluck="name", ignore_permissions=True)
			except Exception:
				options_list = []

		form_fields.append({
			"fieldname": f.fieldname,
			"fieldtype": f.fieldtype,
			"label": f.label,
			"reqd": f.reqd,
			"options": options_list,
			"icon": "tag"
		})

	if not has_purchase_year:
		form_fields.append({
			"fieldname": "custom_purchase_year",
			"fieldtype": "Select",
			"label": "Purchase Year",
			"reqd": 1,
			"options": [str(year) for year in range(2010, 2027)],
			"icon": "calendar"
		})

	step1_keys = {"custom_customer_name", "custom_customer_mobile_number", "custom_state", "custom_city__district_", "custom_address", "custom_date"}
	step1_fields = [f for f in form_fields if f["fieldname"] in step1_keys]
	step2_fields = [f for f in form_fields if f["fieldname"] not in step1_keys]

	steps = [
		{
			"step": 1,
			"sections": [{"label": "Customer & Location Info", "fields": step1_fields}]
		},
		{
			"step": 2,
			"sections": [{"label": "Machine & Issue Details", "fields": step2_fields}]
		}
	]

	return {
		"title": web_form.title,
		"fields": form_fields,
		"steps": steps
	}



@frappe.whitelist(allow_guest=True)
def submit_ticket(data: Union[dict, str]) -> dict:
	"""Create a new HD Ticket from the public form submission."""
	if isinstance(data, str):
		data = json.loads(data)

	try:
		# VULNERABILITY FIX: Prevent Mass Assignment by validating against Web Form fields
		web_form = frappe.get_doc("Web Form", "raise-a-ticket")
		allowed_fields = [f.fieldname for f in web_form.web_form_fields if not getattr(f, 'hidden', 0)]
		if "custom_purchase_year" not in allowed_fields:
			allowed_fields.append("custom_purchase_year")
		if "custom_machine_type_list" not in allowed_fields:
			allowed_fields.append("custom_machine_type_list")

		doc = frappe.new_doc("HD Ticket")
		meta = frappe.get_meta("HD Ticket")
		phone_fields = {df.fieldname for df in meta.fields if df.fieldtype == "Phone"}

		for key, value in data.items():
			if key in allowed_fields:
				if key == "custom_machine_type_list" and isinstance(value, list):
					for row in value:
						if isinstance(row, dict):
							doc.append("custom_machine_type_list", row)
					if value and isinstance(value[0], dict):
						first_row = value[0]
						if first_row.get("machine_problem") and not doc.get("custom_machine_problem"):
							doc.custom_machine_problem = first_row.get("machine_problem")
						if first_row.get("purchased_at_sree_chakra_sewing_systems") and not doc.get("custom_purchased_at_sree_chakra_sewing_systems"):
							doc.custom_purchased_at_sree_chakra_sewing_systems = first_row.get("purchased_at_sree_chakra_sewing_systems")
						if first_row.get("purchase_year") and not doc.get("custom_purchase_year"):
							doc.custom_purchase_year = first_row.get("purchase_year")
				else:
					# Auto-prefix +91- for Phone fields if no country code present
					if key in phone_fields and value and not value.startswith("+"):
						value = "+91-" + value
					doc.set(key, value)

		doc.insert(ignore_permissions=True)
		# Suppress Frappe's auto-assignment "Already in ToDo list" msgprint
		# that leaks to the client via the JSON response's _server_messages field.
		frappe.local.message_log = []
		frappe.db.commit()

		return {"status": "success", "ticket_name": doc.name}
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Ticket Submission Failed")
		return {"status": "error", "message": str(e)}


@frappe.whitelist()
def get_ticket_info(ticket_name: str) -> dict:
	"""Return ticket document values, meta fields, and options for popup modal editing."""
	if not ticket_name:
		frappe.throw("Ticket ID is required")

	if not frappe.has_permission("HD Ticket", "read", doc=ticket_name):
		frappe.throw("No permission to view this ticket", frappe.PermissionError)

	doc = frappe.get_doc("HD Ticket", ticket_name)
	meta = frappe.get_meta("HD Ticket")

	# Fetch template fields configured in HD Ticket Template (defaulting to 'Default')
	template_name = doc.get("template") or "Default"
	template_fields = frappe.get_all(
		"HD Ticket Template Field",
		filters={"parent": template_name},
		pluck="fieldname",
		order_by="idx"
	)

	if not template_fields and template_name != "Default":
		template_fields = frappe.get_all(
			"HD Ticket Template Field",
			filters={"parent": "Default"},
			pluck="fieldname",
			order_by="idx"
		)

	core_fieldnames = ["subject", "status", "priority", "ticket_type", "agent_group", "raised_by", "customer"]

	ignored_fieldtypes = ["Section Break", "Column Break", "Tab Break", "HTML", "Button", "Fold"]
	ignored_fieldnames = ["amended_from", "docstatus", "name", "owner", "creation", "modified", "modified_by"]

	meta_fields_dict = {df.fieldname: df for df in meta.fields}

	ordered_fieldnames = []
	for fn in core_fieldnames:
		if fn in meta_fields_dict and fn not in ordered_fieldnames:
			ordered_fieldnames.append(fn)

	for fn in template_fields:
		if fn in meta_fields_dict and fn not in ordered_fieldnames:
			ordered_fieldnames.append(fn)

	if "custom_machine_type_list" in meta_fields_dict and "custom_machine_type_list" not in ordered_fieldnames:
		ordered_fieldnames.append("custom_machine_type_list")

	fields_meta = []
	options_map = {}

	for fn in ordered_fieldnames:
		df = meta_fields_dict[fn]
		if df.fieldtype in ignored_fieldtypes or df.fieldname in ignored_fieldnames:
			continue

		field_info = {
			"fieldname": df.fieldname,
			"label": df.label or df.fieldname,
			"fieldtype": df.fieldtype,
			"options": df.options,
			"reqd": df.reqd,
			"read_only": df.read_only,
			"hidden": df.hidden
		}

		if df.fieldtype == "Table" and df.options:
			try:
				child_meta = frappe.get_meta(df.options)
				child_fields = []
				for cdf in child_meta.fields:
					if cdf.fieldtype in ignored_fieldtypes or cdf.fieldname in ignored_fieldnames:
						continue
					cf_info = {
						"fieldname": cdf.fieldname,
						"label": cdf.label or cdf.fieldname,
						"fieldtype": cdf.fieldtype,
						"options": cdf.options,
						"reqd": cdf.reqd,
						"read_only": cdf.read_only
					}
					if cdf.fieldname == "machine_type":
						items = frappe.get_all("Item", fields=["name", "item_name", "brand"], order_by="item_name asc", limit_page_length=500)
						cf_info["options"] = [{"value": i["name"], "label": i["item_name"], "item_name": i["item_name"], "brand": i.get("brand") or ""} for i in items]
					elif cdf.fieldtype == "Select" and cdf.options:
						cf_info["options"] = [o.strip() for o in cdf.options.split("\n") if o.strip()]
					elif cdf.fieldtype == "Link" and cdf.options:
						try:
							cf_info["options"] = frappe.get_all(cdf.options, pluck="name", limit_page_length=500, ignore_permissions=True)
						except Exception:
							cf_info["options"] = []
					child_fields.append(cf_info)
				field_info["child_fields"] = child_fields
			except Exception as te:
				frappe.log_error(f"Error building child table meta: {te}")

		fields_meta.append(field_info)

		if df.fieldtype == "Select" and df.options:
			opts = [o.strip() for o in df.options.split("\n") if o.strip()]
			options_map[df.fieldname] = opts
		elif df.fieldtype == "Link" and df.options:
			try:
				link_opts = frappe.get_all(df.options, pluck="name", limit_page_length=500, ignore_permissions=True)
				options_map[df.fieldname] = link_opts
			except Exception:
				options_map[df.fieldname] = []

	return {
		"status": "success",
		"ticket_name": ticket_name,
		"doc": doc.as_dict(),
		"fields": fields_meta,
		"options": options_map,
		"core_fields": core_fieldnames,
		"template_fields": template_fields
	}



@frappe.whitelist()
def update_ticket_info(ticket_name: str, values: Union[dict, str]) -> dict:
	"""Update HD Ticket fields from the popup modal."""
	if not ticket_name:
		frappe.throw("Ticket ID is required")

	if isinstance(values, str):
		values = json.loads(values)

	if not frappe.has_permission("HD Ticket", "write", doc=ticket_name):
		frappe.throw("No permission to edit this ticket", frappe.PermissionError)

	doc = frappe.get_doc("HD Ticket", ticket_name)
	meta = frappe.get_meta("HD Ticket")
	valid_fieldnames = {df.fieldname for df in meta.fields if not df.read_only and df.fieldtype not in ["Section Break", "Column Break", "Tab Break"]}

	updated_count = 0
	for k, v in values.items():
		if k in valid_fieldnames:
			if isinstance(v, list):
				doc.set(k, [])
				for row in v:
					if isinstance(row, dict):
						doc.append(k, row)
				updated_count += 1
			else:
				doc.set(k, v)
				updated_count += 1

	if updated_count > 0:
		doc.save(ignore_permissions=True)
		frappe.db.commit()

	return {
		"status": "success",
		"message": f"Updated {updated_count} fields successfully",
		"ticket": doc.as_dict()
	}



