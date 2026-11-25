import math
import re
from contextlib import contextmanager
from io import BytesIO

import frappe
from frappe import _
from frappe.utils import (
    add_days,
    cint,
    cstr,
    flt,
    formatdate,
    get_fullname,
    get_user_date_format,
    getdate,
    today,
)

from vin_chakra.technician_api import enrich_tickets_customer_details, get_line_ticket, ticket_claim_key

# Ticket columns shown by the portal's card, list and calendar views
TICKET_COLUMNS = """
    name,
    subject,
    status,
    priority,
    custom_customer_name,
    custom_customer_mobile_number,
    custom__secondary_phone_number,
    custom_address,
    custom_city__district_,
    custom_state,
    custom_machine_name,
    custom_machine_problem,
    custom_required_spares,
    custom_date,
    creation,
    modified,
    _assign,
    customer,
    contact,
    custom_branch,
    ticket_type
"""

@frappe.whitelist()
def get_portal_data(
    status: str = None,
    priority: str = None,
    search_query: str = None,
    limit_start: int = 0,
    limit_page_length: int = 10,
    view: str = "tickets"
):
    user = frappe.session.user
    if user == "Guest":
        frappe.throw(_("Authentication required."), frappe.PermissionError)
        
    cache_key = f"tech_portal:{user}:{status}:{priority}:{search_query}:{limit_start}:{limit_page_length}:{view}"
    cached_res = frappe.cache().get_value(cache_key)
    if cached_res:
        return frappe.parse_json(cached_res)
        
    conditions = ["JSON_SEARCH(`_assign`, 'one', %(user)s) IS NOT NULL"]
    values = {"user": user}
    
    if status:
        conditions.append("status = %(status)s")
        values["status"] = status
    if priority:
        conditions.append("priority = %(priority)s")
        values["priority"] = priority
    if search_query:
        search_escaped = f"%{search_query}%"
        conditions.append("(name LIKE %(search)s OR subject LIKE %(search)s OR custom_customer_name LIKE %(search)s OR customer LIKE %(search)s)")
        values["search"] = search_escaped
        
    where_clause = " AND ".join(conditions)
    
    # 1. Fetch summary counts for the logged-in technician (always calculated from all their tickets)
    summary_query = f"""
        SELECT 
            COUNT(*) as `Total`,
            SUM(CASE WHEN status = 'Open' THEN 1 ELSE 0 END) as `Open`,
            SUM(CASE WHEN status = 'Working' THEN 1 ELSE 0 END) as `Working`,
            SUM(CASE WHEN status = 'Resolved' THEN 1 ELSE 0 END) as `Resolved`,
            SUM(CASE WHEN status = 'Pending' THEN 1 ELSE 0 END) as `Pending`
        FROM `tabHD Ticket`
        WHERE JSON_SEARCH(`_assign`, 'one', %(user)s) IS NOT NULL
    """
    summary_data = frappe.db.sql(summary_query, {"user": user}, as_dict=True)
    summary = {
        "Total": 0,
        "Open": 0,
        "Working": 0,
        "Resolved": 0,
        "Pending": 0
    }
    if summary_data:
        summary = {
            "Total": int(summary_data[0].get("Total") or 0),
            "Open": int(summary_data[0].get("Open") or 0),
            "Working": int(summary_data[0].get("Working") or 0),
            "Resolved": int(summary_data[0].get("Resolved") or 0),
            "Pending": int(summary_data[0].get("Pending") or 0)
        }
        
    # 2. Fetch tickets count and ticket list
    total_count_query = f"""
        SELECT COUNT(*) 
        FROM `tabHD Ticket`
        WHERE {where_clause}
    """
    total_count = frappe.db.sql(total_count_query, values)[0][0]
    
    tickets_query = f"""
        SELECT {TICKET_COLUMNS}
        FROM `tabHD Ticket`
        WHERE {where_clause}
        ORDER BY creation DESC
        LIMIT %(limit_start)s, %(limit_page_length)s
    """

    values["limit_start"] = int(limit_start)
    values["limit_page_length"] = int(limit_page_length)

    tickets = frappe.db.sql(tickets_query, values, as_dict=True)
    tickets = enrich_tickets_customer_details(tickets)
    attach_machines_and_invoices(tickets)

    result = {
        "tickets": tickets,
        "total_count": total_count,
        "summary": summary
    }
    frappe.cache().set_value(cache_key, result, expires_in_sec=600)
    return result


# The Expense Claim popup is further down in this file. These are the methods it used before
# (one claim per technician, saved by Share); a page still cached on a phone gets a message
# to reload instead of writing claims the old way.
def _expense_claim_moved():
    frappe.throw(_("The Expense Claim screen has been updated. Please reload the page and try again."))


@frappe.whitelist()
def get_expense_claim_tickets(date_range: str = "today"):
    _expense_claim_moved()


@frappe.whitelist()
def save_to_expense_claim(amounts=None, types=None):
    _expense_claim_moved()


@frappe.whitelist()
def download_expense_claim(date_range: str = "today", amounts=None, types=None):
    _expense_claim_moved()


def attach_machines_and_invoices(tickets):
    """Add each ticket's machine rows and latest non-cancelled Sales Invoice."""
    if not tickets:
        return

    ticket_names = [t["name"] for t in tickets]
    child_rows = frappe.get_all(
        "Machine type list",
        filters={"parent": ["in", ticket_names], "parenttype": "HD Ticket"},
        fields=["parent", "machine_type", "machine_name", "machine_brand", "machine_quantity", "machine_problem", "purchased_at_scs", "purchase_year"],
        order_by="idx asc"
    )
    child_map = {}
    for row in child_rows:
        p = row["parent"]
        if p not in child_map:
            child_map[p] = []
        child_map[p].append(row)

    # Fetch any linked Sales Invoices
    inv_rows = frappe.get_all(
        "Sales Invoice",
        filters={"custom_hd_ticket": ["in", ticket_names], "docstatus": ["!=", 2]},
        fields=["name", "custom_hd_ticket", "grand_total", "docstatus"],
        order_by="creation desc"
    )
    inv_map = {}
    for inv in inv_rows:
        tk = inv.get("custom_hd_ticket")
        if tk and tk not in inv_map:
            inv_map[tk] = inv

    for t in tickets:
        t["custom_machine_type_list"] = child_map.get(t["name"], [])
        t["sales_invoice"] = inv_map.get(t["name"])


