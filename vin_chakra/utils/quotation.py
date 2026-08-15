import frappe

@frappe.whitelist()
def get_item_and_previous_quotations(item_code, customer=None, current_quotation=None):
    out = {
        "previous_quotations": [],
        "minimum_bargaining_rate": 0
    }
    
    if not item_code:
        return out
        
    # Get minimum bargaining rate (check column exists first - requires bench migrate after field creation)
    if frappe.db.has_column("Item", "custom_minimum_bargaining_rate"):
        min_rate = frappe.db.get_value("Item", item_code, "custom_minimum_bargaining_rate")
        out["minimum_bargaining_rate"] = min_rate or 0
    
    if not customer:
        return out
        
    # Get previous quotations for this customer and item
    where_clause = "q.party_name = %s AND qi.item_code = %s AND q.status = 'Open'"
    values = [customer, item_code]
    
    if current_quotation and not current_quotation.startswith("new-"):
        # Fetch the creation date of the current quotation
        current_creation = frappe.db.get_value("Quotation", current_quotation, "creation")
        if current_creation:
            where_clause += " AND q.creation < %s"
            values.append(current_creation)
        else:
            where_clause += " AND q.name != %s"
            values.append(current_quotation)

    query = f"""
        SELECT 
            q.transaction_date as date,
            q.name as quotation_id,
            q.customer_name,
            qi.qty,
            qi.rate,
            q.status,
            q.docstatus
        FROM `tabQuotation Item` qi
        JOIN `tabQuotation` q ON q.name = qi.parent
        WHERE 
            {where_clause}
        ORDER BY q.transaction_date DESC, q.creation DESC
        LIMIT 5
    """
    
    past_quotes = frappe.db.sql(query, tuple(values), as_dict=True)
    out["previous_quotations"] = past_quotes
    
    return out

def validate_quotation(doc, method=None):
    if not doc.custom_sales_person and frappe.session.user:
        doc.custom_sales_person = frappe.session.user

    warnings = []
    
    for item in doc.get("items"):
        if not item.item_code or not item.rate:
            continue
            
        # Try getting the minimum rate directly from the Quotation Item row first
        min_rate = item.get("custom_minimum_bargaining_rate")
        
        # If it's not there, try fetching it from the Item master
        if not min_rate and frappe.db.has_column("Item", "custom_minimum_bargaining_rate"):
            min_rate = frappe.db.get_value("Item", item.item_code, "custom_minimum_bargaining_rate")
        
        # Ensure min_rate is not None and greater than 0 before checking
        if min_rate and float(min_rate) > 0 and float(item.rate) < float(min_rate):
            warnings.append(
                f"Item <b>{item.item_code}</b> rate ({item.rate}) is below the minimum allowed rate ({min_rate})."
            )
            
    if warnings:
        frappe.throw(
            "Some items are quoted below their Minimum Bargaining Rate. You cannot save this Quotation.<br><br>" + "<br>".join(warnings),
            title="Minimum Rate Validation Failed"
        )
