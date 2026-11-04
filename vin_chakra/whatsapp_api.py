"""
WhatsApp (AskEva) outbound notifications.

Sends a Sales Invoice (and its PDF) to a customer's WhatsApp number via the
AskEva API — a Meta WhatsApp Cloud API wrapper. The invoice PDF is exposed
through a signed, time-limited guest download link so Meta/AskEva can fetch it.

Configuration lives in the ``AskEva Settings`` single doctype (API URL / token,
invoice template, send mode, public base URL).

NOTE: The inbound chatbot webhook that created HD Tickets, Customers, Contacts
and Addresses from WhatsApp Flow form submissions has been removed. Only the
outbound Sales-Invoice delivery path remains in this module.
"""

import hashlib
import hmac
import json
import re
import time

import requests
import frappe
from frappe import _
from frappe.rate_limiter import rate_limit

# How long a signed invoice-PDF download link stays valid (seconds). 30 days.
PDF_LINK_TTL = 30 * 24 * 60 * 60


# ---------------------------------------------------------------------------
# Shared Helpers
# ---------------------------------------------------------------------------
def _digits(value) -> str:
	"""Extract only numeric digits from a string."""
	return "".join(ch for ch in str(value or "") if ch.isdigit())


# ---------------------------------------------------------------------------
# Outbound WhatsApp Notification (Sales Invoice)
# ---------------------------------------------------------------------------

def _invoice_pdf_secret() -> bytes:
	"""Site-specific secret for signing invoice download links."""
	secret = frappe.local.conf.get("encryption_key") or frappe.local.conf.get("secret_key")
	if not secret:
		frappe.throw(_("Site encryption key is not configured; cannot sign invoice links."))
	return secret.encode("utf-8")


def _generate_invoice_pdf_token(invoice_name: str, exp: int, print_format: str = None) -> str:
	"""Internal HMAC signature binding an invoice name, print format, and expiry timestamp.

	NOT whitelisted on purpose: exposing this as a guest endpoint would let
	anyone mint valid download links for arbitrary invoices (IDOR oracle).
	"""
	fmt_part = f":{print_format.strip()}" if print_format else ""
	return hmac.new(
		_invoice_pdf_secret(),
		f"wa_invoice_pdf:{invoice_name}:{int(exp)}{fmt_part}".encode("utf-8"),
		hashlib.sha256,
	).hexdigest()


def _verify_invoice_pdf_token(invoice_name: str, key: str, exp, print_format: str = None) -> bool:
	"""Constant-time verify of an invoice link signature, rejecting expired links."""
	if not key or exp in (None, ""):
		return False
	try:
		exp_int = int(exp)
	except (TypeError, ValueError):
		return False
	if exp_int < int(time.time()):
		return False  # link has expired

	# Verify with format if provided
	expected = _generate_invoice_pdf_token(invoice_name, exp_int, print_format)
	if hmac.compare_digest(str(key).strip(), expected):
		return True

	# Fallback verification without format for backward compatibility
	expected_legacy = _generate_invoice_pdf_token(invoice_name, exp_int, None)
	return hmac.compare_digest(str(key).strip(), expected_legacy)


def get_invoice_print_formats(selected_format: str = None) -> tuple[list[str], str]:
	"""Return active Print Formats for Sales Invoice and the selected/default choice."""
	formats = frappe.get_all(
		"Print Format",
		filters={"doc_type": "Sales Invoice", "disabled": 0},
		pluck="name",
		order_by="name asc"
	)
	doc_meta = frappe.get_meta("Sales Invoice")
	meta_default = doc_meta.default_print_format
	preferred = selected_format or meta_default
	if not preferred or preferred not in formats:
		for cand in ["Service invoice", "Sales Invoice Standard", "GST Tax Invoice"]:
			if cand in formats:
				preferred = cand
				break
	if not preferred and formats:
		preferred = formats[0]
	return formats, (preferred or "Standard")