# --- Expense Claim popup ------------------------------------------------------------------
#
# The popup lists the tickets the technician visited (checked in or out) Today or in the Last
# 1 Week. Each ticket has one HRMS Expense Claim per technician, filled in like the paper
# "Staff Tour Settlement" form (the Expense Claim hooks are in vin_chakra/technician_api.py).
#
# Only `save_ticket_expense_claim` writes, and only a draft claim: HR submits and pays it as
# usual. `download_expense_claim_excel` (Share) runs in a read-only database transaction, so it
# can't change anything. The older methods above only ask an outdated page to reload.

# List ranges: days back from today, both ends inclusive
# Pages from before the From / To dates send a range: the day `date` ("today" before the date
# picker), or the 7 days up to it
EXPENSE_CLAIM_RANGES = {"day": 0, "today": 0, "last_week": 6}
MAX_LIST_DAYS = 92  # the longest From–To period the list and its Excel take

# "If amount payable by customer", pre-filled from the ticket's Mode of Payment
PAYABLE_BY_MODE = {"Cash": "Yes", "Credit": "Yes", "Warranty": "No", "Re-service": "No"}

MAX_EXPENSE_ROWS = 50
MAX_TRIP_DAYS = 31
MAX_TICKETS_PER_SAVE = 50

EXPENSE_TICKET_COLUMNS = """
    name, status, ticket_type, custom_customer_name, customer, contact,
    custom_customer_mobile_number, custom_address, custom_city__district_,
    custom_state, custom_mode_of_payment, custom_machine_name
"""

EXPENSE_CLAIM_FIELDS = [
    "name", "docstatus", "status", "approval_status", "modified", "posting_date", "currency",
    "custom_ticket_claim_key", "custom_journey_date", "custom_no_of_days", "custom_trip_reason",
    "custom_from_location", "custom_to_location", "custom_payable_by_customer",
    "custom_amount_collected", "total_claimed_amount",
]


# --- Whitelisted methods ---------------------------------------------------------------


@frappe.whitelist()
def get_expense_claim_list(
    from_date: str | None = None, to_date: str | None = None, date_range: str | None = None, date: str | None = None
):
    """List screen: the tickets the user visited from `from_date` to `to_date` (both included;
    today when not sent), each with its claim (if any). `date_range` / `date`: older pages."""
    user = require_login()
    from_date, to_date = get_list_period(from_date, to_date, date_range, date)
    tickets = get_visited_tickets(user, from_date, to_date)
    employee = get_employee(user, required=False)
    claims = get_active_claims(employee, [t["name"] for t in tickets])
    return {
        "from_date": from_date,
        "to_date": to_date,
        "currency": get_currency(employee),
        "employee_missing": not employee,
        "tickets": [
            {
                "name": t["name"],
                "customer_name": t.get("custom_customer_name") or "",
                "status": t.get("status"),
                "visit_date": getdate(t["visit_date"]),
                "claim": claim_summary(claims.get(t["name"])),
            }
            for t in tickets
        ],
    }


@frappe.whitelist()
def get_ticket_expense_claim(ticket: str, from_date: str | None = None, to_date: str | None = None):
    """Ticket screen: the ticket, its To Location, the user's claim for it and the form defaults.
    `from_date` / `to_date`: the list's period; the defaults come from the visits in it."""
    user = require_login()
    t = get_visited_ticket(user, ticket)
    visits = period_visits(get_visits(user, ticket), parse_period(from_date, to_date))
    employee = get_employee(user, required=False)
    claim = get_active_claims(employee, [ticket]).get(ticket)
    to_location, warning = get_to_location(t)
    return {
        "ticket": {
            "name": t["name"],
            "customer_name": t.get("custom_customer_name") or "",
            "status": t.get("status"),
            "visit_date": getdate(t["visit_date"]),
            "machine": t["machine_display"],
            "call_type": t.get("ticket_type") or "",
        },
        "to_location": to_location,
        "to_location_warning": warning,
        "defaults": get_defaults(t, visits),
        "claim": claim_payload(claim),
        "cancelled_claim": get_cancelled_claim(employee, ticket),
        "expense_types": get_technician_expense_types(employee.company if employee else None),
        "currency": get_currency(employee),
        "employee_missing": not employee,
    }


@frappe.whitelist(methods=["POST"])
def save_expense_claims(claims: str | dict):
    """Save: store the unsaved expenses of one or several tickets, {ticket: values} (values as for
    save_ticket_expense_claim): the ticket screen's Save sends its ticket, the list's Save every
    ticket with unsaved changes. Each ticket gets its own savepoint, so one ticket's problem
    doesn't stop the others. Returns {"saved": {ticket: claim}, "errors": {ticket: message}}."""
    user = require_login()
    claims = parse_dict(claims, _("Expense Claims"))
    if not claims:
        frappe.throw(_("There are no changes to save."))
    if len(claims) > MAX_TICKETS_PER_SAVE:
        frappe.throw(_("At most {0} tickets can be saved at once.").format(MAX_TICKETS_PER_SAVE))
    employee = get_employee(user)
    saved, errors = {}, {}
    for idx, (ticket, values) in enumerate(claims.items()):
        savepoint = f"expense_claim_{idx}"
        frappe.db.savepoint(savepoint)
        try:
            saved[ticket] = save_ticket_claim(user, employee, cstr(ticket), parse_dict(values, _("Expense Claim")))
            frappe.db.release_savepoint(savepoint)
        except (frappe.ValidationError, frappe.PermissionError) as e:
            frappe.db.rollback(save_point=savepoint)
            frappe.clear_messages()  # reported per ticket below, not as a dialog
            errors[ticket] = cstr(e) or _("Could not be saved.")
    return {"saved": saved, "errors": errors}


