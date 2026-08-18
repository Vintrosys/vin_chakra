import frappe

def inject_helpdesk_scripts(request=None, response=None):
	"""Inject custom vin_chakra scripts into Helpdesk SPA HTML pages."""
	if not request or not response:
		return

	try:
		path = getattr(request, "path", "") or ""
		if path.startswith("/helpdesk"):
			mimetype = getattr(response, "mimetype", "") or ""
			if "text/html" in mimetype:
				html = response.get_data(as_text=True)
				scripts = """
<script src="/assets/vin_chakra/js/portal_back_btn.js"></script>
<script src="/assets/vin_chakra/js/ticket_info_modal.js"></script>
</body>"""
				if "</body>" in html and "/assets/vin_chakra/js/ticket_info_modal.js" not in html:
					html = html.replace("</body>", scripts, 1)
					response.set_data(html)
	except Exception as e:
		frappe.log_error(f"Error injecting helpdesk scripts: {str(e)}", "Helpdesk Script Injection")


def resolve_website_path(path):
	"""Redirect System Users to desk instead of helpdesk default portal page."""
	if not path or path == "index":
		if frappe.session.user != "Guest" and frappe.db.get_value("User", frappe.session.user, "user_type") == "System User":
			return "desk"

	from frappe.website.path_resolver import resolve_path
	return resolve_path(path)
