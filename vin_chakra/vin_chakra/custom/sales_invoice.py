import frappe
from frappe import _
from frappe.model.naming import getseries
from frappe.utils import getdate, nowdate

from vin_chakra.vin_chakra.custom.employee import is_valid_abbr

# Must match the option in the Sales Invoice naming_series property setter.
# The "abbr" part is a marker only: set_invoice_name() builds the name itself so that
# the number comes from one counter shared by every employee.
TECHNICIAN_SERIES = "SI/.YY./.abbr./.###"
RETURN_SERIES = "SRET-.YY.-"

# Users allowed to create invoices without a linked Employee (system jobs run as Administrator).
EXEMPT_USERS = ("Administrator",)


def remove_empty_items(doc, method=None):
	"""Remove rows with empty item_code from items table before validating Sales Invoice."""
	if hasattr(doc, "items") and doc.items:
		doc.items = [row for row in doc.items if row.item_code and str(row.item_code).strip()]
		for idx, row in enumerate(doc.items, 1):
			row.idx = idx


# ─── Technician lookup ──────────────────────────────────────────────────────────


def _check_abbr(employee: dict) -> str:
	abbr = employee.get("custom_abbr")
	if not abbr:
		frappe.throw(
			_(
				"Employee {0} ({1}) has no abbreviation. Ask HR to set a two-letter Abbreviation on the Employee record before creating Sales Invoices."
			).format(employee.get("name"), employee.get("employee_name")),
			title=_("Abbreviation Missing"),
		)
	if not is_valid_abbr(abbr):
		frappe.throw(
			_(
				"Employee {0} ({1}) has an invalid abbreviation {2}. It must be exactly two letters, for example AB."
			).format(employee.get("name"), employee.get("employee_name"), frappe.bold(abbr)),
			title=_("Invalid Abbreviation"),
		)
	return abbr


def get_technician_for_user(user: str | None = None) -> frappe._dict:
	"""Return the active Employee linked to `user` via Employee.user_id, with a valid abbreviation."""
	user = user or frappe.session.user
	employees = frappe.get_all(
		"Employee",
		filters={"user_id": user, "status": "Active"},
		fields=["name", "employee_name", "custom_abbr"],
	)

	if not employees:
		if frappe.db.exists("Employee", {"user_id": user}):
			frappe.throw(
				_("The Employee linked to user {0} is not Active, so this user cannot create Sales Invoices.").format(
					frappe.bold(user)
				),
				title=_("Employee Not Active"),
			)
		frappe.throw(
			_(
				"No Employee is linked to user {0}. Ask HR to set this user in the User ID field of an Employee record before creating Sales Invoices."
			).format(frappe.bold(user)),
			title=_("No Employee Linked"),
		)

	if len(employees) > 1:
		frappe.throw(
			_("User {0} is linked to more than one active Employee: {1}. Only one is allowed.").format(
				frappe.bold(user), ", ".join(e.name for e in employees)
			),
			title=_("Multiple Employees Linked"),
		)

	employee = employees[0]
	_check_abbr(employee)
	return employee


@frappe.whitelist()
def get_current_technician() -> dict:
	"""Used by the Sales Invoice form to fill the technician for the logged-in user."""
	if frappe.session.user in EXEMPT_USERS:
		return {}
	return get_technician_for_user()


# ─── Doc events ─────────────────────────────────────────────────────────────────


def _is_exempt() -> bool:
	return frappe.session.user in EXEMPT_USERS or bool(
		frappe.flags.in_install or frappe.flags.in_migrate or frappe.flags.in_patch
	)


def set_technician(doc, method=None):
	"""before_insert: set the technician to the full name of the logged-in user's Employee.

	Runs before naming, so set_invoice_name() can use the abbreviation kept in doc.flags.
	The client value is never trusted.
	"""
	# Credit notes keep their own series and do not consume the shared invoice counter.
	if doc.get("is_return") and doc.naming_series == TECHNICIAN_SERIES:
		doc.naming_series = RETURN_SERIES

	if doc.get("amended_from"):
		# An amendment keeps the original invoice's technician, whoever amends it.
		doc.custom_technician = frappe.db.get_value("Sales Invoice", doc.amended_from, "custom_technician")
		return

	if _is_exempt():
		return

	technician = get_technician_for_user()
	if doc.get("custom_technician") and doc.custom_technician != technician.employee_name:
		frappe.throw(
			_(
				"Technician {0} is not the Employee linked to your user. Sales Invoices are always created under your own Employee, {1}."
			).format(frappe.bold(doc.custom_technician), frappe.bold(technician.employee_name)),
			title=_("Unauthorized Technician"),
		)
	doc.custom_technician = technician.employee_name
	doc.flags.technician_abbr = technician.custom_abbr


def set_invoice_name(doc, method=None):
	"""autoname: SI/{YY}/{EMPLOYEE_ABBR}/{GLOBAL_SEQUENCE}.

	Frappe would key the counter on the whole prefix (SI/26/AB/), giving each employee their
	own sequence. Here the counter key is SI/{YY}/ only, so every employee shares one sequence.
	"""
	if doc.naming_series != TECHNICIAN_SERIES:
		return

	if _is_exempt() and not doc.flags.get("technician_abbr"):
		doc.flags.technician_abbr = "AD"

	abbr = doc.flags.get("technician_abbr")
	if not abbr:
		frappe.throw(
			_(
				"Series {0} can only be used by a user linked to an Employee with a two-letter abbreviation. Choose another series."
			).format(frappe.bold(TECHNICIAN_SERIES)),
			title=_("Technician Required"),
		)

	# Same rule as ERPNext's YY: the posting date's year.
	year = getdate(doc.get("posting_date") or nowdate()).strftime("%y")
	key = f"SI/{year}/"
	doc.name = f"{key}{abbr}/{next_global_number(key, TECHNICIAN_SERIES.count('#'))}"


def next_global_number(key: str, digits: int) -> str:
	"""Next number for `key` from tabSeries, safe under concurrent inserts.

	The row is created at 0 if missing, ignoring the duplicate if another transaction created it
	first. getseries() then locks the row with SELECT ... FOR UPDATE, so a concurrent insert waits
	until this transaction commits or rolls back before reading the counter.
	"""
	if frappe.db.db_type == "postgres":
		frappe.db.sql(
			'INSERT INTO "tabSeries" ("name", "current") VALUES (%s, 0) ON CONFLICT ("name") DO NOTHING', key
		)
	else:
		frappe.db.sql(
			"INSERT INTO `tabSeries` (`name`, `current`) VALUES (%s, 0) ON DUPLICATE KEY UPDATE `name` = `name`",
			key,
		)
	return getseries(key, digits)


def abbr_in_use(abbr: str) -> bool:
	"""True if any Sales Invoice was numbered with this abbreviation, e.g. SI/26/AB/001."""
	return bool(frappe.db.exists("Sales Invoice", {"name": ("like", f"SI/%/{abbr}/%")}))