@frappe.whitelist(methods=["POST"])
def save_ticket_expense_claim(ticket: str, values: str | dict):
    """Save one ticket's expenses (only for pages opened before the popup's Save buttons moved to
    save_expense_claims). Returns {"claim": the saved claim}."""
    user = require_login()
    employee = get_employee(user)
    return {"claim": save_ticket_claim(user, employee, ticket, parse_dict(values, _("Expense Claim")))}


def save_ticket_claim(user, employee, ticket, values):
    """Create or update the user's draft Expense Claim for the ticket; returns it.

    `values`: {from_location, journey_date, no_of_days, payable_by_customer, amount_collected,
    expenses: [{name?, expense_type, amount}], modified, visit_from, visit_to}. The Reason for
    Trip is the ticket's Call Type, as the To Location is its customer address. `modified` is
    the claim's timestamp when the popup loaded it (empty for a new claim); a claim changed
    since (e.g. by HR) is not overwritten, and a ticket never gets a second claim.
    `visit_from` / `visit_to`: the list's period; new lines are dated by the last visit in it.
    Totals are worked out by HRMS on save.
    """
    t = get_visited_ticket(user, ticket)
    visits = period_visits(get_visits(user, ticket), parse_period(values.get("visit_from"), values.get("visit_to")))
    to_location, warning = get_to_location(t)
    if not to_location:
        frappe.throw(warning)
    form = clean_form(values, employee)

    claim = get_active_claims(employee, [ticket]).get(ticket)
    if claim and (claim.docstatus == 1 or claim.get("legacy")):
        frappe.throw(
            _("Expense Claim {0} for ticket {1} is already {2}, so it can't be changed here. Please contact HR.").format(
                claim.name, ticket, _(claim_status(claim))
            )
        )
    if claim:
        doc = frappe.get_doc("Expense Claim", claim.name)
        if cstr(values.get("modified")) != str(doc.modified):
            frappe.throw(_("Expense Claim {0} was changed after you opened it. Go back to the ticket list and open the ticket again to see the latest version.").format(doc.name))
    elif values.get("modified"):
        frappe.throw(_("The Expense Claim you opened for ticket {0} no longer exists (it was cancelled or deleted). Go back to the ticket list and open the ticket again.").format(ticket))
    else:
        doc = new_expense_claim(employee)
        doc.custom_ticket_claim_key = ticket_claim_key(ticket, employee.name)
        doc.amended_from = get_cancelled_claim(employee, ticket)

    doc.update({
        "custom_customer_name": t.get("custom_customer_name") or "",
        "custom_journey_date": form["journey_date"],
        "custom_no_of_days": form["no_of_days"],
        "custom_trip_reason": t.get("ticket_type") or "",
        "custom_from_location": form["from_location"],
        "custom_to_location": to_location["text"],
        "custom_payable_by_customer": form["payable_by_customer"],
        "custom_amount_collected": form["amount_collected"],
    })
    set_expense_rows(doc, form["expenses"], t, visits)

    # Two saves at the same moment (two tabs, a double tap) can't both create a claim: the
    # second hits the unique Ticket Claim Key, or finds the claim changed under it. A row lock
    # wouldn't help here: MariaDB runs REPEATABLE READ with innodb_snapshot_isolation, so the
    # second request would still read its older snapshot.
    try:
        doc.save()
    except (frappe.UniqueValidationError, frappe.DuplicateEntryError, frappe.TimestampMismatchError, frappe.QueryDeadlockError):
        frappe.clear_messages()  # e.g. "Ticket Claim Key must be unique"
        frappe.throw(_("This ticket's Expense Claim was just saved from another screen. Go back to the ticket list and open the ticket again."))

    claim = frappe._dict(frappe.db.get_value("Expense Claim", doc.name, EXPENSE_CLAIM_FIELDS, as_dict=True))
    return claim_payload(claim)


@frappe.whitelist(methods=["POST"])
def download_expense_claim_excel(
    ticket: str | None = None,
    date_range: str | None = None,
    date: str | None = None,
    drafts: str | dict | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
):
    """Share (Excel): a compact sheet with one row per ticket: the ticket from its screen, or the
    list's tickets (`from_date` to `to_date`; `date_range` / `date` from older pages). `drafts` ({ticket: values as sent to save_ticket_expense_claim})
    holds edits not saved yet, which are exported as shown. Never writes to the database."""
    user = require_login()
    drafts = parse_dict(drafts, _("Unsaved changes"))
    with read_only_transaction():
        employee = get_employee(user, required=False)
        types = get_technician_expense_types(employee.company if employee else None)
        if ticket:
            t = get_visited_ticket(user, ticket)
            sheets = [get_export_ticket(user, employee, t, drafts.get(ticket))]
            period = None
            filename = f"expense_claim_{ticket}_{today()}.xlsx"
        else:
            period = get_list_period(from_date, to_date, date_range, date)
            tickets = get_visited_tickets(user, *period)
            sheets = [get_export_ticket(user, employee, t, drafts.get(t["name"])) for t in tickets]
            filename = f"expense_claim_{period[0]}_{period[1]}.xlsx" if period[0] != period[1] else f"expense_claim_{period[1]}.xlsx"
        content = build_expense_claim_xlsx(user, employee, sheets, types, period)
    frappe.response["filename"] = filename
    frappe.response["filecontent"] = content
    frappe.response["type"] = "binary"


