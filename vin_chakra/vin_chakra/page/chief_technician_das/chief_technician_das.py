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
        
    # Sanitize input parameters to normalize empty strings/falsy values
    date_from = date_from if date_from not in (None, "", "None", "null", "undefined") else None
    date_to = date_to if date_to not in (None, "", "None", "null", "undefined") else None
    technician = technician if technician not in (None, "", "None", "null", "undefined") else None
    status = status if status not in (None, "", "None", "null", "undefined") else None
    priority = priority if priority not in (None, "", "None", "null", "undefined") else None
    search_query = search_query if search_query not in (None, "", "None", "null", "undefined") else None

        
    # Construct base conditions for HD Tickets
    summary_conditions = ["status NOT IN ('Replied', 'Closed')"]
    summary_values = {}
    
    if date_from or date_to:
        date_conds = []
        if date_from:
            date_conds.append("COALESCE(custom_date, DATE(creation)) >= %(date_from)s")
            summary_values["date_from"] = date_from
        if date_to:
            date_conds.append("COALESCE(custom_date, DATE(creation)) <= %(date_to)s")
            summary_values["date_to"] = date_to
            
        subquery_conds = []
        if date_from:
            subquery_conds.append("DATE(timestamp) >= %(date_from)s")
        if date_to:
            subquery_conds.append("DATE(timestamp) <= %(date_to)s")
            
        working_conds = ["status = 'Working'"]
        if date_from:
            working_conds.append("%(today)s >= %(date_from)s")
        if date_to:
            working_conds.append("%(today)s <= %(date_to)s")
        summary_values["today"] = frappe.utils.today()
        
        summary_conditions.append(f"""(
            ({" AND ".join(date_conds)})
            OR name IN (SELECT parent FROM `tabHD Ticket Check Log` WHERE {" AND ".join(subquery_conds)})
            OR ({" AND ".join(working_conds)})
        )""")
    if technician:
        summary_conditions.append("`tabHD Ticket`._assign LIKE %(technician_like)s")
        summary_values["technician_like"] = f'%"{technician}"%'
    if priority:
        summary_conditions.append("priority = %(priority)s")
        summary_values["priority"] = priority
    if search_query:
        search_escaped = f"%{search_query}%"
        summary_conditions.append("(name LIKE %(search)s OR subject LIKE %(search)s OR custom_customer_name LIKE %(search)s)")
        summary_values["search"] = search_escaped

    summary_where = " AND ".join(summary_conditions)

    result = {}

    # 1. TICKETS VIEW
    if view == "tickets":
        # Additional filters for status
        ticket_conditions = summary_conditions[:]
        ticket_values = summary_values.copy()
        
        if status:
            ticket_conditions.append("status = %(status)s")
            ticket_values["status"] = status
            
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
        
        # Fetch enabled ticket statuses (excluding Replied and Closed)
        enabled_statuses = frappe.cache().get_value("enabled_hd_ticket_statuses")
        if not enabled_statuses:
            enabled_statuses = frappe.get_all(
                "HD Ticket Status",
                filters={
                    "enabled": 1,
                    "name": ["not in", ["Replied", "Closed"]]
                },
                fields=["name", "color"],
                order_by="order asc, name asc"
            )
            frappe.cache().set_value("enabled_hd_ticket_statuses", enabled_statuses, expires_in_sec=3600)
        else:
            enabled_statuses = frappe.parse_json(enabled_statuses)
            
        summary = {"Total": 0}
        for status_obj in enabled_statuses:
            summary[status_obj.name] = 0
            
        for row in status_counts_raw:
            if row.status in summary:
                summary[row.status] = row.count
            summary["Total"] += row.count
            
        result = {
            "tickets": tickets,
            "total_count": total_count,
            "summary": summary,
            "enabled_statuses": enabled_statuses
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
        
        if date_from or date_to:
            date_conds = []
            if date_from:
                date_conds.append("COALESCE(t.custom_date, DATE(t.creation)) >= %(date_from)s")
                todo_values["date_from"] = date_from
            if date_to:
                date_conds.append("COALESCE(t.custom_date, DATE(t.creation)) <= %(date_to)s")
                todo_values["date_to"] = date_to
                
            subquery_conds = []
            if date_from:
                subquery_conds.append("DATE(timestamp) >= %(date_from)s")
            if date_to:
                subquery_conds.append("DATE(timestamp) <= %(date_to)s")
                
            working_conds = ["t.status = 'Working'"]
            if date_from:
                working_conds.append("%(today)s >= %(date_from)s")
            if date_to:
                working_conds.append("%(today)s <= %(date_to)s")
            todo_values["today"] = frappe.utils.today()
            
            todo_conditions.append(f"""(
                ({" AND ".join(date_conds)})
                OR t.name IN (SELECT parent FROM `tabHD Ticket Check Log` WHERE {" AND ".join(subquery_conds)})
                OR ({" AND ".join(working_conds)})
            )""")
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
        
        filtered_performance = []
        if performance:
            # Fetch all users carrying the target roles in a single query
            technicians_with_roles = frappe.get_all(
                "Has Role",
                filters={"role": ["in", ["Agent", "TP Agent", "Chief Technician"]]},
                fields=["parent"],
                distinct=True
            )
            allowed_techs = {r.parent for r in technicians_with_roles}
            
            for p in performance:
                user = p.assigned_to
                if user in ["Administrator", "admin@example.com"]:
                    continue
                if user in allowed_techs:
                    filtered_performance.append(p)
                
        result = {
            "status_summary": status_summary,
            "priority_summary": priority_summary,
            "performance": filtered_performance
        }

    # 3. MOVEMENT VIEW
    elif view == "movement":
        movement_conditions = ["cl.latitude IS NOT NULL", "cl.longitude IS NOT NULL"]
        movement_values = {}
        
        if date_from:
            movement_conditions.append("DATE(cl.timestamp) >= %(date_from)s")
            movement_values["date_from"] = date_from
        if date_to:
            movement_conditions.append("DATE(cl.timestamp) <= %(date_to)s")
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
                cl.timestamp as creation, cl.parent as ticket, cl.location_address, t.subject, t.custom_customer_name as customer
            FROM `tabHD Ticket Check Log` cl
            LEFT JOIN `tabHD Ticket` t ON cl.parent = t.name
            WHERE {movement_where}
            ORDER BY cl.timestamp DESC
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
                cl.timestamp as creation, cl.parent as ticket, cl.location_address, t.subject, t.custom_customer_name as customer
            FROM `tabHD Ticket Check Log` cl
            LEFT JOIN `tabHD Ticket` t ON cl.parent = t.name
            WHERE {movement_where}
            ORDER BY cl.timestamp ASC
        """, movement_values, as_dict=True)
        
        result = {
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
                ec.name, ec.employee, ec.employee_name, ec.time, ec.log_type, ec.latitude, ec.longitude, ec.custom_accuracy, ec.device_id, e.user_id
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
        
        result = {
            "attendance": attendance,
            "total_count": attendance_total
        }

    return result


@frappe.whitelist()
def get_technician_map_data(date, technician=None, customer=None, ticket_status=None):
    if not (frappe.has_permission("HD Ticket", "read") and ("Chief Technician" in frappe.get_roles() or "System Manager" in frappe.get_roles())):
        frappe.throw("You are not permitted to access this dashboard.")
        
    # Sanitize inputs
    date_str = date if date not in (None, "", "None", "null", "undefined") else frappe.utils.today()
    technician = technician if technician not in (None, "", "None", "null", "undefined") else None
    customer = customer if customer not in (None, "", "None", "null", "undefined") else None
    
    # Normalize ticket_status (None vs empty string "")
    if ticket_status in (None, "None", "null", "undefined"):
        ticket_status = None

        
    result = {}

    # 1. Without technician: Latest check log for each technician on the date
    if not technician:
        conditions = ["DATE(cl.timestamp) = %(date)s", "cl.latitude IS NOT NULL", "cl.longitude IS NOT NULL"]
        values = {"date": date_str}
        
        if customer:
            conditions.append("t.custom_customer_name = %(customer)s")
            values["customer"] = customer
        if ticket_status:
            conditions.append("t.status = %(ticket_status)s")
            values["ticket_status"] = ticket_status
            
        where_clause = " AND ".join(conditions)
        
        # Single DB call to retrieve all logs on this date to avoid N+1 query loop
        query = f"""
            SELECT 
                cl.name, cl.technician as user, cl.latitude, cl.longitude, cl.timestamp as creation, 
                cl.parent as ticket, cl.location_address, t.status, t.custom_customer_name as customer
            FROM `tabHD Ticket Check Log` cl
            LEFT JOIN `tabHD Ticket` t ON cl.parent = t.name
            WHERE {where_clause}
            ORDER BY cl.timestamp DESC
        """
        all_logs = frappe.db.sql(query, values, as_dict=True)
        
        # Keep only the latest log per technician
        seen_users = set()
        results = []
        for log in all_logs:
            if log.user not in seen_users:
                seen_users.add(log.user)
                results.append(log)
                
        result = {
            "mode": "all_technicians",
            "markers": results
        }
        
    # 2. With technician: All completed tickets for technician
    else:
        conditions = ["DATE(cl.timestamp) = %(date)s", "cl.technician = %(technician)s"]
        values = {"date": date_str, "technician": technician}
        
        if customer:
            conditions.append("t.custom_customer_name = %(customer)s")
            values["customer"] = customer
        
        if ticket_status:
            conditions.append("t.status = %(ticket_status)s")
            values["ticket_status"] = ticket_status
        elif ticket_status == "":
            # "All Statuses" selected, do not filter by status
            pass
        else:
            # Defaults to 'Resolved' if None
            conditions.append("t.status = 'Resolved'")
            
        where_clause = " AND ".join(conditions)
        
        logs = frappe.db.sql(f"""
            SELECT 
                cl.name, cl.check_type, cl.latitude, cl.longitude, cl.timestamp, 
                cl.parent as ticket, cl.location_address, t.status, t.custom_customer_name as customer
            FROM `tabHD Ticket Check Log` cl
            LEFT JOIN `tabHD Ticket` t ON cl.parent = t.name
            WHERE {where_clause}
            ORDER BY cl.timestamp ASC
        """, values, as_dict=True)
        
        tickets_map = {}
        for log in logs:
            t_id = log.ticket
            if t_id not in tickets_map:
                tickets_map[t_id] = {
                    "ticket": t_id,
                    "customer": log.customer,
                    "status": log.status,
                    "check_in": None,
                    "check_out": None,
                    "latitude": None,
                    "longitude": None,
                    "address": None
                }
            
            if log.check_type == "Check-in" and not tickets_map[t_id]["check_in"]:
                tickets_map[t_id]["check_in"] = log.timestamp
                tickets_map[t_id]["latitude"] = log.latitude
                tickets_map[t_id]["longitude"] = log.longitude
                tickets_map[t_id]["address"] = log.location_address
            elif log.check_type == "Check-out":
                tickets_map[t_id]["check_out"] = log.timestamp
                if not tickets_map[t_id]["latitude"]:
                    tickets_map[t_id]["latitude"] = log.latitude
                    tickets_map[t_id]["longitude"] = log.longitude
                    tickets_map[t_id]["address"] = log.location_address
                    
        visits = []
        for t_id, data in tickets_map.items():
            duration = None
            if data["check_in"] and data["check_out"]:
                diff = data["check_out"] - data["check_in"]
                duration = diff.total_seconds()
            
            data["time_spent_seconds"] = duration
            visits.append(data)
            
        def get_sort_key(v):
            if v["check_in"]: return v["check_in"]
            if v["check_out"]: return v["check_out"]
            from datetime import datetime
            return datetime.max
            
        visits.sort(key=get_sort_key)
        
        valid_visits = [v for v in visits if v["latitude"] and v["longitude"]]
        
        total_tickets = len(valid_visits)
        first_check_in = valid_visits[0]["check_in"] if total_tickets > 0 else None
        last_check_out = valid_visits[-1]["check_out"] if total_tickets > 0 and valid_visits[-1]["check_out"] else None
        
        total_duration = sum([v["time_spent_seconds"] for v in valid_visits if v["time_spent_seconds"] is not None])
        avg_time = (total_duration / total_tickets) if total_tickets > 0 else 0
        
        summary = {
            "technician": technician,
            "date": date_str,
            "total_tickets": total_tickets,
            "first_check_in": first_check_in,
            "last_check_out": last_check_out,
            "total_duration_seconds": total_duration,
            "avg_time_seconds": avg_time
        }
        
        result = {
            "mode": "technician_route",
            "visits": valid_visits,
            "summary": summary
        }

    return result
