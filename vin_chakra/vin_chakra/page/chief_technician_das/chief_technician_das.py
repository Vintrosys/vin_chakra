import frappe

@frappe.whitelist()
def get_dashboard_data(
    date_from: str = None, 
    date_to: str = None, 
    technician: str = None,
    status: str = None,
    priority: str = None,
    search_query: str = None,
    limit_start: int = 0,
    limit_page_length: int = 10,
    view: str = "tickets"
):
    if not (frappe.has_permission("HD Ticket", "read") and ("Chief Technician" in frappe.get_roles() or "System Manager" in frappe.get_roles())):
        frappe.throw("You are not permitted to access this dashboard.")
        
    # Construct base conditions for HD Tickets
    summary_conditions = ["1=1"]
    summary_values = {}
    
    if date_from:
        summary_conditions.append("DATE(creation) >= %(date_from)s")
        summary_values["date_from"] = date_from
    if date_to:
        summary_conditions.append("DATE(creation) <= %(date_to)s")
        summary_values["date_to"] = date_to
    if technician:
        summary_conditions.append("name IN (SELECT reference_name FROM `tabToDo` WHERE reference_type='HD Ticket' AND allocated_to = %(technician)s)")
        summary_values["technician"] = technician
    if search_query:
        search_escaped = f"%{search_query}%"
        summary_conditions.append("(name LIKE %(search)s OR subject LIKE %(search)s OR custom_customer_name LIKE %(search)s)")
        summary_values["search"] = search_escaped

    summary_where = " AND ".join(summary_conditions)

    # 1. TICKETS VIEW
    if view == "tickets":
        # Additional filters for status and priority
        ticket_conditions = summary_conditions[:]
        ticket_values = summary_values.copy()
        
        if status:
            ticket_conditions.append("status = %(status)s")
            ticket_values["status"] = status
        if priority:
            ticket_conditions.append("priority = %(priority)s")
            ticket_values["priority"] = priority
            
        ticket_where = " AND ".join(ticket_conditions)
        
        # Paginated tickets query
        tickets = frappe.db.sql(f"""
            SELECT name, subject, status, priority, custom_customer_name, custom_machine_name, custom_date, _assign
            FROM `tabHD Ticket`
            WHERE {ticket_where}
            ORDER BY creation DESC
            LIMIT {int(limit_start)}, {int(limit_page_length)}
        """, ticket_values, as_dict=True)
        
        # Total count query
        total_count_row = frappe.db.sql(f"""
            SELECT COUNT(name) as count
            FROM `tabHD Ticket`
            WHERE {ticket_where}
        """, ticket_values, as_dict=True)
        total_count = total_count_row[0].count if total_count_row else 0
        
        # Summary card metrics (total, open, working, resolved, pending)
        status_counts_raw = frappe.db.sql(f"""
            SELECT status, COUNT(name) as count
            FROM `tabHD Ticket`
            WHERE {summary_where}
            GROUP BY status
        """, summary_values, as_dict=True)
        
        summary = {
            "Open": 0,
            "Working": 0,
            "Resolved": 0,
            "Pending": 0,
            "Total": 0
        }
        for row in status_counts_raw:
            if row.status in summary:
                summary[row.status] = row.count
            summary["Total"] += row.count
            
        return {
            "tickets": tickets,
            "total_count": total_count,
            "summary": summary
        }

    # 2. ANALYTICS VIEW
    elif view == "analytics":
        # Group status summary
        status_summary = frappe.db.sql(f"""
            SELECT status, COUNT(name) as count
            FROM `tabHD Ticket`
            WHERE {summary_where}
            GROUP BY status
        """, summary_values, as_dict=True)
        
        # Group priority summary
        priority_summary = frappe.db.sql(f"""
            SELECT priority, COUNT(name) as count
            FROM `tabHD Ticket`
            WHERE {summary_where}
            GROUP BY priority
        """, summary_values, as_dict=True)
        
        # Leaderboard performance
        todo_conditions = ["td.reference_type = 'HD Ticket'", "td.allocated_to IS NOT NULL", "td.allocated_to != ''"]
        todo_values = {}
        
        if date_from:
            todo_conditions.append("DATE(t.creation) >= %(date_from)s")
            todo_values["date_from"] = date_from
        if date_to:
            todo_conditions.append("DATE(t.creation) <= %(date_to)s")
            todo_values["date_to"] = date_to
        if technician:
            todo_conditions.append("td.allocated_to = %(technician)s")
            todo_values["technician"] = technician
        if search_query:
            search_escaped = f"%{search_query}%"
            todo_conditions.append("(t.name LIKE %(search)s OR t.subject LIKE %(search)s OR t.custom_customer_name LIKE %(search)s)")
            todo_values["search"] = search_escaped
            
        todo_where = " AND ".join(todo_conditions)
        
        performance = frappe.db.sql(f"""
            SELECT 
                td.allocated_to as assigned_to, 
                COUNT(DISTINCT td.reference_name) as total_assigned,
                SUM(CASE WHEN t.status='Resolved' THEN 1 ELSE 0 END) as total_resolved
            FROM `tabToDo` td
            INNER JOIN `tabHD Ticket` t ON td.reference_name = t.name
            WHERE {todo_where}
            GROUP BY td.allocated_to
            ORDER BY total_resolved DESC
        """, todo_values, as_dict=True)
        
        return {
            "status_summary": status_summary,
            "priority_summary": priority_summary,
            "performance": performance
        }

    # 3. MOVEMENT VIEW
    elif view == "movement":
        movement_conditions = ["cl.latitude IS NOT NULL", "cl.longitude IS NOT NULL"]
        movement_values = {}
        
        if date_from:
            movement_conditions.append("DATE(cl.creation) >= %(date_from)s")
            movement_values["date_from"] = date_from
        if date_to:
            movement_conditions.append("DATE(cl.creation) <= %(date_to)s")
            movement_values["date_to"] = date_to
        if technician:
            movement_conditions.append("cl.technician = %(technician)s")
            movement_values["technician"] = technician
        if search_query:
            search_escaped = f"%{search_query}%"
            movement_conditions.append("(t.name LIKE %(search)s OR t.subject LIKE %(search)s OR t.custom_customer_name LIKE %(search)s)")
            movement_values["search"] = search_escaped
            
        movement_where = " AND ".join(movement_conditions)
        
        movement = frappe.db.sql(f"""
            SELECT 
                cl.name, cl.technician as user, cl.check_type, cl.latitude, cl.longitude, 
                cl.creation, cl.parent as ticket, cl.location_address, t.subject, t.custom_customer_name as customer
            FROM `tabHD Ticket Check Log` cl
            LEFT JOIN `tabHD Ticket` t ON cl.parent = t.name
            WHERE {movement_where}
            ORDER BY cl.creation DESC
            LIMIT {int(limit_start)}, {int(limit_page_length)}
        """, movement_values, as_dict=True)
        
        movement_total_row = frappe.db.sql(f"""
            SELECT COUNT(cl.name) as count
            FROM `tabHD Ticket Check Log` cl
            LEFT JOIN `tabHD Ticket` t ON cl.parent = t.name
            WHERE {movement_where}
        """, movement_values, as_dict=True)
        
        movement_total = movement_total_row[0].count if movement_total_row else 0

        map_points = frappe.db.sql(f"""
            SELECT 
                cl.name, cl.technician as user, cl.check_type, cl.latitude, cl.longitude, 
                cl.creation, cl.parent as ticket, cl.location_address, t.subject, t.custom_customer_name as customer
            FROM `tabHD Ticket Check Log` cl
            LEFT JOIN `tabHD Ticket` t ON cl.parent = t.name
            WHERE {movement_where}
            ORDER BY cl.creation ASC
        """, movement_values, as_dict=True)
        
        return {
            "movement": movement,
            "total_count": movement_total,
            "map_points": map_points
        }
        
    # 4. ATTENDANCE VIEW
    elif view == "attendance":
        attendance_conditions = ["1=1"]
        attendance_values = {}
        
        if date_from:
            attendance_conditions.append("DATE(ec.time) >= %(date_from)s")
            attendance_values["date_from"] = date_from
        if date_to:
            attendance_conditions.append("DATE(ec.time) <= %(date_to)s")
            attendance_values["date_to"] = date_to
        if technician:
            attendance_conditions.append("e.user_id = %(technician)s")
            attendance_values["technician"] = technician
            
        attendance_where = " AND ".join(attendance_conditions)
        
        attendance = frappe.db.sql(f"""
            SELECT 
                ec.name, ec.employee, ec.employee_name, ec.time, ec.log_type, ec.latitude, ec.longitude, ec.device_id, e.user_id
            FROM `tabEmployee Checkin` ec
            LEFT JOIN `tabEmployee` e ON ec.employee = e.name
            WHERE {attendance_where}
            ORDER BY ec.time DESC
            LIMIT {int(limit_start)}, {int(limit_page_length)}
        """, attendance_values, as_dict=True)
        
        attendance_total_row = frappe.db.sql(f"""
            SELECT COUNT(ec.name) as count
            FROM `tabEmployee Checkin` ec
            LEFT JOIN `tabEmployee` e ON ec.employee = e.name
            WHERE {attendance_where}
        """, attendance_values, as_dict=True)
        
        attendance_total = attendance_total_row[0].count if attendance_total_row else 0
        
        return {
            "attendance": attendance,
            "total_count": attendance_total
        }
