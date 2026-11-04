import frappe
import json
import random
from typing import Optional, Union

from frappe import _
from frappe.desk.form.assign_to import add as add_assign

from vin_chakra.vin_chakra.custom.hd_ticket import _is_technician


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


@frappe.whitelist()
def get_branches() -> list:
	"""Branch names for the Branch dropdowns, which every desk user sees, though only HR
	roles can read the Branch doctype."""
	return frappe.get_all("Branch", pluck="name", order_by="name asc", ignore_permissions=True)


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
			elif df.options == "Branch":
				options_list = get_branches()
			else:
				try:
					options_list = frappe.get_all(df.options, pluck="name", ignore_permissions=True)
				except Exception:
					options_list = []

		if row.fieldname == "custom_purchase_year" and not options_list:
			options_list = [str(year) for year in range(2010, 2027)]

		if step_num not in steps_map:
			steps_map[step_num] = []

		sections_in_step = steps_map[step_num]
		sec_obj = next((s for s in sections_in_step if s["label"] == sec_label), None)
		if not sec_obj:
			sec_obj = {"label": sec_label, "fields": []}
			sections_in_step.append(sec_obj)

		from vin_chakra.vin_chakra.doctype.support_form_template.support_form_template import get_display_label

		reqd = int(row.reqd) if row.reqd is not None else int(default_reqd or 0)
		# See _get_branch_error: with no Branch records there is nothing to choose
		if row.fieldname == "custom_branch" and not options_list:
			reqd = 0

		field_info = {
			"fieldname": row.fieldname,
			"fieldtype": fieldtype,
			"label": get_display_label(row, df),
			"reqd": reqd,
			"options": df.options if (df and df.fieldtype == "Table") else options_list,
			"child_fields": child_fields,
			"icon": row.icon or "tag"
		}

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

	step1_keys = {"custom_customer_name", "custom_customer_mobile_number", "custom_state", "custom_city__district_", "custom_address", "custom_date", "custom_branch"}
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



def _get_branch_error(branch) -> str:
	"""Why a ticket from the public form cannot use this Branch ("" if it can).

	Branch is mandatory on that form only, not on the doctype: older tickets and tickets
	from other channels (WhatsApp, Helpdesk) have none and must stay saveable. It is not
	demanded while the site has no Branch records, or no ticket could be raised at all.
	"""
	if not branch:
		return _("Please select a Branch.") if frappe.db.count("Branch") else ""
	if not isinstance(branch, str) or not frappe.db.exists("Branch", branch):
		return _("Please select a valid Branch.")
	return ""


@frappe.whitelist(allow_guest=True)
def submit_ticket(data: Union[dict, str]) -> dict:
	"""Create a new HD Ticket from the public form submission."""
	if isinstance(data, str):
		data = json.loads(data)

	try:
		branch_error = _get_branch_error(data.get("custom_branch"))
		if branch_error:
			return {"status": "error", "message": branch_error}

		# VULNERABILITY FIX: Prevent Mass Assignment by validating against Web Form fields
		web_form = frappe.get_doc("Web Form", "raise-a-ticket")
		allowed_fields = [f.fieldname for f in web_form.web_form_fields if not getattr(f, 'hidden', 0)]
		if "custom_purchase_year" not in allowed_fields:
			allowed_fields.append("custom_purchase_year")
		if "custom_machine_type_list" not in allowed_fields:
			allowed_fields.append("custom_machine_type_list")
		if "customer" not in allowed_fields:
			allowed_fields.append("customer")
		if "custom_branch" not in allowed_fields:
			allowed_fields.append("custom_branch")

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

	core_fieldnames = ["subject", "status", "priority", "ticket_type", "agent_group", "raised_by", "customer", "custom_branch"]

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

		# Technicians can see a ticket's Branch but not change it (validate_ticket enforces this)
		if df.fieldname == "custom_branch" and _is_technician():
			field_info["read_only"] = 1

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
				if df.options == "Branch":
					link_opts = get_branches()
				else:
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
		"template_fields": template_fields,
		"assignment": _get_assignment_info(doc)
	}



