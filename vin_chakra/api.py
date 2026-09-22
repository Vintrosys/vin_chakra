import frappe
import json
import random
from typing import Union


@frappe.whitelist(allow_guest=True)
def get_item_details(item_code: str) -> dict:
	"""Fetch Item brand and custom_model_no for support ticket form auto-fill."""
	if not item_code:
		return {}
	item = frappe.db.get_value("Item", item_code, ["name", "item_name", "brand", "custom_model_no"], as_dict=True)
	if not item:
		# Search by item_name if name lookup fails
		item_name_match = frappe.db.get_value("Item", {"item_name": item_code}, ["name", "item_name", "brand", "custom_model_no"], as_dict=True)
		if item_name_match:
			item = item_name_match
		else:
			return {}
	return {
		"item_code": item.name,
		"item_name": item.item_name or item.name,
		"brand": item.brand or "",
		"model_no": item.custom_model_no or ""
	}


@frappe.whitelist(allow_guest=True)
def get_form_schema(template_name: str = None) -> dict:
	"""Return the field schema grouped by steps and sections for dynamic form rendering."""
	try:
		if template_name and frappe.db.exists("Support Form Template", template_name):
			template = frappe.get_doc("Support Form Template", template_name)
		else:
			default_name = frappe.db.get_value("Support Form Template", {"is_default": 1}, "name")
			if not default_name:
				default_name = frappe.db.get_value("Support Form Template", {}, "name")
			if default_name:
				template = frappe.get_doc("Support Form Template", default_name)
			else:
				return _get_legacy_form_schema()

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
								items = frappe.get_all("Item", fields=["name", "item_name", "brand", "custom_model_no"], ignore_permissions=True, limit_page_length=1000)
								c_opts = [{"value": item.name, "label": item.item_name or item.name, "item_name": item.item_name or item.name, "brand": item.brand or "", "model_no": item.custom_model_no or ""} for item in items]
							except Exception:
								c_opts = []
						elif cdf.options == "Machine Problem":
							try:
								problems = frappe.get_all("Machine Problem", fields=["name", "machine_problem"], ignore_permissions=True, limit_page_length=1000)
								c_opts = [{"value": p.name, "label": p.machine_problem or p.name, "problem_name": p.machine_problem or p.name} for p in problems]
							except Exception:
								c_opts = []
						elif cdf.options == "Customer":
							try:
								customers = frappe.get_all("Customer", fields=["name", "customer_name", "mobile_no"], ignore_permissions=True, limit_page_length=1000)
								c_opts = [{"value": c.name, "label": f"{c.customer_name} ({c.name})" if c.customer_name and c.customer_name != c.name else (c.customer_name or c.name), "customer_name": c.customer_name or c.name, "mobile_no": c.mobile_no or ""} for c in customers]
							except Exception:
								c_opts = []
						else:
							try:
								c_opts = frappe.get_all(cdf.options, pluck="name", ignore_permissions=True, limit_page_length=1000)
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
			if df.options == "Customer":
				try:
					customers = frappe.get_all(
						"Customer",
						fields=["name", "customer_name", "mobile_no"],
						ignore_permissions=True,
						limit_page_length=1000
					)
					options_list = [
						{
							"value": c.name,
							"label": f"{c.customer_name} ({c.name})" if c.customer_name and c.customer_name != c.name else (c.customer_name or c.name),
							"customer_name": c.customer_name or c.name,
							"mobile_no": c.mobile_no or ""
						}
						for c in customers
					]
				except Exception:
					options_list = []
			elif df.options == "Machine Problem":
				try:
					problems = frappe.get_all("Machine Problem", fields=["name", "machine_problem"], ignore_permissions=True, limit_page_length=1000)
					options_list = [{"value": p.name, "label": p.machine_problem or p.name, "problem_name": p.machine_problem or p.name} for p in problems]
				except Exception:
					options_list = []
			elif df.options == "Item":
				try:
					items = frappe.get_all("Item", fields=["name", "item_name", "brand", "custom_model_no"], ignore_permissions=True, limit_page_length=1000)
					options_list = [{"value": item.name, "label": item.item_name or item.name, "item_name": item.item_name or item.name, "brand": item.brand or "", "model_no": item.custom_model_no or ""} for item in items]
				except Exception:
					options_list = []
			else:
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
			if f.options == "Customer":
				try:
					customers = frappe.get_all("Customer", fields=["name", "customer_name", "mobile_no"], ignore_permissions=True, limit_page_length=1000)
					options_list = [{"value": c.name, "label": f"{c.customer_name} ({c.name})" if c.customer_name and c.customer_name != c.name else (c.customer_name or c.name), "customer_name": c.customer_name or c.name, "mobile_no": c.mobile_no or ""} for c in customers]
				except Exception:
					options_list = []
			else:
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
		if "customer" not in allowed_fields:
			allowed_fields.append("customer")

		doc = frappe.new_doc("HD Ticket")
		meta = frappe.get_meta("HD Ticket")
		phone_fields = {df.fieldname for df in meta.fields if df.fieldtype == "Phone"}

		for key, value in data.items():
			if key in allowed_fields:
				if key == "custom_machine_type_list" and isinstance(value, list):
					for row in value:
						if isinstance(row, dict):
							r_copy = dict(row)
							if not r_copy.get("machine_problem"):
								r_copy["machine_problem"] = "INSTALLATION"
							if not r_copy.get("purchased_at_scs"):
								r_copy["purchased_at_scs"] = "Yes"
							if not r_copy.get("purchase_year"):
								r_copy["purchase_year"] = "2026"
							doc.append("custom_machine_type_list", r_copy)
					if doc.custom_machine_type_list:
						first_row = doc.custom_machine_type_list[0]
						if first_row.get("machine_problem") and not doc.get("custom_machine_problem"):
							doc.custom_machine_problem = first_row.get("machine_problem")
						if first_row.get("purchased_at_scs") and not doc.get("custom_purchased_at_sree_chakra_sewing_systems"):
							doc.custom_purchased_at_sree_chakra_sewing_systems = first_row.get("purchased_at_scs")
						if first_row.get("purchase_year") and not doc.get("custom_purchase_year"):
							doc.custom_purchase_year = first_row.get("purchase_year")
				else:
					# Auto-prefix +91- for Phone fields if no country code present
					if key in phone_fields and value and not value.startswith("+"):
						value = "+91-" + value
					doc.set(key, value)

		if not doc.get("custom_machine_problem"):
			doc.custom_machine_problem = "INSTALLATION"
		if not doc.get("custom_purchased_at_sree_chakra_sewing_systems"):
			doc.custom_purchased_at_sree_chakra_sewing_systems = "Yes"
		if not doc.get("custom_purchase_year"):
			doc.custom_purchase_year = "2026"

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


