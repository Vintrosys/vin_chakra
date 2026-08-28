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
	Hook for Employee Checkin validation.
	Ensures patch is active during document validation.
	"""
	patch_employee_checkin_validation()