@frappe.whitelist(methods=["POST"])
def get_expense_claim_print(
    ticket: str | None = None,
    drafts: str | dict | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
):
    """Print: one "Staff Tour Settlement" form per claimed ticket. Never writes."""
    user = require_login()
    drafts = parse_dict(drafts, _("Unsaved changes"))
    with read_only_transaction():
        employee = get_employee(user, required=False)
        period = None if ticket else get_list_period(from_date, to_date)
        forms = [print_form(v) for v in get_export_sheets(user, employee, ticket, period, drafts)]
    return {"employee_name": employee.employee_name if employee else get_fullname(user), "forms": forms}


def get_export_sheets(user, employee, ticket, period, drafts):
    """Tickets to export. Only tickets with claimed expenses are kept."""
    tickets = [get_visited_ticket(user, ticket)] if ticket else get_visited_tickets(user, *period)
    claims = get_active_claims(employee, [t["name"] for t in tickets])  # one query for all tickets
    sheets = [get_export_ticket(user, employee, t, drafts.get(t["name"])) for t in tickets]
    sheets = [v for v in sheets if flt(v.get("total")) > 0]
    if not sheets:
        frappe.throw(_("There are no claimed expenses to export."))
    return sheets


# Expense type -> line of the paper form; anything else goes to line 11 (Others)
FORM_LINES = (
    ("fare", ("bus", "train", "fare")),
    ("hotel", ("hotel",)),
    ("conveyance", ("conveyance", "taxi", "auto")),
    ("food", ("food", "meal")),
)


def form_line(expense_type):
    name = cstr(expense_type).lower()
    return next((line for line, words in FORM_LINES if any(w in name for w in words)), "others")


def print_form(v):
    lines = dict.fromkeys(("fare", "hotel", "conveyance", "food", "others"), 0)
    others = []
    for name, amount in type_totals(v["expenses"]).items():
        line = form_line(name)
        lines[line] += amount
        if line == "others":
            others.append(name)
    return {
        "ticket": v["ticket"],
        "customer_name": v["customer_name"],
        "journey_date": v.get("journey_date") or v["visit_date"],
        "no_of_days": v.get("no_of_days") or 1,
        "from_location": v.get("from_location") or "",
        "to_location": v.get("to_location") or "",
        "trip_reason": v.get("trip_reason") or "",
        "payable_by_customer": v.get("payable_by_customer") or "",
        "amount_collected": v.get("amount_collected"),
        "lines": {k: flt(x, 2) for k, x in lines.items()},
        "others_note": ", ".join(others),
        "total": flt(sum(lines.values()), 2),
    }

# --- Tickets and visits ------------------------------------------------------------------


def require_login():
    if frappe.session.user == "Guest":
        frappe.throw(_("Authentication required."), frappe.PermissionError)
    return frappe.session.user


def get_list_period(from_date=None, to_date=None, date_range=None, date=None):
    """(from_date, to_date) of the list, both included: the From and To dates (To defaults to
    today, From to To), or an older page's range. Not in the future, From not after To, and at
    most MAX_LIST_DAYS days."""
    if date_range:
        if date_range not in EXPENSE_CLAIM_RANGES:
            frappe.throw(_("Unknown date range: {0}").format(date_range))
        to_day = parse_list_date(date) or getdate(today())
        from_day = add_days(to_day, -EXPENSE_CLAIM_RANGES[date_range])
    else:
        to_day = parse_list_date(to_date) or getdate(today())
        from_day = parse_list_date(from_date) or to_day
    if to_day > getdate(today()):
        frappe.throw(_("The dates can't be in the future."))
    if from_day > to_day:
        frappe.throw(_("The From date can't be after the To date."))
    if (to_day - from_day).days >= MAX_LIST_DAYS:
        frappe.throw(_("Choose a period of up to {0} days.").format(MAX_LIST_DAYS))
    return from_day, to_day


def parse_list_date(value):
    if not cstr(value).strip():
        return None
    try:
        return getdate(value)
    except Exception:
        frappe.throw(_("{0} is not a valid date.").format(value))


def parse_period(from_date, to_date):
    """(from, to) of the list the ticket was opened from, or None when not sent or not valid."""
    if not (cstr(from_date).strip() and cstr(to_date).strip()):
        return None
    try:
        period = getdate(from_date), getdate(to_date)
    except Exception:
        return None
    return period if period[0] <= period[1] else None


def period_visits(visits, period):
    """The visits in the period; all of them when it has none (or there is no period)."""
    if not period:
        return visits
    return [v for v in visits if period[0] <= getdate(v.timestamp) <= period[1]] or visits


USER_VISITS = """
    FROM `tabHD Ticket Check Log` check_log
    WHERE check_log.parenttype = 'HD Ticket'
        AND check_log.parent = `tabHD Ticket`.name
        AND check_log.technician = %(user)s
"""


def get_visited_tickets(user, from_date, to_date):
    """Tickets the user checked in or out of between the dates (inclusive), whatever their status,
    newest visit first. `visit_date` is the user's last visit."""
    tickets = frappe.db.sql(
        f"""
        SELECT {EXPENSE_TICKET_COLUMNS}, (SELECT MAX(check_log.timestamp) {USER_VISITS}) AS visit_date
        FROM `tabHD Ticket`
        WHERE EXISTS (SELECT 1 {USER_VISITS} AND DATE(check_log.timestamp) BETWEEN %(from_date)s AND %(to_date)s)
        ORDER BY visit_date DESC
        """,
        {"user": user, "from_date": from_date, "to_date": to_date},
        as_dict=True,
    )
    return add_ticket_details(tickets)


def get_visited_ticket(user, ticket):
    """The ticket, if the user ever checked in or out of it; otherwise a PermissionError."""
    tickets = frappe.db.sql(
        f"""
        SELECT {EXPENSE_TICKET_COLUMNS}, (SELECT MAX(check_log.timestamp) {USER_VISITS}) AS visit_date
        FROM `tabHD Ticket`
        WHERE name = %(ticket)s AND EXISTS (SELECT 1 {USER_VISITS})
        """,
        {"user": user, "ticket": cstr(ticket)},
        as_dict=True,
    )
    if not tickets:
        frappe.throw(_("Ticket {0} is not a ticket you have visited.").format(ticket), frappe.PermissionError)
    return add_ticket_details(tickets)[0]


