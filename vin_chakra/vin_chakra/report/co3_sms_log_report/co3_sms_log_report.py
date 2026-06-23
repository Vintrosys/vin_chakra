import frappe

def execute(filters=None):
	columns = get_columns()
	data = get_data(filters)
	return columns, data

def get_columns():
	return [
		{
			"label": "Log ID",
			"fieldname": "name",
			"fieldtype": "Link",
			"options": "CO3 SMS Log",
			"width": 100
		},
		{
			"label": "Reference Ticket",
			"fieldname": "ticket",
			"fieldtype": "Link",
			"options": "HD Ticket",
			"width": 120
		},
		{
			"label": "Recipient Mobile",
			"fieldname": "to_mobile",
			"fieldtype": "Phone",
			"width": 140
		},
		{
			"label": "Message",
			"fieldname": "message",
			"fieldtype": "Small Text",
			"width": 300
		},
		{
			"label": "DLT Template ID",
			"fieldname": "dlt_template_id",
			"fieldtype": "Data",
			"width": 160
		},
		{
			"label": "Route",
			"fieldname": "route",
			"fieldtype": "Data",
			"width": 80
		},
		{
			"label": "Sender ID",
			"fieldname": "sender_id",
			"fieldtype": "Data",
			"width": 100
		},
		{
			"label": "Status",
			"fieldname": "status",
			"fieldtype": "Select",
			"width": 100
		},
		{
			"label": "Message ID",
			"fieldname": "message_id",
			"fieldtype": "Data",
			"width": 120
		},
		{
			"label": "Gateway Response",
			"fieldname": "response_body",
			"fieldtype": "Small Text",
			"width": 150
		},
		{
			"label": "Date Created",
			"fieldname": "creation",
			"fieldtype": "Datetime",
			"width": 150
		}
	]

def get_data(filters):
	conditions = {}
	if filters:
		if filters.get("status"):
			conditions["status"] = filters.get("status")
		if filters.get("ticket"):
			conditions["ticket"] = filters.get("ticket")
		if filters.get("to_mobile"):
			conditions["to_mobile"] = ["like", f"%{filters.get('to_mobile')}%"]

	return frappe.get_all(
		"CO3 SMS Log",
		fields=["name", "ticket", "to_mobile", "message", "dlt_template_id", "route", "sender_id", "status", "message_id", "response_body", "creation"],
		filters=conditions,
		order_by="creation desc"
	)
