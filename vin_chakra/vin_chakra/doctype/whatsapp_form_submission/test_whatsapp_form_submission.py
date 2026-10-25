import json
import time
import unittest
from unittest.mock import MagicMock, patch
import frappe
from vin_chakra import whatsapp_api

# NOTE: This is a dummy, non-secret value used only for tests. Never put a real
# AskEva API / webhook token in source control.
TEST_API_TOKEN = "vinchakra_test_token_00000000000000000000"


class TestWhatsAppIntakeFlow(unittest.TestCase):
	def setUp(self):
		s = frappe.get_single("AskEva Settings")
		self.orig_settings = s.as_dict()
		self.orig_api_token = s.get_password("api_token", raise_exception=False)
		self.orig_webhook_token = s.get_password("webhook_token", raise_exception=False)
		self.orig_enabled = s.enabled

		# Unique per-run suffix: these tests commit, and inbound intake is now
		# idempotent on message_id, so fixed ids would dedup across re-runs.
		self.run_id = frappe.generate_hash(length=8)

		whatsapp_api.set_webhook_token(TEST_API_TOKEN)
		frappe.form_dict = frappe._dict()

	def _mid(self, tag):
		return f"wamid.{tag}-{self.run_id}"

	def tearDown(self):
		frappe.form_dict = frappe._dict()
		frappe.set_user("Administrator")
		frappe.db.rollback()

		# Restore original settings so the test token never persists on a live singleton.
		try:
			s = frappe.get_single("AskEva Settings")
			s.enabled = self.orig_enabled
			s.webhook_token = self.orig_webhook_token or ""
			s.api_token = self.orig_api_token or ""
			if self.orig_settings:
				s.invoice_send_mode = self.orig_settings.get("invoice_send_mode", "Template Message")
				s.invoice_template_name = self.orig_settings.get("invoice_template_name", "test")
				s.include_pdf_link = self.orig_settings.get("include_pdf_link", 1)
			s.save(ignore_permissions=True)
			frappe.db.commit()
		except Exception:
			pass

	# ── Auth ────────────────────────────────────────────────────────────────
	def test_auth_rejection_without_token(self):
		"""Requests without token must raise PermissionError."""
		frappe.form_dict = frappe._dict()
		with self.assertRaises(frappe.PermissionError):
			whatsapp_api.receive_form()

	def test_auth_rejection_with_invalid_token(self):
		"""Requests with incorrect token must raise PermissionError."""
		frappe.form_dict = frappe._dict({"token": "invalid_wrong_token_123"})
		with self.assertRaises(frappe.PermissionError):
			whatsapp_api.receive_form()

	# ── Security regressions ─────────────────────────────────────────────────
	def test_pdf_token_generator_is_not_guest_exposed(self):
		"""Regression: the token generator must NOT be a guest endpoint (IDOR oracle)."""
		self.assertNotIn(whatsapp_api._generate_invoice_pdf_token, frappe.guest_methods)
		self.assertNotIn(whatsapp_api._generate_invoice_pdf_token, frappe.whitelisted)
		# The actual download endpoint stays guest-accessible.
		self.assertIn(whatsapp_api.download_invoice_pdf, frappe.guest_methods)

	def test_inbound_free_text_is_html_escaped(self):
		"""Regression: customer free text must not land unescaped in the ticket HTML description."""
		user_number = "919000000001"
		frappe.form_dict = frappe._dict({
			"token": TEST_API_TOKEN,
			"form_name": "Ticket Machine",
			"userNumber": user_number,
			"message_id": self._mid("XSS1"),
			"fields": json.dumps({
				"Customer Name": "XSS Tester",
				"Mobile Number": user_number,
				"Machine Brand": "Juki",
				"Machine Problem": "<script>alert('xss')</script>",
				"Subject": "Hacky subject",
			}),
		})
		res = whatsapp_api.receive_form()
		self.assertEqual(res.get("status"), "success")
		ticket = frappe.get_doc("HD Ticket", res.get("ticket"))
		self.assertNotIn("<script>", ticket.description)
		self.assertIn("&lt;script&gt;", ticket.description)

	def test_duplicate_webhook_is_idempotent(self):
		"""Regression: a retried machine-form webhook must not create a second ticket."""
		user_number = "919000000002"
		machine = frappe._dict({
			"token": TEST_API_TOKEN,
			"form_name": "Ticket Machine",
			"userNumber": user_number,
			"message_id": self._mid("DUPLICATE123"),
			"fields": json.dumps({
				"Customer Name": "Dup Customer",
				"Mobile Number": user_number,
				"Machine Brand": "Brother",
				"Machine Problem": "Not working",
				"Subject": "Dup test",
			}),
		})

		frappe.form_dict = frappe._dict(machine)
		r1 = whatsapp_api.receive_form()
		self.assertEqual(r1.get("status"), "success")

		frappe.form_dict = frappe._dict(machine)
		r2 = whatsapp_api.receive_form()
		self.assertEqual(r2.get("status"), "duplicate")
		self.assertEqual(r2.get("ticket"), r1.get("ticket"))

	# ── Intake flows ─────────────────────────────────────────────────────────
	def test_existing_customer_and_ticket_machine_flow(self):
		"""
		Flow 1: Existing Customer + Ticket Machine.
		- Existing Customer form matches customer in ERPNext.
		- Ticket Machine form creates HD Ticket with status 'Not Specified'.
		"""
		existing_phone = "9566329971"
		customer_name = "Iron Express"
		existing_cust_id = whatsapp_api._find_customer_by_phone(existing_phone)
		if not existing_cust_id:
			c = frappe.new_doc("Customer")
			c.customer_name = customer_name
			c.mobile_no = existing_phone
			c.flags.ignore_mandatory = True
			c.insert(ignore_permissions=True)
			frappe.db.commit()
			existing_cust_id = c.name

		user_number = "919047438173"

		# Step 1: User fills 'Existing Customer' form on chatbot
		frappe.form_dict = frappe._dict({
			"token": TEST_API_TOKEN,
			"form_name": "Existing Customer",
			"userNumber": user_number,
			"message_id": self._mid("EX1"),
			"fields": json.dumps({
				"Customer Name": customer_name,
				"Mobile Number": existing_phone
			})
		})
		res1 = whatsapp_api.receive_form()
		self.assertEqual(res1.get("status"), "stored")
		self.assertEqual(res1.get("form_type"), "Existing Customer")
		sub1_name = res1.get("submission")
		self.assertTrue(sub1_name)

		sub1 = frappe.get_doc("WhatsApp Form Submission", sub1_name)
		self.assertEqual(sub1.processing_status, "Pending")

		# Step 2: User fills 'Ticket Machine' form on chatbot
		frappe.form_dict = frappe._dict({
			"token": TEST_API_TOKEN,
			"form_name": "Ticket Machine",
			"userNumber": user_number,
			"message_id": self._mid("EX2"),
			"fields": json.dumps({
				"Ticket Type": "Service",
				"Machine Brand": "Juki",
				"Purchase Year": "2019",
				"Machine Problem": "Not working",
				"Purchase At SCSS": "Yes",
				"Secondary Phone No": "9677500416",
				"Subject": "My machine is not working"
			})
		})
		res2 = whatsapp_api.receive_form()
		self.assertEqual(res2.get("status"), "success")
		self.assertEqual(res2.get("ticket_status"), "Not Specified")
		ticket_id = res2.get("ticket")
		self.assertTrue(ticket_id)

		# Verify HD Ticket values and status
		ticket = frappe.get_doc("HD Ticket", ticket_id)
		self.assertEqual(ticket.status, "Not Specified")
		self.assertEqual(ticket.customer, existing_cust_id)
		self.assertEqual(ticket.subject, "My machine is not working")
		self.assertEqual(ticket.custom_purchase_year, "2019")
		self.assertEqual(ticket.custom_purchased_at_sree_chakra_sewing_systems, "Yes")
		self.assertEqual(ticket.custom_machine_brand, "Juki")

		# Verify machine child row
		self.assertTrue(len(ticket.custom_machine_type_list) >= 1)
		row = ticket.custom_machine_type_list[0]
		self.assertEqual(row.machine_quantity, 1)
		self.assertEqual(row.purchase_year, "2019")
		self.assertEqual(row.purchased_at_scs, "Yes")
		self.assertTrue(row.machine_type)  # Item populated to satisfy constraints

		# Verify both submissions are marked Processed
		sub1.reload()
		self.assertEqual(sub1.processing_status, "Processed")
		self.assertEqual(sub1.hd_ticket, ticket_id)

	def test_new_customer_and_ticket_machine_flow(self):
		"""
		Flow 2: New Customer + Ticket Machine.
		- New Customer form creates Customer, Address, and Contact in ERPNext.
		- Ticket Machine form creates HD Ticket with status 'Not Specified'.
		"""
		user_number = "919047438999"
		new_phone = "9047438999"
		new_name = "Harrish Ragavan"
		new_address = "West street koduvilarpatti Theni\n625534"

		# Step 1: User fills 'New Customer' form on chatbot
		frappe.form_dict = frappe._dict({
			"token": TEST_API_TOKEN,
			"form_name": "New Customer",
			"userNumber": user_number,
			"message_id": self._mid("NC1"),
			"fields": json.dumps({
				"Name": new_name,
				"Phone": new_phone,
				"Address": new_address
			})
		})
		res1 = whatsapp_api.receive_form()
		self.assertEqual(res1.get("status"), "stored")
		self.assertEqual(res1.get("form_type"), "New Customer")
		sub1_name = res1.get("submission")
		self.assertTrue(sub1_name)

		# Step 2: User fills 'Ticket Machine' form on chatbot
		frappe.form_dict = frappe._dict({
			"token": TEST_API_TOKEN,
			"form_name": "Ticket Machine",
			"userNumber": user_number,
			"message_id": self._mid("NC2"),
			"fields": json.dumps({
				"Ticket Type": "Service",
				"Machine Brand": "Juki",
				"Purchase Year": "2019",
				"Machine Problem": "Not working",
				"Purchase At SCSS": "Yes",
				"Secondary Phone No": "9677500416",
				"Subject": "My machine is not working"
			})
		})
		res2 = whatsapp_api.receive_form()
		self.assertEqual(res2.get("status"), "success")
		self.assertEqual(res2.get("ticket_status"), "Not Specified")
		ticket_id = res2.get("ticket")
		self.assertTrue(ticket_id)

		# Verify Ticket
		ticket = frappe.get_doc("HD Ticket", ticket_id)
		self.assertEqual(ticket.status, "Not Specified")
		self.assertTrue(ticket.customer)
		self.assertTrue(ticket.contact)
		self.assertEqual(ticket.custom_state, "Tamil Nadu")
		self.assertIn("Theni", ticket.custom_address)

		# Verify new customer record in ERPNext
		cust = frappe.get_doc("Customer", ticket.customer)
		self.assertEqual(cust.customer_name, new_name)
		self.assertEqual(cust.mobile_no, new_phone)

		# Verify linked Address in ERPNext
		self.assertTrue(cust.customer_primary_address)
		addr = frappe.get_doc("Address", cust.customer_primary_address)
		self.assertEqual(addr.pincode, "625534")
		self.assertEqual(addr.state, "Tamil Nadu")

	def test_unified_single_stage_flow(self):
		"""Single combined form submission creates Customer and HD Ticket with status 'Not Specified'."""
		user_phone = "9876599112"
		frappe.form_dict = frappe._dict({
			"token": TEST_API_TOKEN,
			"form_name": "Ticket Machine",
			"userNumber": user_phone,
			"message_id": self._mid("UNIFIED1"),
			"fields": json.dumps({
				"Customer Name": "Unified Customer Test",
				"Mobile Number": user_phone,
				"Address": "12 Mount Road, Chennai 600002",
				"Machine Brand": "Brother",
				"Purchase Year": "2022",
				"Purchase At SCSS": "Yes",
				"Machine Problem": "Thread Breakage",
				"Subject": "Need service for Brother machine"
			})
		})
		res = whatsapp_api.receive_form()
		self.assertEqual(res.get("status"), "success")
		self.assertEqual(res.get("ticket_status"), "Not Specified")

		ticket = frappe.get_doc("HD Ticket", res.get("ticket"))
		self.assertEqual(ticket.status, "Not Specified")
		self.assertEqual(ticket.custom_customer_name, "Unified Customer Test")

	def test_invoice_notification_preview_and_send(self):
		"""Test invoice preview and WhatsApp message dispatch with template parameters."""
		# 1. Create a customer
		cust_phone = "9840123456"
		cust_name = "Test WhatsApp Invoice Customer"
		cust = frappe.new_doc("Customer")
		cust.customer_name = cust_name
		cust.mobile_no = cust_phone
		cust.flags.ignore_mandatory = True
		cust.insert(ignore_permissions=True)

		# 2. Create a Sales Invoice
		company = frappe.db.get_value("Company", {}, "name") or "Sree Chakra Sewing Systems"
		inv = frappe.new_doc("Sales Invoice")
		inv.customer = cust.name
		inv.company = company
		inv.custom_mode_of_payment = "Cash"
		inv.append("items", {
			"item_code": frappe.db.get_value("Item", {}, "name") or "Test Item",
			"qty": 1,
			"rate": 1500
		})
		inv.flags.ignore_mandatory = True
		inv.insert(ignore_permissions=True)
		frappe.db.commit()

		# Test preview
		preview = whatsapp_api.get_invoice_notification_preview(inv.name)
		self.assertEqual(preview["invoice_name"], inv.name)
		self.assertEqual(preview["target_phone"], cust_phone)
		self.assertIn("1,500", preview["grand_total"])
		self.assertTrue(len(preview["param_values"]) >= 3)
		self.assertIn(inv.name, preview["pdf_link"])
		self.assertIn("key=", preview["pdf_link"])
		self.assertIn("exp=", preview["pdf_link"])

		# Test secure PDF download: Guest without key must raise PermissionError
		frappe.set_user("Guest")
		with self.assertRaises(frappe.PermissionError):
			whatsapp_api.download_invoice_pdf(inv.name)

		# Guest with a valid, unexpired signed key must succeed
		valid_exp = int(time.time()) + 3600
		valid_pdf_key = whatsapp_api._generate_invoice_pdf_token(inv.name, valid_exp)
		whatsapp_api.download_invoice_pdf(inv.name, key=valid_pdf_key, exp=valid_exp)
		self.assertEqual(frappe.local.response.type, "pdf")

		# Guest with an EXPIRED signed key must be rejected
		expired_exp = int(time.time()) - 10
		expired_key = whatsapp_api._generate_invoice_pdf_token(inv.name, expired_exp)
		with self.assertRaises(frappe.PermissionError):
			whatsapp_api.download_invoice_pdf(inv.name, key=expired_key, exp=expired_exp)

		# Tampered exp (valid signature for a different exp) must be rejected
		with self.assertRaises(frappe.PermissionError):
			whatsapp_api.download_invoice_pdf(inv.name, key=valid_pdf_key, exp=valid_exp + 1)

		frappe.set_user("Administrator")

		# Test parameter sanitization for Meta API compliance
		dirty_param = "Line1\nLine2\r\nLine3\tTab   Spaces"
		clean = whatsapp_api._sanitize_meta_param(dirty_param)
		self.assertNotIn("\n", clean)
		self.assertNotIn("\t", clean)
		self.assertNotIn("\r", clean)

		# Test dispatch with AskEva Settings enabled and mocked requests.post
		settings = frappe.get_single("AskEva Settings")
		settings.enabled = 1
		settings.api_token = TEST_API_TOKEN
		settings.invoice_send_mode = "Template Message"
		settings.invoice_template_name = "service_invoice"
		settings.include_pdf_link = 1
		settings.save(ignore_permissions=True)

		with patch("requests.post") as mock_post:
			mock_resp = MagicMock()
			mock_resp.status_code = 200
			mock_resp.json.return_value = {"status": "success", "message_id": "wa_msg_123"}
			mock_resp.text = '{"status":"success"}'
			mock_post.return_value = mock_resp

			res = whatsapp_api.send_sales_invoice_whatsapp(inv.name, cust_phone)
			self.assertEqual(res.get("status"), "success")
			self.assertIn("91" + cust_phone, res.get("message"))

			# Verify mock was called with proper structure
			mock_post.assert_called_once()
			args, kwargs = mock_post.call_args
			self.assertIn("https://backend.askeva.io/v1/message/send-message", args[0])
			self.assertIn(f"Bearer {TEST_API_TOKEN}", kwargs["headers"]["Authorization"])
			payload = kwargs["json"]
			self.assertEqual(payload["to"], "91" + cust_phone)
			self.assertEqual(payload["number"], "91" + cust_phone)
			self.assertEqual(payload["type"], "template")
			self.assertEqual(payload["template"]["name"], "service_invoice")
			self.assertTrue(len(payload["parameters"]) >= 3)

			# PDF attached via a document header component (allowed outside 24h window)
			components = payload["template"].get("components", [])
			header = next((c for c in components if c.get("type") == "header"), None)
			self.assertIsNotNone(header, "template must carry a document header for the PDF")
			self.assertEqual(header["parameters"][0]["type"], "document")
			self.assertIn("download_invoice_pdf", header["parameters"][0]["document"]["link"])
			self.assertTrue(header["parameters"][0]["document"]["filename"].endswith(".pdf"))

		# Test Direct Text Message mode with PDF attachment -> document message
		settings.invoice_send_mode = "Direct Text Message"
		settings.include_pdf_link = 1
		settings.save(ignore_permissions=True)

		with patch("requests.post") as mock_post:
			mock_resp = MagicMock()
			mock_resp.status_code = 200
			mock_resp.json.return_value = {"status": "success"}
			mock_resp.text = '{"status":"success"}'
			mock_post.return_value = mock_resp

			res2 = whatsapp_api.send_sales_invoice_whatsapp(inv.name)
			self.assertEqual(res2.get("status"), "success")
			args, kwargs = mock_post.call_args
			payload = kwargs["json"]
			self.assertEqual(payload["to"], "91" + cust_phone)
			self.assertEqual(payload["type"], "document")
			self.assertIn("download_invoice_pdf", payload["document"]["link"])
			self.assertTrue(payload["document"]["filename"].endswith(".pdf"))
			self.assertNotIn("/", payload["document"]["filename"])
			self.assertIn(inv.name, payload["document"]["caption"])

		# Direct Text mode with PDF attachment disabled -> plain text message
		settings.include_pdf_link = 0
		settings.save(ignore_permissions=True)

		with patch("requests.post") as mock_post:
			mock_resp = MagicMock()
			mock_resp.status_code = 200
			mock_resp.json.return_value = {"status": "success"}
			mock_resp.text = '{"status":"success"}'
			mock_post.return_value = mock_resp

			res3 = whatsapp_api.send_sales_invoice_whatsapp(inv.name)
			self.assertEqual(res3.get("status"), "success")
			args, kwargs = mock_post.call_args
			payload = kwargs["json"]
			self.assertEqual(payload["type"], "text")
			self.assertIn(inv.name, payload["message"])


def run_tests():
	"""Runner callable via bench execute."""
	suite = unittest.TestLoader().loadTestsFromTestCase(TestWhatsAppIntakeFlow)
	runner = unittest.TextTestRunner(verbosity=2)
	result = runner.run(suite)
	if not result.wasSuccessful():
		raise RuntimeError(f"Tests failed: {len(result.failures)} failures, {len(result.errors)} errors")
	print("\n>>> ALL ASKEVA CHATBOT INTAKE TESTS PASSED WITH STATUS 'NOT SPECIFIED'! <<<")
	return True