@frappe.whitelist()
def update_ticket_info(
	ticket_name: str,
	values: Union[dict, str],
	assign: Union[list, str, None] = None,
	unassign: Union[list, str, None] = None,
) -> dict:
	"""Update HD Ticket fields from the popup modal.

	`assign` / `unassign` are the popup's Assignee changes (User IDs). They are
	applied after the fields are saved and before the commit, so when either part
	fails the request is rolled back and nothing is saved.
	"""
	if not ticket_name:
		frappe.throw("Ticket ID is required")

	if isinstance(values, str):
		values = json.loads(values)
	assign = _parse_user_ids(assign)
	unassign = _parse_user_ids(unassign)

	if not frappe.has_permission("HD Ticket", "write", doc=ticket_name):
		frappe.throw("No permission to edit this ticket", frappe.PermissionError)

	if assign or unassign:
		_check_assignment_change(ticket_name, assign, unassign)

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

	if assign or unassign:
		_apply_assignment_changes(doc, assign, unassign)

	frappe.db.commit()

	return {
		"status": "success",
		"message": f"Updated {updated_count} fields successfully",
		"ticket": doc.as_dict(),
		"assignees": json.loads(frappe.db.get_value("HD Ticket", ticket_name, "_assign") or "[]")
	}


# Popup Assignee field. It edits the ticket's real assignments (open ToDos, mirrored
# in `_assign`) through the same calls as the core Helpdesk Assignee panel.

def _get_assignment_info(doc) -> dict:
	"""Current assignees and assignable agents for the popup's Assignee field."""
	from helpdesk.helpdesk.doctype.hd_ticket.api import get_ticket_assignees

	read_only_reason = _get_assignment_lock_reason(doc.name)
	return {
		"assignees": [
			{"value": a["name"], "label": a.get("agent_name") or frappe.utils.get_fullname(a["name"])}
			for a in get_ticket_assignees(doc.name)
		],
		"options": [] if read_only_reason else [
			{"value": a.name, "label": a.agent_name or a.name}
			for a in _get_assignable_agents(doc.agent_group)
		],
		"can_assign": not read_only_reason,
		"read_only_reason": read_only_reason
	}


def _get_assignment_lock_reason(ticket_name: str) -> str:
	"""Why the session user may not change the ticket's assignees ("" if they may).

	The core Assignee panel is for agents only, and validate_todo_assignment bars
	technicians from assigning or unassigning tickets.
	"""
	from helpdesk.utils import is_agent

	if _is_technician():
		return _("Technicians are not allowed to assign or unassign tickets.")
	if not is_agent() or not frappe.has_permission("HD Ticket", "write", doc=ticket_name):
		return _("You do not have permission to change this ticket's assignees.")
	return ""


def _get_restricted_team(team: Optional[str]) -> Optional[str]:
	"""The team whose members alone can be assigned, as in the core Assignee picker:
	set only when HD Settings restricts tickets by team and assigns within the team."""
	if (
		team
		and frappe.db.get_single_value("HD Settings", "restrict_tickets_by_agent_group")
		and frappe.db.get_single_value("HD Settings", "assign_within_team")
	):
		return team
	return None


def _get_assignable_agents(team: Optional[str], users: Optional[list] = None) -> list:
	"""Active HD Agents the ticket can be assigned to (the core Assignee picker's
	list). `users` narrows the lookup to those User IDs."""
	filters = [["is_active", "=", 1]]
	restricted_team = _get_restricted_team(team)
	if restricted_team:
		members = frappe.get_all("HD Team Member", filters={"parent": restricted_team}, pluck="user")
		filters.append(["name", "in", members or [""]])
	if users is not None:
		filters.append(["name", "in", users or [""]])
	return frappe.get_all("HD Agent", filters=filters, fields=["name", "agent_name"], order_by="agent_name asc")


def _parse_user_ids(users: Union[list, str, None]) -> list:
	"""De-duplicated User IDs from an assign/unassign list."""
	if isinstance(users, str):
		try:
			users = json.loads(users)
		except ValueError:
			pass  # not JSON: rejected by the list check below
	if not users:
		return []
	if not isinstance(users, list) or not all(isinstance(u, str) for u in users):
		frappe.throw(_("Assignees must be a list of User IDs."))
	return list(dict.fromkeys(u.strip() for u in users if u.strip()))


def _check_assignment_change(ticket_name: str, assign: list, unassign: list) -> None:
	"""Reject the Assignee change before anything is saved."""
	reason = _get_assignment_lock_reason(ticket_name)
	if reason:
		frappe.throw(reason, frappe.PermissionError)

	conflicting = set(assign) & set(unassign)
	if conflicting:
		frappe.throw(_("Cannot both assign and unassign {0}.").format(", ".join(sorted(conflicting))))


