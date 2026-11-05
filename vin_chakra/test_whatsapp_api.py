"""Tests for the AskEva outbound Sales-Invoice WhatsApp delivery path.

The inbound chatbot intake (and its `WhatsApp Form Submission` doctype) was
removed, so this suite only exercises the invoice preview, the signed PDF
download-link token, and the AskEva dispatch engine. `requests.post` is mocked,
so no real WhatsApp message is ever sent.
"""

import time
import unittest
from unittest.mock import MagicMock, patch

import frappe

from vin_chakra import whatsapp_api

# Dummy, non-secret value used only for tests.
TEST_API_TOKEN = "vinchakra_test_token_00000000000000000000"


class TestAskEvaInvoiceDispatch(unittest.TestCase):
	def setUp(self):
		self._cleanup = []

		s = frappe.get_single("AskEva Settings")
		self.orig_api_token = s.get_password("api_token", raise_exception=False)
		self.orig_enabled = s.enabled
		self.orig_send_mode = s.invoice_send_mode
		self.orig_template = s.invoice_template_name
		self.orig_include_pdf = s.include_pdf_link

		s.enabled = 1
		s.api_token = TEST_API_TOKEN
		s.invoice_send_mode = "Template Message"
		s.invoice_template_name = "service_invoice_with_pdf"
		s.invoice_template_params = "{customer_name}, {ticket_no}, {amount}, {payment_mode}, {technician_name}"
		s.include_pdf_link = 1
		s.save(ignore_permissions=True)
		frappe.db.commit()

	def tearDown(self):
		frappe.set_user("Administrator")
		frappe.db.rollback()

		# Remove anything a test committed (send_sales_invoice_whatsapp commits).
		for doctype, name in reversed(self._cleanup):
			try:
				if frappe.db.exists(doctype, name):
					frappe.delete_doc(doctype, name, force=True, ignore_permissions=True, delete_permanently=True)
			except Exception:
				pass
		frappe.db.commit()

		try:
			s = frappe.get_single("AskEva Settings")
			s.enabled = self.orig_enabled
			s.api_token = self.orig_api_token or ""
			s.invoice_send_mode = self.orig_send_mode or "Template Message"
			s.invoice_template_name = self.orig_template or ""
			s.include_pdf_link = self.orig_include_pdf
			s.save(ignore_permissions=True)
			frappe.db.commit()
		except Exception:
			pass

	# ── helpers ──────────────────────────────────────────────────────────────
	def _make_invoice(self, phone="9840123456"):
		cust = frappe.new_doc("Customer")
		cust.customer_name = "ZZ Test WA Invoice Customer"
		cust.mobile_no = phone
		cust.flags.ignore_mandatory = True
		cust.insert(ignore_permissions=True)
		self._cleanup.append(("Customer", cust.name))

		company = frappe.db.get_value("Company", {}, "name")
		inv = frappe.new_doc("Sales Invoice")
		inv.customer = cust.name
		inv.company = company
		inv.custom_mode_of_payment = "Cash"
		inv.append("items", {
			"item_code": frappe.db.get_value("Item", {}, "name"),
			"qty": 1,
			"rate": 1500,
		})
		inv.flags.ignore_mandatory = True
		inv.insert(ignore_permissions=True)
		self._cleanup.append(("Sales Invoice", inv.name))
		return inv

	def _mock_ok(self):
		mock_resp = MagicMock()
		mock_resp.status_code = 200
		mock_resp.json.return_value = {"status": "success", "message_id": "wa_msg_123"}
		mock_resp.text = '{"status":"success"}'
		return mock_resp

	# ── Security regression ───────────────────────────────────────────────────
	def test_pdf_token_generator_is_not_guest_exposed(self):
		"""The token generator must NOT be a guest endpoint (IDOR oracle)."""
		self.assertNotIn(whatsapp_api._generate_invoice_pdf_token, frappe.guest_methods)
		self.assertNotIn(whatsapp_api._generate_invoice_pdf_token, frappe.whitelisted)
		self.assertIn(whatsapp_api.download_invoice_pdf, frappe.guest_methods)

	# ── Signed PDF link token logic (no PDF render needed) ─────────────────────
	def test_pdf_token_sign_and_verify(self):
		name = "SI/TEST/0001"
		valid_exp = int(time.time()) + 3600
		key = whatsapp_api._generate_invoice_pdf_token(name, valid_exp, print_format="Service invoice")

		# Correct key + format + unexpired → valid
		self.assertTrue(whatsapp_api._verify_invoice_pdf_token(name, key, valid_exp, "Service invoice"))
		# Tampered expiry (signature no longer matches) → invalid
		self.assertFalse(whatsapp_api._verify_invoice_pdf_token(name, key, valid_exp + 1, "Service invoice"))
		# Expired link → invalid even with a correctly-signed key
		expired_exp = int(time.time()) - 10
		expired_key = whatsapp_api._generate_invoice_pdf_token(name, expired_exp, print_format="Service invoice")
		self.assertFalse(whatsapp_api._verify_invoice_pdf_token(name, expired_key, expired_exp, "Service invoice"))
		# Wrong invoice name → invalid
		self.assertFalse(whatsapp_api._verify_invoice_pdf_token("SI/TEST/9999", key, valid_exp, "Service invoice"))

	def test_download_guest_without_key_is_rejected(self):
		"""A guest hitting the download endpoint with no signed key is rejected before any render."""
		inv = self._make_invoice()
		frappe.db.commit()
		frappe.set_user("Guest")
		try:
			with self.assertRaises(frappe.PermissionError):
				whatsapp_api.download_invoice_pdf(inv.name)
		finally:
			frappe.set_user("Administrator")

	# ── Preview (read-only; resolves phone + signs link) ───────────────────────
	def test_invoice_notification_preview(self):
		inv = self._make_invoice(phone="9840123456")
		preview = whatsapp_api.get_invoice_notification_preview(inv.name)
		self.assertEqual(preview["invoice_name"], inv.name)
		self.assertEqual(preview["target_phone"], "9840123456")
		self.assertIn("1,500", preview["grand_total"])
		self.assertTrue(len(preview["param_values"]) >= 3)
		self.assertIn(inv.name, preview["pdf_link"])
		self.assertIn("key=", preview["pdf_link"])
		self.assertIn("exp=", preview["pdf_link"])
		# The message body must never leak the raw download link.
		self.assertNotIn("download_invoice_pdf", preview["rendered_text"])
		self.assertNotIn("{pdf_link}", preview["rendered_text"])

	# ── Dispatch engine: Template mode ─────────────────────────────────────────
	def test_send_template_mode_builds_document_header(self):
		inv = self._make_invoice(phone="9840123456")
		with patch("requests.post") as mock_post:
			mock_post.return_value = self._mock_ok()
			res = whatsapp_api.send_sales_invoice_whatsapp(inv.name, "9840123456", print_format="Service invoice")

		self.assertEqual(res.get("status"), "success")
		self.assertIn("919840123456", res.get("message"))
		mock_post.assert_called_once()
		args, kwargs = mock_post.call_args
		self.assertIn("https://backend.askeva.io/v1/message/send-message", args[0])
		self.assertIn(f"Bearer {TEST_API_TOKEN}", kwargs["headers"]["Authorization"])
		payload = kwargs["json"]
		self.assertEqual(payload["to"], "919840123456")
		self.assertEqual(payload["type"], "template")
		self.assertEqual(payload["template"]["name"], "service_invoice_with_pdf")
		self.assertEqual(len(payload["parameters"]), 5)
		# PDF attached via a document header (allowed outside the 24h window)
		header = next((c for c in payload["template"].get("components", []) if c.get("type") == "header"), None)
		self.assertIsNotNone(header, "template must carry a document header for the PDF")
		self.assertEqual(header["parameters"][0]["type"], "document")
		self.assertIn("download_invoice_pdf", header["parameters"][0]["document"]["link"])
		self.assertIn("format=Service", header["parameters"][0]["document"]["link"])
		self.assertTrue(header["parameters"][0]["document"]["filename"].endswith(".pdf"))

	# ── Dispatch engine: Direct Text mode ──────────────────────────────────────
	def test_send_direct_mode_sends_document_with_clean_caption(self):
		s = frappe.get_single("AskEva Settings")
		s.invoice_send_mode = "Direct Text Message"
		s.include_pdf_link = 1
		s.save(ignore_permissions=True)

		inv = self._make_invoice(phone="9840123456")
		with patch("requests.post") as mock_post:
			mock_post.return_value = self._mock_ok()
			res = whatsapp_api.send_sales_invoice_whatsapp(inv.name, print_format="Service invoice")

		self.assertEqual(res.get("status"), "success")
		args, kwargs = mock_post.call_args
		payload = kwargs["json"]
		self.assertEqual(payload["to"], "919840123456")
		self.assertEqual(payload["type"], "document")
		self.assertIn("download_invoice_pdf", payload["document"]["link"])
		self.assertTrue(payload["document"]["filename"].endswith(".pdf"))
		self.assertNotIn("/", payload["document"]["filename"])
		self.assertIn(inv.name, payload["document"]["caption"])
		# The raw link must NOT appear in the human-readable caption.
		self.assertNotIn("download_invoice_pdf", payload["document"]["caption"])

	# ── Meta parameter sanitisation ────────────────────────────────────────────
	def test_sanitize_meta_param(self):
		clean = whatsapp_api._sanitize_meta_param("Line1\nLine2\r\nLine3\tTab   Spaces")
		self.assertNotIn("\n", clean)
		self.assertNotIn("\r", clean)
		self.assertNotIn("\t", clean)