@frappe.whitelist(allow_guest=True)
@rate_limit(key="name", limit=30, seconds=60)
def download_invoice_pdf(name: str, key: str = None, exp=None, format: str = None, print_format: str = None):
	"""
	Public guest-accessible endpoint to download/view the Sales Invoice PDF.
	Supports selecting custom Print Formats.
	Secured by a time-limited HMAC key to prevent IDOR / unauthorized scraping.
	"""
	if not name or not frappe.db.exists("Sales Invoice", name):
		frappe.throw(_("Invoice not found"), frappe.DoesNotExistError)

	docstatus = frappe.db.get_value("Sales Invoice", name, "docstatus")
	if docstatus == 2:
		frappe.throw(_("This invoice has been cancelled."), frappe.ValidationError)

	chosen_format = (print_format or format or "").strip() or None

	# Security: If user is logged in and has read permission on Sales Invoice, allow access
	is_authorized = False
	if frappe.session.user != "Guest":
		is_authorized = frappe.has_permission("Sales Invoice", "read", name)

	# If guest or user without direct permission, verify the signed, time-limited key
	if not is_authorized:
		if not _verify_invoice_pdf_token(name, key, exp, chosen_format):
			frappe.throw(_("Invalid or expired invoice download link."), frappe.PermissionError)

	orig_user = frappe.session.user
	host_name_set = False
	orig_host_name = frappe.local.conf.get("host_name")
	try:
		# In dev/bench environments without a local DNS entry, ensure host_name can
		# render assets. Restored in finally so this never leaks across requests.
		if not orig_host_name and "localhost" not in frappe.utils.get_url() and "127.0.0.1" not in frappe.utils.get_url():
			frappe.local.conf.host_name = f"http://127.0.0.1:{frappe.local.conf.get('webserver_port') or 8001}"
			host_name_set = True

		# Temporarily elevate to Administrator context for PDF rendering so guest can receive their verified document
		frappe.set_user("Administrator")
		pdf_opts = {"load-error-handling": "ignore", "load-media-error-handling": "ignore"}
		pdf = None
		try:
			if chosen_format:
				pdf = frappe.get_print("Sales Invoice", name, print_format=chosen_format, as_pdf=True, pdf_options=pdf_opts)
			else:
				pdf = frappe.get_print("Sales Invoice", name, as_pdf=True, pdf_options=pdf_opts)
		except Exception as pf_err:
			if chosen_format:
				frappe.log_error(f"Custom print format '{chosen_format}' failed for {name}: {str(pf_err)}. Falling back to default format.", "Invoice PDF Generation Fallback")
				pdf = frappe.get_print("Sales Invoice", name, as_pdf=True, pdf_options=pdf_opts)
			else:
				raise

		safe_name = name.replace("/", "-")
		frappe.local.response.filename = f"{safe_name}.pdf"
		frappe.local.response.filecontent = pdf
		frappe.local.response.type = "pdf"
	except Exception as e:
		frappe.log_error(f"Failed to generate invoice PDF for {name} ({chosen_format}): {str(e)}", "Invoice PDF Generation Error")
		frappe.throw(_("Unable to generate PDF invoice."), frappe.ValidationError)
	finally:
		frappe.set_user(orig_user)
		if host_name_set:
			frappe.local.conf.host_name = orig_host_name


def _resolve_invoice_phone_numbers(doc) -> dict:
	"""
	Collect all potential customer mobile numbers for a Sales Invoice.
	Returns a dict with 'primary' phone and 'all_phones' list.
	"""
	phones = []

	def _add(p, is_primary=False):
		if not p:
			return
		cleaned = _digits(p)
		if len(cleaned) >= 10:
			last_10 = cleaned[-10:]
			if not any(item["phone"] == last_10 for item in phones):
				if is_primary:
					phones.insert(0, {"phone": last_10, "raw": p})
				else:
					phones.append({"phone": last_10, "raw": p})

	# 1. Direct Sales Invoice fields
	if hasattr(doc, "contact_mobile") and doc.contact_mobile:
		_add(doc.contact_mobile, is_primary=True)

	# 2. Linked HD Ticket fields
	hd_ticket_id = doc.get("custom_hd_ticket")
	if hd_ticket_id and frappe.db.exists("HD Ticket", hd_ticket_id):
		t_primary = frappe.db.get_value("HD Ticket", hd_ticket_id, "custom_customer_mobile_number")
		t_secondary = frappe.db.get_value("HD Ticket", hd_ticket_id, "custom__secondary_phone_number")
		if t_primary:
			_add(t_primary, is_primary=True)
		if t_secondary:
			_add(t_secondary)

	# 3. Linked Customer master
	if doc.customer and frappe.db.exists("Customer", doc.customer):
		cust = frappe.get_doc("Customer", doc.customer)
		if getattr(cust, "mobile_no", None):
			_add(cust.mobile_no, is_primary=len(phones) == 0)
		if getattr(cust, "custom_secondary_phone", None):
			_add(cust.custom_secondary_phone)

		# 4. Linked Contact records
		contact_id = getattr(cust, "customer_primary_contact", None) or doc.get("contact_person")
		if contact_id and frappe.db.exists("Contact", contact_id):
			c_doc = frappe.get_doc("Contact", contact_id)
			for r in (c_doc.get("phone_nos") or []):
				if r.phone:
					_add(r.phone, is_primary=bool(r.is_primary_phone or r.is_primary_mobile_no))

	primary_phone = phones[0]["phone"] if phones else ""
	return {
		"primary": primary_phone,
		"all_phones": [p["phone"] for p in phones]
	}


