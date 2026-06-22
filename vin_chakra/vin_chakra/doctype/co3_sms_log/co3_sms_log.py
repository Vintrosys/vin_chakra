import frappe
from frappe.model.document import Document
import random

class CO3SMSLog(Document):
    pass

@frappe.whitelist()
def resend_sms(name: str):
    log = frappe.get_doc("CO3 SMS Log", name)
    
    if log.ticket:
        ticket = frappe.get_doc("HD Ticket", log.ticket)
        otp = str(random.randint(1000, 9999))
        ticket.custom_service_otp = otp
        ticket.flags.from_technician_api = True
        ticket.save(ignore_permissions=True)
        
        settings = frappe.get_single("CO3 SMS Settings")
        raw_template = settings.ticket_creation_template or \
            "Dear Customer, OTP for your service request: {otp}. Share it with the technician after service completion. - Sree Chakra"
        
        if "{#var#}" in raw_template:
            message = raw_template.replace("{#var#}", otp, 1)
            if "{#var#}" in message:
                message = message.replace("{#var#}", "24 hours", 1)
        else:
            message = raw_template.replace("{otp}", otp).replace("{ticket_id}", ticket.name)
            
        log.message = message
        log.save(ignore_permissions=True)
        dlt_id = settings.ticket_creation_dlt_id
    else:
        message = log.message
        dlt_id = log.dlt_template_id

    from vin_chakra.vin_chakra.co3_sms import send_sms
    success = send_sms(log.to_mobile, message, dlt_id, log.ticket)
    
    if success:
        return {"status": "success"}
    else:
        return {"status": "error"}
