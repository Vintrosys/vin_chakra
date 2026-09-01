app_name = "vin_chakra"
app_title = "vin_chakra"
app_publisher = "harrishragavan"
app_description = "Application for the chakra"
app_email = "harrishragavan1552005@gmail.com"
app_license = "mit"

# Apps
# ------------------


# 		"name": "vin_chakra",
# 		"logo": "/assets/vin_chakra/logo.png",
# 		"title": "vin_chakra",
# 		"route": "/vin_chakra",
# 		"has_permission": "vin_chakra.api.permission.has_app_permission"

# ------------------

# app_include_css = "/assets/vin_chakra/css/vin_chakra.css"
# app_include_js = "/assets/vin_chakra/js/vin_chakra.js"

# web_include_css = "/assets/vin_chakra/css/vin_chakra.css"
web_include_js = [
	"/assets/vin_chakra/js/portal_back_btn.js",
	"/assets/vin_chakra/js/ticket_info_modal.js"
]

# website_theme_scss = "vin_chakra/public/scss/website"




# ------------------
# app_include_icons = "vin_chakra/public/icons.svg"

# ----------



# ----------



# ----------

# 	"methods": "vin_chakra.utils.jinja_methods",
# 	"filters": "vin_chakra.utils.jinja_filters"

# ------------

after_install = "vin_chakra.vin_chakra.setup.run_setup"
after_migrate = "vin_chakra.vin_chakra.setup.run_setup"

# ------------

# before_uninstall = "vin_chakra.uninstall.before_uninstall"
# after_uninstall = "vin_chakra.uninstall.after_uninstall"

# ------------------

# before_app_install = "vin_chakra.utils.before_app_install"
# after_app_install = "vin_chakra.utils.after_app_install"

# -------------------

# before_app_uninstall = "vin_chakra.utils.before_app_uninstall"
# after_app_uninstall = "vin_chakra.utils.after_app_uninstall"

# ------------------
# See frappe.core.notifications.get_notification_config

# notification_config = "vin_chakra.notifications.get_notification_config"

# -----------

# 	"Event": "frappe.desk.doctype.event.event.get_permission_query_conditions",
# 	"Event": "frappe.desk.doctype.event.event.has_permission",

# ---------------

doc_events = {
	"HD Ticket": {
		"before_validate": "vin_chakra.vin_chakra.custom.hd_ticket.fix_phone_numbers",
		"after_insert": [
			"vin_chakra.vin_chakra.custom.hd_ticket.assign_to_chief_technician",
			"vin_chakra.vin_chakra.custom.hd_ticket.clear_dashboard_caches"
		],
		"validate": "vin_chakra.vin_chakra.custom.hd_ticket.validate_ticket",
		"on_update": "vin_chakra.vin_chakra.custom.hd_ticket.clear_dashboard_caches",
		"on_trash": "vin_chakra.vin_chakra.custom.hd_ticket.clear_dashboard_caches"
	},
	"Employee Checkin": {
		"before_validate": "vin_chakra.vin_chakra.custom.employee_checkin.validate_employee_checkin",
		"after_insert": "vin_chakra.vin_chakra.custom.hd_ticket.clear_dashboard_caches",
		"on_update": "vin_chakra.vin_chakra.custom.hd_ticket.clear_dashboard_caches",
		"on_trash": "vin_chakra.vin_chakra.custom.hd_ticket.clear_dashboard_caches"
	},
	"ToDo": {
		"before_insert": "vin_chakra.vin_chakra.custom.hd_ticket.validate_todo_assignment",
		"before_save": "vin_chakra.vin_chakra.custom.hd_ticket.validate_todo_assignment",
		"before_delete": "vin_chakra.vin_chakra.custom.hd_ticket.validate_todo_assignment"
	},
	"Quotation": {
		"validate": "vin_chakra.utils.quotation.validate_quotation"
	},
	"Support Form Template": {
		"on_update": "vin_chakra.vin_chakra.doctype.support_form_template.support_form_template.sync_web_form"
	}
}

# Override helpdesk's default HD Ticket permission query.
# Regular agents (technicians) only see tickets assigned to them.
# Administrator and Agent Managers see all tickets.
permission_query_conditions = {
	"HD Ticket": "vin_chakra.vin_chakra.custom.hd_ticket.get_assignee_restricted_ticket_query",
	"Quotation": "vin_chakra.permissions.quotation_query"
}

# ---------------

# 		"vin_chakra.tasks.all"
# 		"vin_chakra.tasks.daily"
# 		"vin_chakra.tasks.hourly"
# 		"vin_chakra.tasks.weekly"
# 		"vin_chakra.tasks.monthly"

# -------

# before_tests = "vin_chakra.install.before_tests"

# ------------------------------
# 	"Task": "vin_chakra.custom.task.CustomTaskMixin"

# ------------------------------
# 	"frappe.desk.doctype.event.event.get_events": "vin_chakra.event.get_events"
# 	"Task": "vin_chakra.task.get_dashboard_data"


# -----------------------------------------------------------


# ----------------
# before_request = ["vin_chakra.utils.before_request"]
after_request = ["vin_chakra.vin_chakra.custom_helpdesk.inject_helpdesk_scripts"]
website_path_resolver = ["vin_chakra.vin_chakra.custom_helpdesk.resolve_website_path"]

# ----------
# before_job = ["vin_chakra.utils.before_job"]
# after_job = ["vin_chakra.utils.after_job"]

# --------------------


# --------------------------------

# 	"vin_chakra.auth.validate"

export_python_type_annotations = True

require_type_annotated_api_methods = True

doctype_js = {
    "Quotation" : "public/js/quotation.js"
}

fixtures = [
    {
        "dt": "Workspace",
        "filters": [
            ["name", "in", ["Cheif Technician Dashboard", "Technician Dashboard"]]
        ]
    },
    {
        "dt": "Workspace Sidebar",
        "filters": [
            ["name", "in", ["Technician Dashboard", "Cheif Technician Dashboard"]]
        ]
    },
    {
        "dt": "Desktop Icon",
        "filters": [
            ["name", "=", "Technician Dashboard"]
        ]
    },
    {
        "dt": "Module Def",
        "filters": [
            ["name", "=", "vin_chakra"]
        ]
    },
    {
        "dt": "HD Ticket Status",
        "filters": [
            ["name", "=", "Self-Completed"]
        ]
    },
    {
        "dt": "Custom Field",
        "filters": [
            ["dt", "in", ["Employee Checkin", "Support Form Template", "Machine type list"]]
        ]
    },
    {
        "dt": "Property Setter",
        "filters": [
            ["doc_type", "in", ["HD Ticket", "Employee Checkin", "Quotation", "Item", "Sales Invoice", "Support Form Template", "Machine type list"]]
        ]
    }
]