import frappe
import requests
import json

def send_sms(mobile_number, message, dlt_template_id=None, ticket=None):
    """
    Send an SMS using api.co3.live configuration stored in CO3 SMS Settings.
    If disabled or not configured, it logs to the Frappe Error Log and returns False.
    All attempts (success/failure) are logged in the 'CO3 SMS Log' DocType.
    """
    # Fetch settings
    try:
        settings = frappe.get_single("CO3 SMS Settings")
    except frappe.DoesNotExistError:
        frappe.log_error("CO3 SMS Settings not found. Please create the setting first.", "SMS Integration Error")
        return False

    if not settings.enabled:
        frappe.log_error(f"CO3 SMS integration is disabled. Message to {mobile_number}: {message}", "SMS Disabled Log")
        return False

    api_url = settings.api_url or "https://api.co3.live/api/smsapi"
    api_key = settings.get_password("api_key")
    sender_id = settings.sender_id
    route = settings.route or "2"
    pe_id = settings.pe_id or ""

    if not api_key or not sender_id:
        frappe.log_error("API Key or Sender ID missing in CO3 SMS Settings.", "SMS Integration Error")
        return False

    # Standardize mobile number format (Indian mobile number is 10 digits, or prefixed with +91 or 91)
    # Strip any dashes, spaces, +
    clean_mobile = "".join(filter(str.isdigit, mobile_number))
    # Standard Indian mobile numbers are 10 digits; gateway expects 91 prefix for India
    if len(clean_mobile) == 10:
        clean_mobile = "91" + clean_mobile
    elif len(clean_mobile) == 12 and clean_mobile.startswith("91"):
        pass

    # Build parameters according to api.co3.live documentation:
    # key, sender, number, route, templateid, peid, sms
    payload = {
        "key": api_key,
        "sender": sender_id,
        "number": clean_mobile,
        "route": route,
        "sms": message
    }
    if dlt_template_id:
        payload["templateid"] = dlt_template_id
    if pe_id:
        payload["peid"] = pe_id

    log_doc = frappe.new_doc("CO3 SMS Log")
    log_doc.ticket = ticket
    log_doc.to_mobile = clean_mobile
    log_doc.message = message
    log_doc.dlt_template_id = dlt_template_id
    log_doc.route = route
    log_doc.sender_id = sender_id

    try:
        # Send HTTP GET request with query parameters (requests auto-urlencodes params)
        response = requests.get(api_url, params=payload, timeout=15)
        response_text = response.text.strip() if response.text else ""
        
        # Log response for debugging
        frappe.log_error(
            f"SMS API Request URL: {response.url}\nResponse Status: {response.status_code}\nResponse Body: {response_text}",
            "CO3 SMS Gateway Log"
        )
        
        log_doc.response_body = response_text
        
        # Check for error codes (101 to 111)
        error_codes = {"101", "102", "103", "104", "105", "106", "107", "108", "109", "110", "111"}
        if response.status_code == 200 and response_text not in error_codes and response_text.isdigit():
            log_doc.status = "Sent"
            log_doc.message_id = response_text
            success = True
        else:
            log_doc.status = "Failed"
            success = False
            
        log_doc.insert(ignore_permissions=True)
        frappe.db.commit()
        return success
    except Exception as e:
        frappe.log_error(f"Failed to send SMS to {clean_mobile}. Error: {str(e)}", "CO3 SMS Gateway Error")
        log_doc.status = "Failed"
        log_doc.response_body = str(e)
        log_doc.insert(ignore_permissions=True)
        frappe.db.commit()
        return False
