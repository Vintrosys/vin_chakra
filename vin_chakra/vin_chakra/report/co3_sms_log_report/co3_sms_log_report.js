frappe.query_reports["CO3 SMS Log Report"] = {
	"filters": [
		{
			"fieldname": "status",
			"label": __("Status"),
			"fieldtype": "Select",
			"options": "\nSent\nFailed"
		},
		{
			"fieldname": "ticket",
			"label": __("Reference Ticket"),
			"fieldtype": "Link",
			"options": "HD Ticket"
		},
		{
			"fieldname": "to_mobile",
			"label": __("Recipient Mobile"),
			"fieldtype": "Data"
		}
	]
};