def _apply_assignment_changes(doc, assign: list, unassign: list) -> None:
	"""Apply the popup's Assignee changes the way the core Assignee panel does:
	removals through helpdesk's remove_assignments, then additions through
	frappe.desk.form.assign_to.add.

	The changes are compared with the live assignments, so users already in the
	requested state are skipped (no duplicate ToDos) and other assignees, including
	any added elsewhere after the popup was opened, are left alone.
	"""
	from helpdesk.api.doc import remove_assignments

	current = json.loads(frappe.db.get_value("HD Ticket", doc.name, "_assign") or "[]")
	to_remove = [u for u in unassign if u in current]
	to_add = [u for u in assign if u not in current]

	if to_add:
		eligible = {a.name for a in _get_assignable_agents(doc.agent_group, to_add)}
		ineligible = [u for u in to_add if u not in eligible]
		if ineligible:
			restricted_team = _get_restricted_team(doc.agent_group)
			if restricted_team:
				msg = _("Cannot assign {0}: only active agents of team {1} can be assigned to this ticket.").format(
					", ".join(ineligible), restricted_team
				)
			else:
				msg = _("Cannot assign {0}: tickets can only be assigned to active Helpdesk agents.").format(
					", ".join(ineligible)
				)
			frappe.throw(msg)

	if to_remove:
		remove_assignments(doctype="HD Ticket", name=doc.name, assignees=to_remove)
	if to_add:
		add_assign({"assign_to": to_add, "doctype": "HD Ticket", "name": doc.name})


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


def _default_customer_group() -> str:
	return (
		frappe.db.get_default("customer_group")
		or frappe.db.get_value("Customer Group", {"is_group": 0}, "name")
		or "All Customer Groups"
	)


def _default_territory() -> str:
	return (
		frappe.db.get_default("territory")
		or frappe.db.get_value("Territory", {"is_group": 0}, "name")
		or "All Territories"
	)


def _find_customer_by_phone(phone: str) -> Optional[str]:
	"""Look up a Customer by the last 10 digits of their mobile number."""
	clean_digits = "".join(filter(str.isdigit, str(phone or "")))
	p10 = clean_digits[-10:] if len(clean_digits) >= 10 else clean_digits
	if not p10 or len(p10) < 10:
		return None

	# 1. Customer.mobile_no ending in these 10 digits
	c = frappe.db.sql(
		"""
		SELECT name FROM `tabCustomer`
		WHERE REPLACE(REPLACE(REPLACE(IFNULL(mobile_no, ''), '+', ''), '-', ''), ' ', '') LIKE %s
		LIMIT 1
		""",
		f"%{p10}",
	)
	if c:
		return c[0][0]

	# 2. Contact linked to Customer with this phone
	c = frappe.db.sql(
		"""
		SELECT dl.link_name
		FROM `tabContact Phone` cp
		JOIN `tabDynamic Link` dl ON dl.parent = cp.parent AND dl.parenttype = 'Contact'
		WHERE dl.link_doctype = 'Customer'
		  AND REPLACE(REPLACE(REPLACE(IFNULL(cp.phone, ''), '+', ''), '-', ''), ' ', '') LIKE %s
		LIMIT 1
		""",
		f"%{p10}",
	)
	if c:
		return c[0][0]

	return None


