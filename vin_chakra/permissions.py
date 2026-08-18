import frappe


def quotation_query(user):
    if user == "Administrator":
        return ""

    return f"`tabQuotation`.`owner` = {frappe.db.escape(user)}"