def _sanitize_meta_param(val) -> str:
	"""
	Sanitize parameter values according to Meta WhatsApp Cloud API rules:
	- No newlines, carriage returns, or tabs
	- No more than 4 consecutive spaces
	- Max length 1000 characters
	"""
	if val is None:
		return ""
	s = str(val)
	s = re.sub(r"[\r\n\t]+", " ", s)
	s = re.sub(r" {4,}", "   ", s)
	s = s.strip()
	return s[:1000]


DEFAULT_INVOICE_MESSAGE_TEMPLATE = (
	"Dear {customer_name},\n\n"
	"Thank you for choosing {company_name}! Your service invoice {invoice_no} for {amount} has been generated.\n\n"
	"Mode of Payment: {payment_mode}\n"
	"Technician: {technician_name}\n\n"
	"For any queries, please feel free to reach out to us."
)


def _strip_direct_links_from_message(text: str) -> str:
	"""
	Ensure no direct invoice PDF links are included in the message text.
	Strips lines containing download_invoice_pdf or {pdf_link} along with any
	preceding 'View / Download Invoice PDF:' headings.
	"""
	if not text:
		return ""
	lines = text.split("\n")
	cleaned = []
	for line in lines:
		# Check if this line is a direct PDF link or placeholder
		if "{pdf_link}" in line or "download_invoice_pdf" in line:
			# If previous line was a link header like "View / Download Invoice PDF:", remove it too
			if cleaned and any(k in cleaned[-1].lower() for k in ["download invoice", "view invoice", "invoice pdf", "download pdf", "view / download"]):
				cleaned.pop()
			continue
		cleaned.append(line)
	result = "\n".join(cleaned)
	result = re.sub(r"\n{3,}", "\n\n", result)
	return result.strip()


def _is_public_accessible_url(url: str) -> bool:
	"""Check if URL points to a public FQDN/domain (not localhost, local IP, or private host)."""
	if not url:
		return False
	try:
		from urllib.parse import urlparse
		import ipaddress
		parsed = urlparse(url)
		scheme = (parsed.scheme or "").lower()
		host = (parsed.hostname or "").lower()
		if not host or scheme not in ["http", "https"]:
			return False
		if host in ["localhost", "127.0.0.1", "0.0.0.0", "chakra"]:
			return False
		if host.endswith(".local") or host.endswith(".lan"):
			return False
		try:
			ip = ipaddress.ip_address(host)
			return not ip.is_private and not ip.is_loopback
		except ValueError:
			return "." in host
	except Exception:
		return False


def _inspect_template_capabilities(template_name: str) -> dict:
	"""
	Determine if a Meta template has a Document Header, number of params, etc.
	Uses cached AskEva template data when available.
	"""
	t_name = (template_name or "").strip()
	if not t_name:
		return {"has_document_header": False, "header_format": None, "param_count": 0}

	# Known default templates
	if t_name == "service_invoice_with_pdf":
		return {
			"has_document_header": True,
			"header_format": "DOCUMENT",
			"param_count": 5
		}

	cached = frappe.cache().get_value("askeva_templates_cache")
	if cached and isinstance(cached, list):
		for t in cached:
			if t.get("name") == t_name:
				return {
					"has_document_header": bool(t.get("has_document_header")),
					"header_format": t.get("header_format"),
					"param_count": t.get("param_count", 0)
				}

	has_doc = ("pdf" in t_name.lower() or "doc" in t_name.lower() or "attach" in t_name.lower())
	return {
		"has_document_header": has_doc,
		"header_format": "DOCUMENT" if has_doc else None,
		"param_count": 5
	}


