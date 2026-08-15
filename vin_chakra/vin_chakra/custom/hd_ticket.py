import frappe
from frappe import _
from frappe.desk.form.assign_to import add as add_assign


def _is_technician(user=None):
	"""Returns True if the user is a regular agent/technician (not a manager/admin)."""
	if not user:
		user = frappe.session.user
	if user in ["Administrator", "Guest"]:
		return False
	roles = frappe.get_roles(user)
	return not ({"Agent Manager", "System Manager", "Chief Technician"} & set(roles))


def fix_phone_numbers(doc, method=None):
	"""Ensure phone fields have a country code before Frappe strict validation runs."""
	phone_fields = [df.fieldname for df in doc.meta.fields if df.fieldtype == "Phone"]
	for field in phone_fields:
		val = doc.get(field)
		if val:
			val = val.strip()
			if val == "+":
				doc.set(field, "")
			elif not val.startswith("+"):
				doc.set(field, f"+91-{val}")


def assign_to_chief_technician(doc, method):
	chief_technicians = frappe.get_all('Has Role', filters={'role': 'Chief Technician', 'parenttype': 'User'}, fields=['parent'])
	
	users_to_assign = []
	for d in chief_technicians:
		if frappe.db.get_value('User', d.parent, 'enabled'):
			users_to_assign.append(d.parent)
	users_to_assign = list(set(users_to_assign))
	
	frappe.flags.in_auto_assignment = True
	for user in users_to_assign:
		try:
			add_assign({
				'assign_to': [user],
				'doctype': doc.doctype,
				'name': doc.name,
				'description': 'New HD Ticket created via portal'
			})
		except Exception as e:
			frappe.log_error(message=frappe.get_traceback(), title=f"Failed to assign ticket {doc.name} to {user}")
	frappe.flags.in_auto_assignment = False


def get_assignee_restricted_ticket_query(user=None):
	"""
	Custom permission_query_conditions for HD Ticket.

	Rules:
	- Administrator OR Agent Manager / System Manager → see ALL tickets.
	- Regular agents / technicians → only see tickets they are assigned to
	  (i.e., their email appears in the `_assign` JSON column).
	"""
	if not user:
		user = frappe.session.user

	# Admins and managers see everything
	if user == "Administrator":
		return None

	user_roles = frappe.get_roles(user)
	if "Agent Manager" in user_roles or "System Manager" in user_roles or "Chief Technician" in user_roles:
		return None

	# Regular agent / technician: only show their assigned tickets
	escaped_user = frappe.db.escape(user)
	return (
		"JSON_SEARCH(`tabHD Ticket`.`_assign`, 'one', {user}) IS NOT NULL"
	).format(user=escaped_user)


def validate_ticket(doc, method=None):
	"""
	Doctype level validation rules for HD Ticket:
	1. Only one Working ticket at a time per technician assignee.
	2. Restrict technicians from modifying details like assignee, team (agent_group) or status in Desk.
	3. Validate check-in/check-out location (lat, long) and timestamp logs.
	"""
	# 1. Enforce one Working ticket at a time per technician assignee
	if doc.status == "Working":
		import json
		assignees = json.loads(doc._assign or "[]")
		for assignee in assignees:
			if _is_technician(assignee):
				active_ticket = frappe.db.sql(
					"""
					SELECT name FROM `tabHD Ticket`
					WHERE status = 'Working'
					  AND JSON_SEARCH(`_assign`, 'one', %s) IS NOT NULL
					  AND name != %s
					LIMIT 1
					""",
					(assignee, doc.name)
				)
				if active_ticket:
					frappe.throw(
						_("Technician {0} is already working on ticket {1}. Please close or pause it first.")
						.format(assignee, active_ticket[0][0])
					)

	# 2. Restrict technicians from modifying key ticket details (team/agent_group, status) directly in Desk
	if _is_technician(frappe.session.user):
		old_doc = doc.get_doc_before_save()
		if old_doc:
			# Prevent team/agent_group modification
			if doc.agent_group != old_doc.agent_group:
				frappe.throw(_("Technicians are not allowed to change the Team (Agent Group)."))
			
			# Prevent status modification directly in Desk
			if doc.status != old_doc.status and not doc.flags.from_technician_api:
				frappe.throw(_("Technicians are not allowed to change the ticket status directly. Please use the Technician Portal."))

	# 3. Validate check-in/check-out location (lat, long) and timestamp logs
	if doc.status in ["Working", "Resolved", "Pending"]:
		if _is_technician(frappe.session.user) or doc.flags.from_technician_api:
			logs = doc.get("custom_check_log") or []
			expected_type = "Check-in" if doc.status == "Working" else "Check-out"
			
			if not logs:
				frappe.throw(_("No check log found. Please perform check-in/check-out via the Technician Portal."))
			
			last_log = logs[-1]
			if last_log.check_type != expected_type:
				frappe.throw(_("Invalid check log sequence. Last log must be a {0}.").format(expected_type))
			
			if not last_log.latitude or not last_log.longitude or not last_log.timestamp:
				frappe.throw(_("Check-in/Check-out log must contain latitude, longitude, and timestamp."))


def validate_todo_assignment(todo, method=None):
	"""
	Event hook for ToDo to restrict technicians from assigning or unassigning tickets.
	"""
	if frappe.flags.in_auto_assignment:
		return

	if todo.reference_type == "HD Ticket":
		if _is_technician(frappe.session.user):
			frappe.throw(_("Technicians are not allowed to assign or unassign tickets."))


def clear_dashboard_caches(doc, method=None):
	"""Clears Redis cache keys for dashboards when tickets or check-ins change."""
	try:
		frappe.cache().delete_keys("tech_portal:*")
		frappe.cache().delete_keys("chief_dash:*")
		frappe.cache().delete_keys("tech_map:*")
	except Exception:
		pass