@frappe.whitelist(allow_guest=True)
def create_customer_quick_entry(
	customer_name: Optional[str] = None,
	mobile_no: Optional[str] = None,
	customer_type: Optional[str] = "Individual",
	secondary_phone: Optional[str] = None,
	email_id: Optional[str] = None,
	address_line1: Optional[str] = None,
	address_line2: Optional[str] = None,
	city: Optional[str] = None,
	state: Optional[str] = "Tamil Nadu",
	pincode: Optional[str] = None,
	gstin: Optional[str] = None,
	customer_id: Optional[str] = None,
	data: Union[dict, str, None] = None,
	**kwargs,
) -> dict:
	"""Quick entry endpoint to create or update a Customer from the public ticket-support form."""
	try:
		if isinstance(customer_name, dict):
			data = customer_name
			customer_name = None
		elif isinstance(customer_name, str) and customer_name.strip().startswith("{"):
			try:
				data = json.loads(customer_name)
				customer_name = None
			except Exception:
				pass

		if isinstance(data, str):
			try:
				data = json.loads(data)
			except Exception:
				data = {}
		if isinstance(data, dict):
			customer_name = data.get("customer_name") or customer_name
			mobile_no = data.get("mobile_no") or mobile_no
			customer_type = data.get("customer_type") or customer_type
			secondary_phone = data.get("secondary_phone") or secondary_phone
			email_id = data.get("email_id") or email_id
			address_line1 = data.get("address_line1") or address_line1
			address_line2 = data.get("address_line2") or address_line2
			city = data.get("city") or city
			state = data.get("state") or state
			pincode = data.get("pincode") or pincode
			gstin = data.get("gstin") or gstin
			customer_id = data.get("customer_id") or customer_id

		# Also inspect kwargs / frappe.form_dict
		form = getattr(frappe, "form_dict", {}) or {}
		customer_name = customer_name or kwargs.get("customer_name") or form.get("customer_name")
		mobile_no = mobile_no or kwargs.get("mobile_no") or form.get("mobile_no")
		customer_type = customer_type or kwargs.get("customer_type") or form.get("customer_type")
		secondary_phone = secondary_phone or kwargs.get("secondary_phone") or form.get("secondary_phone")
		email_id = email_id or kwargs.get("email_id") or form.get("email_id")
		address_line1 = address_line1 or kwargs.get("address_line1") or form.get("address_line1")
		address_line2 = address_line2 or kwargs.get("address_line2") or form.get("address_line2")
		city = city or kwargs.get("city") or form.get("city")
		state = state or kwargs.get("state") or form.get("state")
		pincode = pincode or kwargs.get("pincode") or form.get("pincode")
		gstin = gstin or kwargs.get("gstin") or form.get("gstin")
		customer_id = customer_id or kwargs.get("customer_id") or form.get("customer_id")

		customer_name = (customer_name or "").strip()
		if not customer_name:
			return {"status": "error", "message": _("Customer Name is required.")}

		clean_mobile = "".join(filter(str.isdigit, str(mobile_no or "")))
		if len(clean_mobile) == 12 and clean_mobile.startswith("91"):
			clean_mobile = clean_mobile[2:]
		elif len(clean_mobile) > 10:
			clean_mobile = clean_mobile[-10:]

		if len(clean_mobile) < 10:
			return {"status": "error", "message": _("Please enter a valid 10-digit mobile number.")}

		clean_sec = "".join(filter(str.isdigit, str(secondary_phone or "")))
		if len(clean_sec) == 12 and clean_sec.startswith("91"):
			clean_sec = clean_sec[2:]
		elif len(clean_sec) > 10:
			clean_sec = clean_sec[-10:]
		elif len(clean_sec) < 10:
			clean_sec = ""

		customer_type = (customer_type or "Individual").strip()
		if customer_type not in ["Individual", "Company"]:
			customer_type = "Individual"

		email_id = (email_id or "").strip()
		gstin = (gstin or "").strip().upper()
		address_line1 = (address_line1 or "").strip()
		address_line2 = (address_line2 or "").strip()
		city = (city or "").strip()
		state = (state or "Tamil Nadu").strip()
		pincode = (pincode or "").strip()

		is_existing = False

		# 1. Edit existing customer if customer_id given
		if customer_id and frappe.db.exists("Customer", customer_id):
			cust = frappe.get_doc("Customer", customer_id)
			cust.customer_name = customer_name
			cust.customer_type = customer_type
			if cust.meta.has_field("mobile_no"):
				cust.mobile_no = clean_mobile
			if clean_sec and cust.meta.has_field("custom_secondary_phone"):
				cust.custom_secondary_phone = clean_sec
			if email_id and cust.meta.has_field("email_id"):
				cust.email_id = email_id
			if gstin and cust.meta.has_field("gstin"):
				cust.gstin = gstin
			cust.flags.ignore_mandatory = True
			cust.save(ignore_permissions=True)
			is_existing = True
		else:
			# 2. Check if customer already exists by phone
			existing_id = _find_customer_by_phone(clean_mobile)
			if existing_id:
				cust = frappe.get_doc("Customer", existing_id)
				is_existing = True
				if clean_sec and not cust.get("custom_secondary_phone") and cust.meta.has_field("custom_secondary_phone"):
					cust.custom_secondary_phone = clean_sec
				if email_id and not cust.get("email_id") and cust.meta.has_field("email_id"):
					cust.email_id = email_id
				if gstin and not cust.get("gstin") and cust.meta.has_field("gstin"):
					cust.gstin = gstin
				cust.flags.ignore_mandatory = True
				cust.save(ignore_permissions=True)
			else:
				# 3. Create new customer
				cust = frappe.new_doc("Customer")
				cust.customer_name = customer_name
				cust.customer_type = customer_type
				cust.customer_group = _default_customer_group()
				cust.territory = _default_territory()
				if cust.meta.has_field("mobile_no"):
					cust.mobile_no = clean_mobile
				if clean_sec and cust.meta.has_field("custom_secondary_phone"):
					cust.custom_secondary_phone = clean_sec
				if email_id and cust.meta.has_field("email_id"):
					cust.email_id = email_id
				if gstin and cust.meta.has_field("gstin"):
					cust.gstin = gstin
				cust.flags.ignore_mandatory = True
				cust.insert(ignore_permissions=True)

		# 4. Handle Address
		if address_line1 or city or state or pincode:
			primary_addr = getattr(cust, "customer_primary_address", None)
			if primary_addr and frappe.db.exists("Address", primary_addr):
				addr = frappe.get_doc("Address", primary_addr)
				if address_line1:
					addr.address_line1 = address_line1
				if address_line2:
					addr.address_line2 = address_line2
				if city:
					addr.city = city
				if state:
					addr.state = state
				if pincode:
					addr.pincode = pincode
				addr.flags.ignore_mandatory = True
				addr.save(ignore_permissions=True)
			else:
				addr = frappe.get_doc({
					"doctype": "Address",
					"address_title": (cust.customer_name or cust.name)[:140],
					"address_type": "Billing",
					"address_line1": address_line1 or city or "Main Road",
					"address_line2": address_line2 or None,
					"city": city or None,
					"state": state or "Tamil Nadu",
					"pincode": pincode or None,
					"country": "India",
					"links": [{"link_doctype": "Customer", "link_name": cust.name}],
				})
				addr.flags.ignore_mandatory = True
				addr.insert(ignore_permissions=True)
				frappe.db.set_value("Customer", cust.name, "customer_primary_address", addr.name)

		# 5. Handle Contact
		primary_contact = getattr(cust, "customer_primary_contact", None)
		if primary_contact and frappe.db.exists("Contact", primary_contact):
			contact = frappe.get_doc("Contact", primary_contact)
			phones = [str(r.phone).strip() for r in (contact.phone_nos or []) if getattr(r, "phone", None)]
			if clean_mobile not in phones:
				contact.append("phone_nos", {
					"phone": clean_mobile,
					"is_primary_phone": 1,
					"is_primary_mobile_no": 1,
				})
			if clean_sec and clean_sec not in phones:
				contact.append("phone_nos", {
					"phone": clean_sec,
					"is_primary_phone": 0,
					"is_primary_mobile_no": 0,
				})
			if email_id and hasattr(contact, "email_ids"):
				emails = [str(e.email_id).strip().lower() for e in (contact.email_ids or []) if getattr(e, "email_id", None)]
				if email_id.lower() not in emails:
					contact.append("email_ids", {"email_id": email_id, "is_primary": 1})
			contact.flags.ignore_mandatory = True
			contact.save(ignore_permissions=True)
		else:
			contact = frappe.get_doc({
				"doctype": "Contact",
				"first_name": (cust.customer_name or cust.name)[:140],
				"links": [{"link_doctype": "Customer", "link_name": cust.name}],
				"phone_nos": [
					{"phone": clean_mobile, "is_primary_phone": 1, "is_primary_mobile_no": 1}
				],
			})
			if clean_sec and clean_sec != clean_mobile:
				contact.append("phone_nos", {
					"phone": clean_sec,
					"is_primary_phone": 0,
					"is_primary_mobile_no": 0,
				})
			if email_id and hasattr(contact, "email_ids"):
				contact.append("email_ids", {
					"email_id": email_id,
					"is_primary": 1,
				})
			contact.flags.ignore_mandatory = True
			contact.insert(ignore_permissions=True)
			frappe.db.set_value("Customer", cust.name, "customer_primary_contact", contact.name)

		frappe.db.commit()

		label = f"{cust.customer_name} ({cust.name})" if cust.customer_name and cust.customer_name != cust.name else (cust.customer_name or cust.name)

		return {
			"status": "success",
			"message": _("Customer found and selected") if is_existing else _("Customer created successfully"),
			"is_existing": is_existing,
			"customer": {
				"name": cust.name,
				"value": cust.name,
				"label": label,
				"customer_name": cust.customer_name or cust.name,
				"mobile_no": clean_mobile,
				"secondary_phone": clean_sec or cust.get("custom_secondary_phone") or "",
				"email_id": email_id or cust.get("email_id") or "",
				"address_line1": address_line1 or "",
				"address_line2": address_line2 or "",
				"city": city or "",
				"state": state or "Tamil Nadu",
				"pincode": pincode or "",
			},
		}
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Customer Quick Entry Error")
		return {"status": "error", "message": str(e)}