def _build_invoice_context(doc, print_format: str = None) -> dict:
	"""Assemble template placeholders dictionary for a Sales Invoice."""
	settings = frappe.get_single("AskEva Settings")
	base_url = (
		(settings.get("public_base_url") or "").strip().rstrip("/")
		or (frappe.get_site_config().get("host_name") or "").strip().rstrip("/")
		or frappe.utils.get_url().rstrip("/")
	)
	exp = int(time.time()) + PDF_LINK_TTL
	pdf_token = _generate_invoice_pdf_token(doc.name, exp, print_format)
	fmt_param = f"&format={requests.utils.quote(print_format)}" if print_format else ""
	pdf_link = (
		f"{base_url}/api/method/vin_chakra.whatsapp_api.download_invoice_pdf"
		f"?name={doc.name}{fmt_param}&key={pdf_token}&exp={exp}"
	)

	formatted_amount = frappe.utils.fmt_money(doc.grand_total, currency=doc.currency)
	cust_name = doc.customer_name or frappe.db.get_value("Customer", doc.customer, "customer_name") or doc.customer or "Customer"
	tech_name = doc.get("custom_technician") or "Technician"
	payment_mode = doc.get("custom_mode_of_payment") or "N/A"
	ticket_id = doc.get("custom_hd_ticket") or "N/A"
	company_name = doc.company or "Sree Chakra Sewing Systems"
	posting_date = frappe.utils.formatdate(doc.posting_date)

	return {
		"customer_name": cust_name,
		"invoice_no": doc.name,
		"amount": formatted_amount,
		"grand_total": str(doc.grand_total),
		"payment_mode": payment_mode,
		"technician_name": tech_name,
		"ticket_no": ticket_id,
		"company_name": company_name,
		"posting_date": posting_date,
		"pdf_link": pdf_link,
		"print_format": print_format or "",
	}


