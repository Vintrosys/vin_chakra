import hashlib
import os
from functools import lru_cache

import frappe

# Scripts injected before </body> of the SPA pages Frappe does not render itself. The last
# script of each page also marks a page that already carries the injection.
INJECTED_SCRIPTS = {
	"/helpdesk": ("portal_back_btn.js", "ticket_info_modal.js"),
	"/hrms": ("hrms_checkin_location.js",),
}


@lru_cache(maxsize=64)
def _content_hash(file_path: str, mtime_ns: int, size: int) -> str:
	# mtime and size are part of the cache key, so an edited file is hashed again
	with open(file_path, "rb") as f:
		return hashlib.sha256(f.read()).hexdigest()[:10]


def versioned_script_tag(filename: str) -> str:
	"""A <script> tag for public/js/<filename> whose URL changes whenever the file does.

	Frappe Cloud serves /assets with `Cache-Control: max-age=31536000, immutable`, and Frappe
	does not version the tags injected here. Without a version in the URL, a browser that has
	loaded the script once keeps that copy for a year: a deployed change (the Ticket Info
	popup's Assignee field, for one) never reaches it, not even on a normal reload.
	"""
	url = f"/assets/vin_chakra/js/{filename}"
	try:
		file_path = os.path.join(frappe.local.sites_path, "assets", "vin_chakra", "js", filename)
		stat = os.stat(file_path)
		url += f"?v={_content_hash(file_path, stat.st_mtime_ns, stat.st_size)}"
	except OSError:
		pass  # serve the plain URL rather than break the page
	return f'<script src="{url}"></script>'


def inject_helpdesk_scripts(request=None, response=None):
	"""Inject custom vin_chakra scripts into Helpdesk and HRMS SPA HTML pages."""
	if not request or not response:
		return

	try:
		path = getattr(request, "path", "") or ""
		mimetype = getattr(response, "mimetype", "") or ""
		if "text/html" not in mimetype:
			return

		scripts = next((names for prefix, names in INJECTED_SCRIPTS.items() if path.startswith(prefix)), None)
		if not scripts:
			return

		html = response.get_data(as_text=True)
		if "</body>" in html and f"/assets/vin_chakra/js/{scripts[-1]}" not in html:
			tags = "\n" + "\n".join(versioned_script_tag(name) for name in scripts) + "\n</body>"
			response.set_data(html.replace("</body>", tags, 1))
	except Exception as e:
		frappe.log_error(f"Error injecting vin_chakra scripts: {e!s}", "Vin Chakra Script Injection")


def resolve_website_path(path):
	"""Redirect System Users to desk instead of helpdesk default portal page."""
	if not path or path == "index":
		if frappe.session.user != "Guest" and frappe.db.get_value("User", frappe.session.user, "user_type") == "System User":
			return "desk"

	from frappe.website.path_resolver import resolve_path
	return resolve_path(path)