def add_ticket_details(tickets):
    """Fill the customer name from the Customer when the ticket has none, and add `machine_display`."""
    tickets = enrich_tickets_customer_details(tickets)
    attach_machines_and_invoices(tickets)
    for t in tickets:
        machines = (m.get("machine_name") or m.get("machine_type") for m in t["custom_machine_type_list"])
        t["machine_display"] = ", ".join(filter(None, machines)) or t.get("custom_machine_name") or ""
    return tickets


def get_visits(user, ticket):
    """The user's check-ins and check-outs at the ticket, oldest first."""
    return frappe.get_all(
        "HD Ticket Check Log",
        filters={"parenttype": "HD Ticket", "parent": ticket, "technician": user},
        fields=["check_type", "timestamp"],
        order_by="timestamp asc",
    )


def get_to_location(t):
    """(to_location, warning): where the technician went, the customer's address: the ticket's
    Address, City / District and State, filled from the customer's address when the ticket has
    none (enrich_tickets_customer_details). Without one, (None, warning) and Save waits."""
    address = customer_address(t)
    if not address:
        return None, _("This ticket has no customer address, so the To Location can't be filled in. Ask the office to add the address to the ticket or the customer.")
    return {"text": address}, None


def customer_address(t):
    """The ticket's Address, City / District and State on one line, without repeating a part
    the address already has (e.g. its city)."""
    parts = []
    for value in (t.get("custom_address"), t.get("custom_city__district_"), t.get("custom_state")):
        for part in re.split(r"[\n,]+", cstr(value)):
            part = " ".join(part.split())
            if part and part.lower() not in {p.lower() for p in parts}:
                parts.append(part)
    return ", ".join(parts)


def get_defaults(t, visits):
    """Form values for a ticket without a claim, from the ticket and the user's visits."""
    days = {getdate(v.timestamp) for v in visits}
    return {
        "journey_date": min(days) if days else getdate(t["visit_date"]),
        "no_of_days": max(1, min(len(days), MAX_TRIP_DAYS)),
        "payable_by_customer": PAYABLE_BY_MODE.get(t.get("custom_mode_of_payment"), ""),
    }


# --- Employee and claims -----------------------------------------------------------------


def get_employee(user, required=True):
    employee = frappe.db.get_value(
        "Employee", {"user_id": user, "status": "Active"}, ["name", "company", "employee_name"], as_dict=True
    )
    if not employee and required:
        frappe.throw(_("No active Employee is linked to your user, so you can't make an Expense Claim. Please contact HR."))
    return employee


def get_currency(employee):
    company = employee.company if employee else frappe.defaults.get_global_default("company")
    return (company and frappe.get_cached_value("Company", company, "default_currency")) or frappe.defaults.get_global_default("currency")


def get_active_claims(employee, tickets):
    """{ticket: claim} for the employee's draft or submitted claim of each ticket, with its
    `expenses`. A submitted claim from before one-claim-per-ticket can hold several tickets;
    such a ticket gets that claim with only its own lines and `legacy` set."""
    if not employee or not tickets:
        return {}
    claims = {}
    keys = {ticket_claim_key(ticket, employee.name): ticket for ticket in tickets}
    for claim in frappe.get_all(
        "Expense Claim",
        filters={"employee": employee.name, "custom_ticket_claim_key": ["in", list(keys)], "docstatus": ["<", 2]},
        fields=EXPENSE_CLAIM_FIELDS,
        order_by="creation asc",
    ):
        claims[keys[claim.custom_ticket_claim_key]] = claim
    expenses = get_expenses([c.name for c in claims.values()])
    for claim in claims.values():
        claim.expenses = expenses.get(claim.name, [])

    missing = set(tickets) - set(claims)
    if missing:
        lines = frappe.db.sql(
            f"""
            SELECT detail.name, detail.parent, detail.description, detail.expense_type, detail.amount,
                detail.expense_date, {", ".join(f"claim.{f} AS claim_{f}" for f in EXPENSE_CLAIM_FIELDS)}
            FROM `tabExpense Claim Detail` detail
            JOIN `tabExpense Claim` claim ON claim.name = detail.parent AND detail.parenttype = 'Expense Claim'
            WHERE claim.employee = %(employee)s AND claim.docstatus = 1
                AND IFNULL(claim.custom_ticket_claim_key, '') = '' AND detail.description LIKE %(marker)s
            ORDER BY claim.creation, detail.idx
            """,
            {"employee": employee.name, "marker": "%Ticket %"},
            as_dict=True,
        )
        for line in lines:
            ticket = get_line_ticket(line.description)
            if ticket not in missing:
                continue
            claim = claims.get(ticket)
            if not claim or claim.name != line.parent:
                claim = claims[ticket] = frappe._dict(
                    {f: line[f"claim_{f}"] for f in EXPENSE_CLAIM_FIELDS}, legacy=True, expenses=[], total_claimed_amount=0
                )
            claim.expenses.append(frappe._dict(name=line.name, expense_type=line.expense_type, amount=line.amount, expense_date=line.expense_date))
            claim.total_claimed_amount = flt(claim.total_claimed_amount) + flt(line.amount)
    return claims


def get_expenses(claim_names):
    """{claim: [expense rows]} in their order on the claim."""
    expenses = {}
    if claim_names:
        for row in frappe.get_all(
            "Expense Claim Detail",
            filters={"parent": ["in", claim_names], "parenttype": "Expense Claim"},
            fields=["name", "parent", "expense_type", "amount", "expense_date"],
            order_by="idx asc",
        ):
            expenses.setdefault(row.parent, []).append(row)
    return expenses