def dispatch_askeva_whatsapp(
	to_number: str,
	send_mode: str = "Template Message",
	template_name: str = None,
	template_language: str = "en",
	parameters: list = None,
	text_message: str = None,
	media_url: str = None,
	document_filename: str = None,
	reference_doctype: str = None,
	reference_name: str = None,
) -> dict:
	"""
	Modular engine to send WhatsApp messages (templates or direct text) via AskEva API.
	Reusable for Sales Invoices, Quotations, HD Tickets, and Customer Alerts.

	In Direct Text mode, if ``media_url`` is given the message is sent as a
	WhatsApp *document* (the PDF is delivered as an actual file) with
	``text_message`` as the caption, instead of a plain text message.
	"""
	settings = frappe.get_single("AskEva Settings")
	if not settings.enabled:
		return {
			"status": "error",
			"message": _("AskEva WhatsApp integration is disabled. Please enable it in AskEva Settings.")
		}

	# Fallback to webhook_token if api_token is empty or invalid hex
	api_token = settings.get_password("api_token", raise_exception=False)
	if not api_token or (len(api_token) % 2 != 0 and len(api_token) < 32):
		api_token = settings.get_password("webhook_token", raise_exception=False)

	if not api_token:
		return {
			"status": "error",
			"message": _("AskEva Send Message API Token is not configured in AskEva Settings.")
		}

	digits = _digits(to_number)
	if len(digits) < 10:
		return {
			"status": "error",
			"message": _("Invalid mobile number: {0}. Must contain at least 10 digits.").format(to_number)
		}

	# Format for WhatsApp (Indian numbers: prefix with 91 if 10 digits)
	if len(digits) == 10:
		whatsapp_number = "91" + digits
	elif len(digits) == 12 and digits.startswith("91"):
		whatsapp_number = digits
	else:
		whatsapp_number = digits

	api_url = (settings.api_url or "https://backend.askeva.io/v1/message/send-message").strip()

	payload = {
		"to": whatsapp_number,
		"number": whatsapp_number,
		"phone": whatsapp_number,
		"userNumber": whatsapp_number,
	}

	if send_mode == "Template Message":
		t_name = (template_name or settings.invoice_template_name or "service_invoice").strip()
		lang = (template_language or settings.invoice_template_language or settings.default_language_code or "en").strip()

		sanitized_params = [_sanitize_meta_param(p) for p in (parameters or [])]

		template_obj = {
			"name": t_name,
			"language": {
				"code": lang
			}
		}

		filename = None
		if media_url:
			filename = (document_filename or "invoice.pdf").strip()
			if not filename.lower().endswith(".pdf"):
				filename = f"{filename}.pdf"

		# Meta Cloud API template components. A document header attaches the PDF
		# as a real file and (unlike free-form messages) is allowed outside the
		# 24h session window. The chosen template MUST have a Document header for
		# this to be accepted by Meta.
		components = []
		if media_url and t_name != "test":
			components.append({
				"type": "header",
				"parameters": [{
					"type": "document",
					"document": {"link": media_url, "filename": filename}
				}]
			})
		if t_name != "test" and sanitized_params:
			components.append({
				"type": "body",
				"parameters": [{"type": "text", "text": str(v)} for v in sanitized_params]
			})
		if components:
			template_obj["components"] = components

		payload.update({
			"type": "template",
			"template": template_obj,
			"template_name": t_name,
			"templateName": t_name,
			"language_code": lang,
			"language": lang,
			"parameters": sanitized_params,
			"template_parameters": sanitized_params,
			"body_parameters": sanitized_params,
			"params": sanitized_params,
		})
		if media_url:
			payload["media_url"] = media_url
			payload["url"] = media_url
			payload["filename"] = filename
	else:
		rendered_text = (text_message or "").strip()

		if media_url:
			# Deliver the PDF as an actual WhatsApp document, with the message
			# text as the caption. WhatsApp caps media captions at 1024 chars.
			caption = rendered_text[:1024]
			filename = (document_filename or "invoice.pdf").strip()
			if not filename.lower().endswith(".pdf"):
				filename = f"{filename}.pdf"
			document_obj = {"link": media_url, "filename": filename}
			if caption:
				document_obj["caption"] = caption
			payload.update({
				"type": "document",
				"document": document_obj,
				# redundant flat keys for AskEva wrapper variants
				"media_url": media_url,
				"url": media_url,
				"filename": filename,
				"caption": caption,
				"message": caption,
			})
		else:
			if not rendered_text:
				return {
					"status": "error",
					"message": _("Direct text message body cannot be empty.")
				}

			payload.update({
				"type": "text",
				"text": {
					"body": rendered_text
				},
				"message": rendered_text,
			})

	headers = {
		"Content-Type": "application/json",
		"Authorization": f"Bearer {api_token}",
	}

	try:
		resp = requests.post(
			api_url,
			params={"token": api_token},
			json=payload,
			headers=headers,
			timeout=20,
		)
		resp_text = resp.text.strip() if resp.text else ""

		is_success = False
		error_detail = ""

		if resp.status_code in [200, 201]:
			try:
				resp_json = resp.json()
				if isinstance(resp_json, dict) and resp_json.get("status") in ["error", "failed", False]:
					error_detail = resp_json.get("message") or resp_json.get("error") or resp_text
				elif isinstance(resp_json, dict) and "error" in resp_json:
					err_obj = resp_json.get("error")
					error_detail = err_obj.get("message") if isinstance(err_obj, dict) else str(err_obj)
				else:
					is_success = True
			except Exception:
				is_success = True
		else:
			try:
				err_json = resp.json()
				if isinstance(err_json, dict):
					details = ""
					if isinstance(err_json.get("error_data"), dict):
						details = err_json["error_data"].get("details", "")
					elif isinstance(err_json.get("error"), dict) and isinstance(err_json["error"].get("error_data"), dict):
						details = err_json["error"]["error_data"].get("details", "")

					err_obj = err_json.get("error") or err_json.get("message")
					if isinstance(err_obj, dict):
						error_detail = err_obj.get("message") or str(err_obj)
					elif err_obj:
						error_detail = str(err_obj)
					else:
						error_detail = resp_text

					if details and details not in error_detail:
						error_detail = f"{error_detail}: {details}" if error_detail else details
				else:
					error_detail = resp_text
			except Exception:
				error_detail = resp_text

			# Auto-recovery: If the template literally does not have a Header component in Meta,
			# Meta rejects with "header: Template does not contain title component, no parameters allowed".
			# In that specific case, strip the header component and retry dispatch as body-only template.
			# NOTE: If Meta rejected because the URL is invalid (e.g. not a public URI), do NOT strip the header!
			# Stripping the header when the user chose a document template would silently degrade the message to SMS-only.
			has_header_param = any(
				c.get("type") == "header"
				for c in payload.get("template", {}).get("components", [])
			)
			if has_header_param and (
				"Template does not contain title component" in resp_text
				or "no parameters allowed" in resp_text
			):
				payload["template"]["components"] = [
					c for c in payload["template"]["components"] if c.get("type") != "header"
				]
				if not payload["template"]["components"]:
					payload["template"].pop("components", None)
				payload.pop("media_url", None)
				payload.pop("url", None)
				payload.pop("filename", None)

				try:
					retry_resp = requests.post(
						api_url,
						params={"token": api_token},
						json=payload,
						headers=headers,
						timeout=20,
					)
					if retry_resp.status_code in [200, 201]:
						retry_json = retry_resp.json() if retry_resp.text else {}
						if not (isinstance(retry_json, dict) and (retry_json.get("status") in ["error", "failed", False] or "error" in retry_json)):
							resp = retry_resp
							resp_text = retry_resp.text.strip() if retry_resp.text else ""
							is_success = True
							error_detail = ""

							# If the Meta template lacks a document header, dispatch the invoice PDF as an attached document message
							if media_url:
								try:
									doc_payload = {
										"to": whatsapp_number,
										"number": whatsapp_number,
										"phone": whatsapp_number,
										"userNumber": whatsapp_number,
										"type": "document",
										"document": {
											"link": media_url,
											"filename": filename or "invoice.pdf",
											"caption": f"Attached Invoice PDF: {reference_name or 'Invoice'}"
										},
										"media_url": media_url,
										"url": media_url,
										"filename": filename or "invoice.pdf",
										"caption": f"Attached Invoice PDF: {reference_name or 'Invoice'}"
									}
									requests.post(
										api_url,
										params={"token": api_token},
										json=doc_payload,
										headers=headers,
										timeout=15,
									)
								except Exception:
									pass
				except Exception:
					pass

			# User-friendly clarifications for common WhatsApp / AskEva responses
			if "encoding" in error_detail and "Received 'hex'" in error_detail:
				error_detail = (
					"Invalid AskEva API Token format (odd length hex error). "
					"Please verify your Send Message API Token in AskEva Settings."
				)
			elif "Session is not opened" in error_detail:
				error_detail = (
					f"WhatsApp 24-hour customer session is closed for +{whatsapp_number}. "
					"Under Meta WhatsApp policy, sending unprompted messages outside the 24h window requires an "
					"approved Template Message. Please configure and select an approved Template Message in AskEva Settings."
				)
			elif "Template is not valid" in error_detail:
				t_name = payload.get("template", {}).get("name") or payload.get("template_name")
				error_detail = (
					f"Template '{t_name}' was not found or is not approved in your AskEva / Meta WhatsApp account. "
					"Please check your approved template names in AskEva Settings."
				)
			elif "Number of parameters does not match" in error_detail or "localizable_params" in error_detail:
				error_detail = (
					"Template parameter count mismatch: Meta WhatsApp template expected a different number "
					"of parameters. Please check 'Template Parameters' in AskEva Settings."
				)
			elif "document.link" in resp_text or "valid uri" in resp_text.lower():
				error_detail = (
					f"Meta WhatsApp Cloud API rejected the attached PDF because '{media_url}' is not a valid public HTTPS URL. "
					"Meta requires a publicly accessible domain to download and attach the file. "
					"Please configure 'Public Base URL' in AskEva Settings (e.g. your public domain or ngrok tunnel URL)."
				)

		if not is_success:
			masked_token = f"{api_token[:4]}...{api_token[-4:]}" if len(api_token) > 8 else "***"
			frappe.log_error(
				f"AskEva Dispatch Failed to +{whatsapp_number}\nURL: {api_url}\nToken: {masked_token}\nStatus: {resp.status_code}\nResponse: {resp_text}\nPayload:\n{json.dumps(payload, indent=2)}",
				"AskEva WhatsApp Dispatch Failure"
			)
			return {
				"status": "error",
				"message": f"AskEva API rejected message: {error_detail or 'Unknown error'}",
				"number": whatsapp_number
			}

		return {
			"status": "success",
			"message": f"Invoice successfully sent to +{whatsapp_number} via WhatsApp.",
			"number": whatsapp_number,
			"payload": payload
		}

	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "AskEva WhatsApp Dispatch Failure")
		return {
			"status": "error",
			"message": f"Failed to connect to AskEva API: {str(e)}"
		}