@frappe.whitelist(allow_guest=True)
def get_customer_details(customer: str) -> dict:
	"""Fetch customer info including address and contact details for support form display."""
	if not customer:
		return {"status": "error", "message": "Customer required"}
	try:
		cust = frappe.get_doc("Customer", customer)
		data = {
			"name": cust.name,
			"customer_name": cust.customer_name or cust.name,
			"mobile_no": getattr(cust, "mobile_no", None) or getattr(cust, "mobile_number", None) or "",
			"email_id": getattr(cust, "email_id", None) or getattr(cust, "email_address", None) or "",
			"secondary_phone": "",
			"address_line1": "",
			"city": "",
			"state": ""
		}

		sec_phones = []
		cust_sec = getattr(cust, "custom_secondary_phone", None)
		if cust_sec and str(cust_sec).strip():
			sp = str(cust_sec).strip()
			if sp not in sec_phones:
				sec_phones.append(sp)

		if hasattr(cust, "phone_nos") and cust.phone_nos:
			for idx, r in enumerate(cust.phone_nos):
				p = (r.phone or "").strip()
				if p and p != data["mobile_no"] and p not in sec_phones:
					sec_phones.append(p)

		contact_name = getattr(cust, "customer_primary_contact", None)
		if not contact_name:
			c_names = frappe.get_all(
				"Dynamic Link",
				filters={"link_doctype": "Customer", "link_name": customer, "parenttype": "Contact"},
				pluck="parent"
			)
			if c_names:
				contact_name = c_names[0]

		if contact_name and frappe.db.exists("Contact", contact_name):
			c_doc = frappe.get_doc("Contact", contact_name)
			if hasattr(c_doc, "phone_nos") and c_doc.phone_nos:
				for idx, r in enumerate(c_doc.phone_nos):
					p = (r.phone or "").strip()
					if p and p != data["mobile_no"] and p not in sec_phones:
						sec_phones.append(p)

		data["secondary_phone"] = ", ".join(sec_phones)

		primary_addr = getattr(cust, "customer_primary_address", None)
		if primary_addr and frappe.db.exists("Address", primary_addr):
			addr = frappe.get_doc("Address", primary_addr)
			data["address_line1"] = addr.address_line1 or ""
			data["city"] = addr.city or ""
			data["state"] = addr.state or ""
		else:
			addr_link = frappe.db.get_value(
				"Dynamic Link",
				{"link_doctype": "Customer", "link_name": customer, "parenttype": "Address"},
				"parent"
			)
			if addr_link and frappe.db.exists("Address", addr_link):
				addr = frappe.get_doc("Address", addr_link)
				data["address_line1"] = addr.address_line1 or ""
				data["city"] = addr.city or ""
				data["state"] = addr.state or ""

		return {"status": "success", "customer": data}
	except Exception as e:
		return {"status": "error", "message": str(e), "customer": {"name": customer, "customer_name": customer}}


