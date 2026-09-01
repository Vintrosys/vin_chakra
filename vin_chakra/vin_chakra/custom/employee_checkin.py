import frappe

def patch_employee_checkin_validation():
	"""
	Patch EmployeeCheckin.validate_distance_from_shift_location so that
	check-out (log_type == 'OUT') does not throw "Latitude and longitude values are required for checking in."
	or fail shift location distance checks during check-out.
	"""
	try:
		from hrms.hr.doctype.employee_checkin.employee_checkin import EmployeeCheckin

		if getattr(EmployeeCheckin, "_vin_chakra_patched", False):
			return

		original_validate_distance = EmployeeCheckin.validate_distance_from_shift_location

		def custom_validate_distance_from_shift_location(self):
			# Skip location distance validation for check-out
			if self.log_type == "OUT":
				return
			return original_validate_distance(self)

		EmployeeCheckin.validate_distance_from_shift_location = custom_validate_distance_from_shift_location
		EmployeeCheckin._vin_chakra_patched = True
	except Exception as e:
		frappe.log_error(f"Failed to patch EmployeeCheckin: {str(e)}", "vin_chakra Employee Checkin Patch")

patch_employee_checkin_validation()

def validate_employee_checkin(doc, method=None):
	"""
	Hook for Employee Checkin validation in vin_chakra.
	Ensures device_id, latitude, and longitude are properly populated.
	"""
	patch_employee_checkin_validation()

	if not doc.device_id:
		doc.device_id = f"HRMS App ({frappe.session.user})"

	# Fallback for latitude and longitude if 0 or missing
	if not doc.latitude or not doc.longitude or (float(doc.latitude) == 0 and float(doc.longitude) == 0):
		last_coords = frappe.db.get_value(
			"Employee Checkin",
			{
				"employee": doc.employee,
				"latitude": ["!=", 0],
				"longitude": ["!=", 0],
			},
			["latitude", "longitude"],
			order_by="creation desc",
			as_dict=True,
		)
		if last_coords and last_coords.latitude and last_coords.longitude:
			doc.latitude = last_coords.latitude
			doc.longitude = last_coords.longitude
		else:
			shift_location = frappe.db.get_value(
				"Shift Assignment",
				{"employee": doc.employee, "docstatus": 1, "status": "Active"},
				"shift_location",
			)
			if shift_location:
				shift_coords = frappe.db.get_value(
					"Shift Location", shift_location, ["latitude", "longitude"], as_dict=True
				)
				if shift_coords and shift_coords.latitude and shift_coords.longitude:
					doc.latitude = shift_coords.latitude
					doc.longitude = shift_coords.longitude
