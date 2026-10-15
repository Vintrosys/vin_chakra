import json
import unittest
import frappe
from vin_chakra import whatsapp_api

TEST_API_TOKEN = "e23ea0202b426c38afde141a89d8d3c89f08765fa19dcc4bb7cb68a6ae6e418521b8ba213057689a15f4531173ccbb30efc4b69b06cdb5d7887398e1097c8a08"


class TestWhatsAppIntakeFlow(unittest.TestCase):
	def setUp(self):
		whatsapp_api.set_webhook_token(TEST_API_TOKEN)
		frappe.form_dict = frappe._dict()

	def tearDown(self):
		frappe.form_dict = frappe._dict()
		frappe.db.rollback()

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

	def test_existing_customer_and_ticket_machine_flow(self):
		"""
		Flow 1: Existing Customer + Ticket Machine.
		- Existing Customer form matches customer in ERPNext.
		- Ticket Machine form creates HD Ticket with status 'Not Specified'.
		"""
		# Pre-create or ensure an existing customer in ERPNext
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


def run_tests():
	"""Runner callable via bench execute."""
	suite = unittest.TestLoader().loadTestsFromTestCase(TestWhatsAppIntakeFlow)
	runner = unittest.TextTestRunner(verbosity=2)
	result = runner.run(suite)
	if not result.wasSuccessful():
		raise RuntimeError(f"Tests failed: {len(result.failures)} failures, {len(result.errors)} errors")
	print("\n>>> ALL ASKEVA CHATBOT INTAKE TESTS PASSED WITH STATUS 'NOT SPECIFIED'! <<<")
	return True