def get_cancelled_claim(employee, ticket):
    """The employee's latest cancelled claim for the ticket; a new claim is its amendment."""
    if not employee:
        return None
    return frappe.db.get_value(
        "Expense Claim",
        {"custom_ticket_claim_key": ["like", f"{ticket_claim_key(ticket, employee.name)}::%"], "docstatus": 2},
        "name",
        order_by="creation desc",
    )


def claim_status(claim):
    """The claim's status as HR sees it: Draft, Unpaid, Paid, Rejected, ..."""
    if claim.docstatus == 0:
        return "Draft"
    if claim.approval_status == "Rejected":
        return "Rejected"
    return claim.status or "Submitted"


def claim_summary(claim):
    if not claim:
        return None
    return {
        "name": claim.name,
        "status": claim_status(claim),
        "locked": bool(claim.docstatus == 1 or claim.get("legacy")),
        "total": flt(claim.total_claimed_amount),
        "rows": len(claim.get("expenses") or []),
    }


def claim_payload(claim):
    if not claim:
        return None
    if "expenses" not in claim:
        claim.expenses = get_expenses([claim.name]).get(claim.name, [])
    legacy = bool(claim.get("legacy"))
    return {
        "name": claim.name,
        "docstatus": claim.docstatus,
        "status": claim_status(claim),
        "locked": bool(claim.docstatus == 1 or legacy),
        "legacy": legacy,
        "modified": str(claim.modified),
        "journey_date": claim.custom_journey_date,
        "no_of_days": cint(claim.custom_no_of_days) or None,
        "trip_reason": claim.custom_trip_reason or "",
        "from_location": claim.custom_from_location or "",
        "to_location": display_place(claim.custom_to_location),
        "payable_by_customer": claim.custom_payable_by_customer or "",
        "amount_collected": flt(claim.custom_amount_collected) if claim.custom_payable_by_customer == "Yes" else None,
        "total": flt(claim.total_claimed_amount),
        "expenses": [
            {"name": r.name, "expense_type": r.expense_type, "amount": flt(r.amount), "expense_date": r.expense_date}
            for r in claim.expenses
        ],
    }


def new_expense_claim(employee):
    """An empty draft Expense Claim for the employee, filled in as the HRMS form does."""
    import erpnext
    from hrms.hr.doctype.expense_claim.expense_claim import get_default_payable_account

    return frappe.get_doc({
        "doctype": "Expense Claim",
        "employee": employee.name,
        "company": employee.company,
        "posting_date": today(),
        "expense_approver": frappe.db.get_value("Employee", employee.name, "expense_approver"),
        "payable_account": get_default_payable_account(employee.company),
        "cost_center": erpnext.get_default_cost_center(employee.company),
        "remark": _("Ticket expenses from the Technician Portal"),
    })


def set_expense_rows(doc, expenses, t, visits):
    """Make the claim's lines match the form: rows sent with a `name` update that line (keeping
    its date), new rows are added for the user's last visit, and lines not sent are removed."""
    existing = {row.name: row for row in doc.get("expenses") or []}
    last_visit = getdate(visits[-1].timestamp) if visits else getdate(t["visit_date"])
    description = " · ".join(filter(None, (f"Ticket {t['name']}", t.get("custom_customer_name"), t["machine_display"])))
    rows = []
    for expense in expenses:
        row = existing.pop(expense.get("name"), None) if expense.get("name") else None
        if row is None:
            row = frappe.get_doc({
                "doctype": "Expense Claim Detail",
                "expense_date": last_visit,
                # "Ticket <name>" stays untranslated: HR reads it, and old claims are found by it
                "description": description,
                "cost_center": doc.cost_center,
            })
        if row.expense_type != expense["expense_type"]:
            row.expense_type = expense["expense_type"]
            row.default_account = None  # HRMS fetches the type's account on save
        row.amount = row.sanctioned_amount = expense["amount"]
        rows.append(row)
    doc.set("expenses", [])
    for idx, row in enumerate(rows, start=1):
        row.idx = idx  # kept lines would otherwise keep their old position
        doc.append("expenses", row)


# --- Validation -------------------------------------------------------------------------


def parse_dict(value, label):
    if isinstance(value, str):
        value = frappe.parse_json(value) if value.strip() else {}
    if not isinstance(value or {}, dict):
        frappe.throw(_("{0}: invalid data.").format(label))
    return value or {}


def parse_amount(value, label, allow_zero=False):
    """The amount as a number rounded to 2 decimals, or None when empty."""
    if value is None or cstr(value).strip() == "":
        return None
    try:
        amount = float(cstr(value).strip())
    except ValueError:
        amount = math.nan
    if not math.isfinite(amount) or amount < 0 or (amount == 0 and not allow_zero):
        frappe.throw(_("{0}: enter an amount above 0.").format(label) if not allow_zero else _("{0}: enter a valid amount.").format(label))
    return flt(amount, 2)


