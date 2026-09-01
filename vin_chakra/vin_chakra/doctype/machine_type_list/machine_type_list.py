# Copyright (c) 2026, harrishragavan and contributors
# For license information, please see license.txt

# import frappe
from frappe.model.document import Document


class Machinetypelist(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		machine_brand: DF.Link
		machine_name: DF.Data | None
		machine_problem: DF.Link
		machine_quantity: DF.Int
		machine_type: DF.Link
		parent: DF.Data
		parentfield: DF.Data
		parenttype: DF.Data
		purchase_year: DF.Literal["2010", "2011", "2012", "2013", "2014", "2015", "2016", "2017", "2018", "2019", "2020", "2021", "2022", "2023", "2024", "2025", "2026"]
		purchased_at_scs: DF.Literal["", "Yes", "No"]
	# end: auto-generated types

	pass