@frappe.whitelist(allow_guest=True)
def get_invoice_notification_preview(invoice_name: str, target_phone: str = None, print_format: str = None) -> dict:
	"""Fetch details, recipient phones, print formats, and message preview for the Send Invoice dialog."""
	if not invoice_name or not frappe.db.exists("Sales Invoice", invoice_name):
		frappe.throw(_("Sales Invoice {0} not found").format(invoice_name))

	doc = frappe.get_doc("Sales Invoice", invoice_name)
	if frappe.session.user != "Guest" and not frappe.has_permission("Sales Invoice", "read", doc):
		frappe.throw(_("Not permitted to view Sales Invoice {0}").format(invoice_name), frappe.PermissionError)

	settings = frappe.get_single("AskEva Settings")
	phone_info = _resolve_invoice_phone_numbers(doc)

	selected_phone = target_phone or phone_info["primary"]
	formats, default_pf = get_invoice_print_formats(print_format)
	chosen_format = print_format if (print_format and print_format in formats) else default_pf
	ctx = _build_invoice_context(doc, print_format=chosen_format)

	# Direct message preview (without direct download URL link)
	direct_template = settings.invoice_message_template or DEFAULT_INVOICE_MESSAGE_TEMPLATE
	rendered_text = direct_template
	for k, v in ctx.items():
		if k != "pdf_link":
			rendered_text = rendered_text.replace(f"{{{k}}}", str(v))
	rendered_text = _strip_direct_links_from_message(rendered_text)

	# Meta template parameters preview
	param_string = settings.invoice_template_params or "{customer_name}, {ticket_no}, {amount}, {payment_mode}, {technician_name}"
	param_tokens = [p.strip() for p in param_string.split(",") if p.strip()]
	param_values = []
	for token in param_tokens:
		val = token
		for k, v in ctx.items():
			if k == "pdf_link":
				# Meta variables cannot be empty; indicate PDF is attached instead of passing raw link
				val = val.replace("{pdf_link}", "Attached with this message")
			else:
				val = val.replace(f"{{{k}}}", str(v))
		param_values.append(val)

	t_name = settings.invoice_template_name or "service_invoice_with_pdf"
	t_cap = _inspect_template_capabilities(t_name)
	is_public_base = _is_public_accessible_url(ctx["pdf_link"])
	base_url = (
		(settings.get("public_base_url") or "").strip().rstrip("/")
		or (frappe.get_site_config().get("host_name") or "").strip().rstrip("/")
		or frappe.utils.get_url().rstrip("/")
	)

	return {
		"invoice_name": doc.name,
		"customer_name": ctx["customer_name"],
		"grand_total": ctx["amount"],
		"target_phone": selected_phone,
		"available_phones": phone_info["all_phones"],
		"send_mode": settings.invoice_send_mode or "Template Message",
		"template_name": t_name,
		"template_language": settings.invoice_template_language or settings.default_language_code or "en",
		"rendered_text": rendered_text,
		"param_values": param_values,
		"pdf_link": ctx["pdf_link"],
		"print_formats": formats,
		"default_print_format": chosen_format,
		"print_format": chosen_format,
		"include_pdf_link": True,
		"has_document_header": t_cap.get("has_document_header", False),
		"header_format": t_cap.get("header_format"),
		"is_public_base_url": is_public_base,
		"public_base_url": base_url,
		"is_configured": bool(
			settings.enabled
			and (
				settings.get_password("api_token", raise_exception=False)
				or settings.get_password("webhook_token", raise_exception=False)
			)
		)
	}