def clean_form(values, employee):
    """The form's values, checked; any problem stops the save with a message."""
    from_location = cstr(values.get("from_location")).strip()
    if not from_location:
        frappe.throw(_("Enter the From Location (where you started)."))
    if len(from_location) > 140:
        frappe.throw(_("From Location can be at most 140 characters."))

    journey_date = cstr(values.get("journey_date")).strip()
    try:
        journey_date = getdate(journey_date) if journey_date else None
    except Exception:
        journey_date = None
    if not journey_date:
        frappe.throw(_("Enter a valid Date of Journey."))
    if journey_date > getdate(today()):
        frappe.throw(_("Date of Journey can't be in the future."))

    days = cstr(values.get("no_of_days")).strip()
    if not days.isdigit() or not 1 <= int(days) <= MAX_TRIP_DAYS:
        frappe.throw(_("No. of Days must be a whole number from 1 to {0}.").format(MAX_TRIP_DAYS))

    payable = cstr(values.get("payable_by_customer"))
    if payable not in ("Yes", "No"):
        frappe.throw(_("Select whether the amount is payable by the customer (Yes or No)."))
    collected = None
    if payable == "Yes":
        # What the technician collected from the customer: has to be entered, 0 when nothing was paid
        collected = parse_amount(values.get("amount_collected"), _("Amount Collected"), allow_zero=True)
        if collected is None:
            frappe.throw(_("Enter the Amount Collected (0 if nothing was collected)."))

    expenses = values.get("expenses")
    if not isinstance(expenses, list) or not expenses:
        frappe.throw(_("Add at least one expense."))
    if len(expenses) > MAX_EXPENSE_ROWS:
        frappe.throw(_("A claim can have at most {0} expenses.").format(MAX_EXPENSE_ROWS))
    allowed = {t["name"] for t in get_technician_expense_types(employee.company)}
    rows = []
    for idx, expense in enumerate(expenses, start=1):
        if not isinstance(expense, dict):
            frappe.throw(_("Expense {0}: invalid data.").format(idx))
        expense_type = cstr(expense.get("expense_type"))
        if not expense_type:
            frappe.throw(_("Expense {0}: select the expense type.").format(idx))
        if expense_type not in allowed:
            frappe.throw(_("Expense {0}: {1} is not an expense type you can claim.").format(idx, expense_type))
        amount = parse_amount(expense.get("amount"), _("Expense {0}").format(idx))
        if amount is None:
            frappe.throw(_("Expense {0}: enter the amount.").format(idx))
        rows.append({"name": cstr(expense.get("name")) or None, "expense_type": expense_type, "amount": amount})

    return {
        "from_location": from_location,
        "journey_date": journey_date,
        "no_of_days": int(days),
        "payable_by_customer": payable,
        "amount_collected": collected or 0,
        "expenses": rows,
    }


# --- Excel (read-only) ------------------------------------------------------------------


@contextmanager
def read_only_transaction():
    """Run the block in a READ ONLY database transaction, so any write fails, then roll back."""
    if frappe.db.transaction_writes:
        frappe.throw(_("The export can't start after a database change."))
    frappe.db.begin(read_only=True)
    try:
        yield
    finally:
        frappe.db.rollback()


def get_export_ticket(user, employee, t, draft):
    """One ticket's values for the Excel: the saved claim, or the unsaved form when `draft` is sent."""
    claim = get_active_claims(employee, [t["name"]]).get(t["name"])
    saved = claim_payload(claim) or {}
    visits = get_visits(user, t["name"])
    values = dict(saved)
    # As the popup shows it: a submitted claim keeps its own; otherwise the customer's address,
    # which Save would store
    values["to_location"] = saved.get("to_location") if saved.get("locked") else (customer_address(t) or saved.get("to_location") or "")
    values["trip_reason"] = saved.get("trip_reason") if saved.get("locked") else (t.get("ticket_type") or "")
    if draft and not saved.get("locked"):
        draft = parse_dict(draft, _("Unsaved changes"))
        # A line keeps its saved date; a new one gets the date Save would give it
        saved_dates = {e["name"]: e["expense_date"] for e in saved.get("expenses") or []}
        visits = period_visits(visits, parse_period(draft.get("visit_from"), draft.get("visit_to")))
        new_date = getdate(visits[-1].timestamp) if visits else getdate(t["visit_date"])
        days = cstr(draft.get("no_of_days")).strip()
        try:
            journey_date = getdate(draft.get("journey_date")) if cstr(draft.get("journey_date")).strip() else None
        except Exception:
            journey_date = None
        values.update({
            "from_location": cstr(draft.get("from_location")).strip()[:140],
            "journey_date": journey_date,
            "no_of_days": int(days) if days.isdigit() else None,
            "payable_by_customer": cstr(draft.get("payable_by_customer")),
            "amount_collected": parse_amount(draft.get("amount_collected"), _("Amount Collected"), allow_zero=True),
            "expenses": [
                {
                    "expense_type": cstr(e.get("expense_type")),
                    "amount": parse_amount(e.get("amount"), _("Expense {0}").format(idx), allow_zero=True),
                    "expense_date": saved_dates.get(e.get("name")) or new_date,
                }
                for idx, e in enumerate(draft.get("expenses") or [], start=1)
                # a row left empty in the form is not an expense
                if isinstance(e, dict) and (cstr(e.get("expense_type")) or cstr(e.get("amount")).strip())
            ],
        })
        values["total"] = sum(flt(e["amount"]) for e in values["expenses"])
    values.setdefault("expenses", [])
    if values.get("payable_by_customer") != "Yes":
        values["amount_collected"] = None
    values.update({
        "ticket": t["name"],
        "customer_name": t.get("custom_customer_name") or "",
        "ticket_status": t.get("status"),
        "visit_date": getdate(t["visit_date"]),
    })
    return values


def xl_styles():
    from openpyxl.styles import Alignment, Font

    return {
        "font": Font(size=13),
        "bold": Font(size=13, bold=True),
        "wrap": Alignment(vertical="top", wrap_text=True),
        "right": Alignment(horizontal="right", vertical="top"),
        "right_wrap": Alignment(horizontal="right", vertical="top", wrap_text=True),
    }


def journey_period(sheets):
    """(first day, last day) of the exported trips: each from its Date of Journey (else the visit)
    for its No. of Days; None without tickets."""
    days = []
    for v in sheets:
        start = getdate(v.get("journey_date") or v["visit_date"])
        days += [start, add_days(start, max(cint(v.get("no_of_days")), 1) - 1)]
    return (min(days), max(days)) if days else None


