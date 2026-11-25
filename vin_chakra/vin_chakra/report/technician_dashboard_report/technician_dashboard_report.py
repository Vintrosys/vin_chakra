import json

import frappe
from frappe import _
from frappe.utils import add_days, cstr, get_fullname, getdate, today

MANAGER_ROLES = {"Agent Manager", "System Manager"}

# "All <City>" groups: a branch belongs to a group if its name contains one of the keywords
BRANCH_GROUPS = {
	"All Chennai": ["Chennai"],
	"All Madurai": ["Showroom-Madurai", "Dhalavaipuram Branch", "Madurai Head Office"],
}

# Ticket's own branch; if empty, the branch of the first assigned technician (Employee)
BRANCH_EXPR = """COALESCE(NULLIF(TRIM(t.custom_branch), ''),
	(SELECT e.branch FROM `tabEmployee` e
		WHERE e.user_id = JSON_UNQUOTE(JSON_EXTRACT(t.`_assign`, '$[0]')) AND e.status = 'Active' LIMIT 1))"""


def is_manager(user=None):
	user = user or frappe.session.user
	return user == "Administrator" or bool(MANAGER_ROLES & set(frappe.get_roles(user)))


def execute(filters=None):
	filters = frappe._dict(filters or {})
	validate_filters(filters)
	return get_columns(), get_data(filters)


def validate_filters(filters):
	if not filters.get("to_date"):
		filters.to_date = today()
	if not filters.get("from_date"):
		filters.from_date = add_days(filters.to_date, -30)
	if getdate(filters.from_date) > getdate(filters.to_date):
		frappe.throw(_("From Date cannot be after To Date."))


def get_columns():
	return [
		{"label": _("Ticket ID"), "fieldname": "ticket", "fieldtype": "Data", "width": 110},
		{"label": _("Created On"), "fieldname": "ticket_date", "fieldtype": "Date", "width": 100},
		{"label": _("Technician"), "fieldname": "technician", "fieldtype": "Data", "width": 160},
		{"label": _("Customer"), "fieldname": "customer", "fieldtype": "Data", "width": 180},
		{"label": _("Status"), "fieldname": "status", "fieldtype": "Data", "width": 90},
		{"label": _("Priority"), "fieldname": "priority", "fieldtype": "Data", "width": 90},
		{"label": _("Type"), "fieldname": "ticket_type", "fieldtype": "Data", "width": 110},
		{"label": _("Branch"), "fieldname": "branch", "fieldtype": "Data", "width": 140},
		{"label": _("First Check-in"), "fieldname": "first_checkin", "fieldtype": "Datetime", "width": 150},
		{"label": _("Last Check-out"), "fieldname": "last_checkout", "fieldtype": "Datetime", "width": 150},
		{"label": _("Duration"), "fieldname": "duration", "fieldtype": "Data", "width": 90},
	]


@frappe.whitelist()
def get_status_counts(filters=None):
	"""Box counts: every filter applies except Status, so all boxes stay correct."""
	filters = frappe._dict(frappe.parse_json(filters) if filters else {})
	validate_filters(filters)
	rows = get_data(filters, with_status=False)
	status_of = {r["ticket"]: r["status"] for r in rows}  # one count per ticket
	counts = {"Total": len(status_of), "Open": 0, "Working": 0, "Pending": 0, "Resolved": 0}
	for status in status_of.values():
		if status in counts:
			counts[status] += 1
	return counts


def format_duration(start, end):
	if not start or not end or end < start:
		return "-"
	minutes = int((end - start).total_seconds() // 60)
	h, m = divmod(minutes, 60)
	return f"{h}h {m}m" if h else f"{m}m"


def get_data(filters, with_status=True):
	conditions = ["COALESCE(t.custom_date, DATE(t.creation)) BETWEEN %(from_date)s AND %(to_date)s"]
	values = {"from_date": filters.from_date, "to_date": filters.to_date}

	technician = filters.get("technician")
	# A normal technician only ever sees his own tickets
	if not is_manager():
		technician = frappe.session.user

	if technician:
		conditions.append("JSON_SEARCH(t.`_assign`, 'one', %(technician)s) IS NOT NULL")
		values["technician"] = technician
	if with_status and filters.get("status"):
		conditions.append("t.status = %(status)s")
		values["status"] = filters.status
	if filters.get("priority"):
		conditions.append("t.priority = %(priority)s")
		values["priority"] = filters.priority
	if filters.get("ticket_type"):
		conditions.append("t.ticket_type = %(ticket_type)s")
		values["ticket_type"] = filters.ticket_type

	branch = cstr(filters.get("branch")).strip()
	if branch and branch != "All Branches":
		if branch in BRANCH_GROUPS:
			likes = []
			for i, keyword in enumerate(BRANCH_GROUPS[branch]):
				likes.append(f"{BRANCH_EXPR} LIKE %(branch_kw_{i})s")
				values[f"branch_kw_{i}"] = f"%{keyword}%"
			conditions.append("(" + " OR ".join(likes) + ")")
		else:
			conditions.append(f"{BRANCH_EXPR} = %(branch)s")
			values["branch"] = branch

	rows = frappe.db.sql(
		f"""
		SELECT
			t.name AS ticket,
			COALESCE(t.custom_date, DATE(t.creation)) AS ticket_date,
			COALESCE(NULLIF(t.custom_customer_name, ''), t.customer) AS customer,
			t.status,
			t.priority,
			t.ticket_type,
			{BRANCH_EXPR} AS branch,
			t.custom_machine_problem AS notes,
			t.custom_required_spares AS parts,
			t.custom_date AS scheduled,
			t.`_assign` AS assigned,
			(SELECT MIN(c.timestamp) FROM `tabHD Ticket Check Log` c
				WHERE c.parent = t.name AND c.parenttype = 'HD Ticket' AND c.check_type = 'Check-in') AS first_checkin,
			(SELECT MAX(c.timestamp) FROM `tabHD Ticket Check Log` c
				WHERE c.parent = t.name AND c.parenttype = 'HD Ticket' AND c.check_type = 'Check-out') AS last_checkout
		FROM `tabHD Ticket` t
		WHERE {" AND ".join(conditions)}
		ORDER BY ticket_date DESC, t.creation DESC
		""",
		values,
		as_dict=True,
	)

	result = []
	names = {}
	for row in rows:
		try:
			users = json.loads(row.pop("assigned") or "[]")
		except ValueError:
			users = []
		if technician:
			users = [u for u in users if u == technician]
		row["duration"] = format_duration(row.first_checkin, row.last_checkout)
		for u in users or [None]:
			r = dict(row)
			if u and u not in names:
				names[u] = get_fullname(u)
			r["technician"] = names.get(u, "")
			result.append(r)
	return result


@frappe.whitelist()
def get_branch_options():
	"""Same list as the chief dashboard: All Branches, All <City> groups, then each branch."""
	options = set(
		frappe.db.sql_list(
			"SELECT DISTINCT TRIM(custom_branch) FROM `tabHD Ticket` WHERE IFNULL(custom_branch, '') != ''"
		)
	)
	df = frappe.get_meta("HD Ticket").get_field("custom_branch")
	if df:
		if df.fieldtype == "Link" and df.options:
			options.update(frappe.get_all(df.options, pluck="name"))
		elif df.options:
			options.update(o.strip() for o in df.options.split("\n") if o.strip())

	skip = {"All Branches", *BRANCH_GROUPS}
	return ["All Branches"] + list(BRANCH_GROUPS) + sorted(o for o in options if o not in skip)