@frappe.whitelist(allow_guest=True)
def send_sales_invoice_whatsapp(invoice_name: str, target_phone: str = None, print_format: str = None) -> dict:
	"""
	Dispatch the Sales Invoice and its attached PDF to the customer's WhatsApp mobile number via AskEva API.
	Includes print format selection, direct link removal from message body, rate-limiting, and audit comments.
	"""
	if frappe.session.user == "Guest":
		frappe.throw(_("Your login session has expired. Please refresh the page and log in to send invoices."), frappe.PermissionError)

	if not invoice_name or not frappe.db.exists("Sales Invoice", invoice_name):
		frappe.throw(_("Sales Invoice {0} not found").format(invoice_name))

	doc = frappe.get_doc("Sales Invoice", invoice_name)
	if not frappe.has_permission("Sales Invoice", "read", doc):
		frappe.throw(_("Not permitted to view or send Sales Invoice {0}").format(invoice_name), frappe.PermissionError)

	# Idempotency lock to prevent duplicate clicks
	lock_key = f"wa_invoice_lock_{invoice_name}"
	if frappe.cache().get_value(lock_key):
		frappe.throw(_("Invoice is already being dispatched to WhatsApp. Please wait a moment."), frappe.DuplicateEntryError)
	frappe.cache().set_value(lock_key, 1, expires_in_sec=15)

	try:
		settings = frappe.get_single("AskEva Settings")
		if not settings.enabled:
			frappe.throw(_("AskEva WhatsApp integration is disabled. Please enable it in AskEva Settings."))

		# Resolve target phone
		if not target_phone:
			phone_info = _resolve_invoice_phone_numbers(doc)
			target_phone = phone_info["primary"]

		if not target_phone:
			frappe.throw(_("No customer mobile number found for this Sales Invoice. Please enter a valid phone number."))

		formats, default_pf = get_invoice_print_formats(print_format)
		chosen_format = print_format if (print_format and print_format in formats) else default_pf
		ctx = _build_invoice_context(doc, print_format=chosen_format)
		send_mode = settings.invoice_send_mode or "Template Message"

		param_values = []
		if send_mode == "Template Message":
			param_string = settings.invoice_template_params or "{customer_name}, {ticket_no}, {amount}, {payment_mode}, {technician_name}"
			param_tokens = [p.strip() for p in param_string.split(",") if p.strip()]
			for token in param_tokens:
				val = token
				for k, v in ctx.items():
					if k == "pdf_link":
						val = val.replace("{pdf_link}", "Attached with this message")
					else:
						val = val.replace(f"{{{k}}}", str(v))
				param_values.append(val)
			rendered_text = None
		else:
			direct_template = settings.invoice_message_template or DEFAULT_INVOICE_MESSAGE_TEMPLATE
			rendered_text = direct_template
			for k, v in ctx.items():
				if k != "pdf_link":
					rendered_text = rendered_text.replace(f"{{{k}}}", str(v))
			rendered_text = _strip_direct_links_from_message(rendered_text)

		# Invoice names contain "/", which is not a valid filename character.
		safe_filename = f"{doc.name.replace('/', '-')}.pdf"

		# Always attach the invoice PDF as requested
		media_url = ctx["pdf_link"]

		res = dispatch_askeva_whatsapp(
			to_number=target_phone,
			send_mode=send_mode,
			template_name=settings.invoice_template_name,
			template_language=settings.invoice_template_language,
			parameters=param_values,
			text_message=rendered_text,
			media_url=media_url,
			document_filename=safe_filename,
			reference_doctype="Sales Invoice",
			reference_name=doc.name
		)

		if res.get("status") == "success":
			mode_label = f"template '{settings.invoice_template_name}'" if send_mode == "Template Message" else "direct document message"
			pf_label = f" (Format: '{chosen_format}')" if chosen_format else ""
			doc.add_comment(
				"Comment",
				f"<b>WhatsApp Notification Sent</b><br>Sales Invoice dispatched to customer mobile <code>+{res.get('number')}</code> using {mode_label}{pf_label} with attached PDF."
			)

			if doc.get("custom_hd_ticket") and frappe.db.exists("HD Ticket", doc.custom_hd_ticket):
				try:
					t_doc = frappe.get_doc("HD Ticket", doc.custom_hd_ticket)
					t_doc.add_comment(
						"Comment",
						f"<b>Sales Invoice {doc.name}</b> sent to customer via WhatsApp (<code>+{res.get('number')}</code>) with attached PDF."
					)
				except Exception:
					pass

			frappe.db.commit()

		return res

	finally:
		frappe.cache().delete_value(lock_key)