def build_expense_claim_xlsx(user, employee, sheets, types, period=None):
    """Share (Excel): "Expense Claim: <employee> (<journey dates>)", then one row per ticket
    (trip details, one column per expense type used, the total and the amount collected) and a
    total row. `period` (from, to) is the heading's dates when there are no tickets."""
    from openpyxl import Workbook
    from openpyxl.utils import get_column_letter

    s = xl_styles()
    money = "#,##0.00"
    totals_per_ticket = [type_totals(v["expenses"]) for v in sheets]
    # A column for each expense type these tickets use, in the dropdown's order (then any type
    # no longer offered, e.g. in an old claim)
    used = {name for totals in totals_per_ticket for name in totals}
    type_labels = [t["name"] for t in types if t["name"] in used]
    type_labels += sorted(used - set(type_labels))

    columns = [
        (_("Ticket No"), 12), (_("Customer"), 28), (_("Date of Journey"), 16), (_("No of Days"), 10),
        (_("From"), 24), (_("To"), 34), (_("Reason for Trip"), 15),
        *[(label, 14) for label in type_labels],
        (_("Total Amount"), 15), (_("Amount Collected"), 15),
    ]
    first_type, total_col = 8, 8 + len(type_labels)

    wb = Workbook()
    ws = wb.active
    ws.title = _("Expense Claim")[:31]
    heading = f"{_('Expense Claim')}: {employee.employee_name if employee else get_fullname(user)}"
    first_day, last_day = journey_period(sheets) or period or (None, None)
    if first_day:
        heading += f" ({formatdate(first_day)})" if first_day == last_day else f" ({formatdate(first_day)} – {formatdate(last_day)})"
    ws.append([heading])
    ws.append([label for label, width in columns])
    date_format = get_user_date_format()
    for v, amounts in zip(sheets, totals_per_ticket):
        ws.append([
            v["ticket"], v["customer_name"], v.get("journey_date") and getdate(v["journey_date"]), v.get("no_of_days"),
            v.get("from_location") or "", v.get("to_location") or "", v.get("trip_reason") or "",
            *[amounts.get(label) or None for label in type_labels],
            flt(v.get("total")) or None, v.get("amount_collected"),
        ])
    last = ws.max_row
    totals = [None] * len(columns)
    totals[first_type - 2] = _("Total")
    for col in range(first_type, total_col + 2):
        totals[col - 1] = sum(flt(ws.cell(r, col).value) for r in range(3, last + 1))
    ws.append(totals)

    total_row = ws.max_row
    for r in ws.iter_rows():
        for cell in r:
            cell.font = s["bold"] if cell.row in (1, 2, total_row) else s["font"]
            if 2 <= cell.row < total_row:  # the header too, so long labels wrap
                cell.alignment = s["wrap"]
    for r in range(3, total_row):
        ws.cell(r, 1).number_format = "@"  # keep ticket numbers like 0624 as text
        ws.cell(r, 3).number_format = date_format
    for col in range(first_type, total_col + 2):
        ws.cell(2, col).alignment = s["right_wrap"]  # amount headings line up with their amounts
        for r in range(3, total_row + 1):
            ws.cell(r, col).number_format = money
    ws.cell(total_row, first_type - 1).alignment = s["right"]
    for idx, (label, width) in enumerate(columns, start=1):
        ws.column_dimensions[get_column_letter(idx)].width = width
    ws.freeze_panes = "B3"
    return save_workbook(wb, landscape=True)


def save_workbook(wb, landscape=False):
    """The workbook as .xlsx bytes, each sheet set to print one page wide on A4."""
    for ws in wb.worksheets:
        ws.page_setup.paperSize = ws.PAPERSIZE_A4
        ws.page_setup.orientation = "landscape" if landscape else "portrait"
        ws.page_setup.fitToWidth = 1
        ws.page_setup.fitToHeight = 0
        ws.sheet_properties.pageSetUpPr.fitToPage = True
    out = BytesIO()
    wb.save(out)
    return out.getvalue()


# --- Expense types and places -------------------------------------------------------------


def get_technician_expense_types(company=None):
    """The expense types technicians pick from, A–Z, as [{name, description}]: every Expense
    Claim Type that has an account for the company (HRMS can't book a line without one)."""
    with_account = set(
        frappe.get_all("Expense Claim Account", filters={"company": company} if company else {}, pluck="parent")
    )
    types = frappe.get_all("Expense Claim Type", fields=["name", "description"], order_by="name asc")
    return [{"name": t.name, "description": cstr(t.description).strip()} for t in types if t.name in with_account]


def type_totals(expenses):
    """{expense type: the sum of its lines}"""
    totals = {}
    for row in expenses:
        if row.get("expense_type"):
            totals[row["expense_type"]] = totals.get(row["expense_type"], 0) + flt(row.get("amount"))
    return totals


POSITION = re.compile(r"\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*")


def display_place(to_location):
    """The To Location to show. Claims saved by an earlier version can hold the check-in's
    "lat, lng"; those numbers are never shown (empty until the claim is saved again)."""
    return "" if POSITION.fullmatch(cstr(to_location)) else cstr(to_location)



# Branch -> region. Branch names unga system-la irukkura exact name-ah check pannikko
BRANCH_REGION = {
    "Chennai Branch": "Chennai",
    "Madurai Head Office": "Madurai",
    "Showroom-Madurai": "Madurai",
    "Dhalavaipuram": "Madurai",
}


def _region_branches(branch):
    region = BRANCH_REGION.get(branch)
    if not region:
        return [branch] if branch else []
    return [b for b, r in BRANCH_REGION.items() if r == region]


@frappe.whitelist()
def get_agents_by_branch(branch=None):
    """HD Agents whose Employee branch is in the selected branch's region."""
    branches = _region_branches(branch)
    if not branches:
        return []
    return frappe.db.sql(
        """
        SELECT agent.name AS user, agent.agent_name, emp.branch
        FROM `tabHD Agent` agent
        JOIN `tabEmployee` emp ON emp.user_id = agent.user AND emp.status = 'Active'
        WHERE emp.branch IN %(branches)s
        ORDER BY agent.agent_name
        """,
        {"branches": tuple(branches)},
        as_dict=True,
    )