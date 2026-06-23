import frappe
from frappe import _
import json

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
        conditions.append("(name LIKE %(search)s OR subject LIKE %(search)s OR custom_customer_name LIKE %(search)s)")
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
        SELECT
            name,
            subject,
            status,
            priority,
            custom_customer_name,
            custom_customer_mobile_number,
            custom_address,
            custom_city__district_,
            custom_state,
            custom_machine_name,
            custom_machine_problem,
            custom_date,
            creation,
            modified,
            _assign
        FROM `tabHD Ticket`
        WHERE {where_clause}
        ORDER BY creation DESC
        LIMIT %(limit_start)s, %(limit_page_length)s
    """
    
    values["limit_start"] = int(limit_start)
    values["limit_page_length"] = int(limit_page_length)
    
    tickets = frappe.db.sql(tickets_query, values, as_dict=True)
    
    return {
        "tickets": tickets,
        "total_count": total_count,
        "summary": summary
    }