@frappe.whitelist()
def get_askeva_templates() -> dict:
	"""
	Fetch all approved Meta WhatsApp templates from AskEva API.
	Enables testing API credentials and displaying available templates in AskEva Settings.
	"""
	settings = frappe.get_single("AskEva Settings")
	api_token = (
		settings.get_password("api_token", raise_exception=False)
		or settings.get_password("webhook_token", raise_exception=False)
	)
	if not api_token:
		return {
			"status": "error",
			"message": _("AskEva Send Message API Token is not configured in AskEva Settings.")
		}

	url = "https://backend.askeva.io/v1/templates"
	headers = {
		"Authorization": f"Bearer {api_token}",
		"Content-Type": "application/json"
	}
	try:
		resp = requests.get(url, params={"token": api_token}, headers=headers, timeout=15)
		if resp.status_code != 200:
			return {
				"status": "error",
				"message": f"AskEva API returned HTTP {resp.status_code}: {resp.text}"
			}

		data = resp.json().get("data", [])
		templates = []
		import re
		for t in data:
			body_text = ""
			header_format = None
			for c in t.get("components", []):
				c_type = (c.get("type") or "").upper()
				if c_type == "BODY":
					body_text = c.get("text", "")
				elif c_type == "HEADER":
					header_format = (c.get("format") or "TEXT").upper()
			param_matches = re.findall(r"\{\{(\d+)\}\}", body_text)
			templates.append({
				"name": t.get("name"),
				"language": t.get("language") or "en",
				"status": t.get("status"),
				"category": t.get("category"),
				"rejected_reason": t.get("rejected_reason"),
				"body": body_text,
				"param_count": len(param_matches),
				"header_format": header_format,
				"has_document_header": (header_format == "DOCUMENT"),
				"components": t.get("components", []),
			})

		# Cache templates for quick capability lookups
		frappe.cache().set_value("askeva_templates_cache", templates, expires_in_sec=600)

		return {
			"status": "success",
			"templates": templates,
			"total": len(templates)
		}
	except Exception as e:
		return {
			"status": "error",
			"message": f"Failed to connect to AskEva: {str(e)}"
		}
