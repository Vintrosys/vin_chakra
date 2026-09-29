frappe.ui.form.on("Sales Invoice", {
	setup(frm) {
		if (frappe.route_options) {
			let cust = frappe.route_options.customer;
			let ticket = frappe.route_options.ticket_name;
			let mop = frappe.route_options.custom_mode_of_payment;
			let from_tp = frappe.route_options.from_technician_portal;

			if (from_tp || ticket) {
				sessionStorage.setItem("tp_invoice_active", "1");
			}
			if (cust) {
				sessionStorage.setItem("tp_invoice_customer", cust);
			}
			if (ticket) {
				sessionStorage.setItem("tp_invoice_ticket", ticket);
			}
			if (mop) {
				sessionStorage.setItem("tp_invoice_mode_of_payment", mop);
			}
		}
	},

	onload(frm) {
		if (frm.is_new()) {
			apply_invoice_portal_details(frm);
		}
	},

	refresh(frm) {
		if (frm.is_new()) {
			apply_invoice_portal_details(frm);
		} else {
			clear_invoice_session();
		}
		toggle_service_charges(frm);
		render_apply_button(frm);

		let val = (frm.doc.custom_nature_of_job || "").trim().toLowerCase();
		if (val === "service" || val === "servicing") {
			frm.add_custom_button(__('Apply Service Charge'), function() {
				apply_service_charges_to_items(frm);
			});
		}
	},

	onload_post_render(frm) {
		render_apply_button(frm);
	},

	custom_nature_of_job(frm) {
		toggle_service_charges(frm);
		render_apply_button(frm);
		update_service_charges_from_machines(frm);
	},

	before_save(frm) {
		remove_empty_item_rows(frm);
	},

	validate(frm) {
		remove_empty_item_rows(frm);
	},

	after_save(frm) {
		clear_invoice_session();
	},

	on_submit(frm) {
		clear_invoice_session();
	}
});

function apply_invoice_portal_details(frm) {
	let is_portal = frappe.route_options && (frappe.route_options.from_technician_portal || frappe.route_options.ticket_name);
	let is_active = sessionStorage.getItem("tp_invoice_active") === "1";

	if (is_portal || is_active) {
		let cust = (frappe.route_options && frappe.route_options.customer)
			|| sessionStorage.getItem("tp_invoice_customer");
		let ticket = (frappe.route_options && frappe.route_options.ticket_name)
			|| sessionStorage.getItem("tp_invoice_ticket");
		let mop = (frappe.route_options && frappe.route_options.custom_mode_of_payment)
			|| sessionStorage.getItem("tp_invoice_mode_of_payment");

		if (cust) {
			sessionStorage.setItem("tp_invoice_customer", cust);
			if (!frm.doc.customer || frm.doc.customer !== cust) {
				frm.set_value("customer", cust);
			}
		}

		if (mop) {
			sessionStorage.setItem("tp_invoice_mode_of_payment", mop);
			if (!frm.doc.custom_mode_of_payment || frm.doc.custom_mode_of_payment !== mop) {
				frm.set_value("custom_mode_of_payment", mop);
			}
		}

		if (ticket) {
			sessionStorage.setItem("tp_invoice_ticket", ticket);
			populate_hd_ticket_machines(frm, ticket);
		}
	} else {
		clear_invoice_session();
	}
}

function remove_empty_item_rows(frm) {
	if (frm.doc && frm.doc.items && frm.doc.items.length > 0) {
		let initial_len = frm.doc.items.length;
		frm.doc.items = frm.doc.items.filter(row => row.item_code && String(row.item_code).trim() !== "");
		if (frm.doc.items.length !== initial_len) {
			frm.refresh_field("items");
		}
	}
}

frappe.ui.form.on("Machine type list", {
	machine_type(frm) {
		update_service_charges_from_machines(frm);
	},
	machine_quantity(frm) {
		update_service_charges_from_machines(frm);
	},
	custom_hd_ticket_machine__add(frm) {
		update_service_charges_from_machines(frm);
	},
	custom_hd_ticket_machine__remove(frm) {
		update_service_charges_from_machines(frm);
	}
});

function update_service_charges_from_machines(frm) {
	if (!frm || !frm.doc) return;

	let val = (frm.doc.custom_nature_of_job || "").trim().toLowerCase();
	let show_charges = val === "service" || val === "servicing";
	if (!show_charges) return;

	let machine_items = [];
	let machine_rows = [];

	if (frm.doc.custom_hd_ticket_machine_ && frm.doc.custom_hd_ticket_machine_.length > 0) {
		frm.doc.custom_hd_ticket_machine_.forEach((row) => {
			let identifier = row.machine_type || row.machine_name || row.model_no;
			if (identifier) {
				machine_items.push(identifier);
				machine_rows.push({
					identifier: identifier,
					qty: flt(row.machine_quantity) || 1
				});
			}
		});
	}

	if (machine_items.length === 0) {
		let single_m = frm.doc.custom_machine_type || frm.doc.custom_machine_model || frm.doc.custom_machine_name;
		if (single_m) {
			machine_items.push(single_m);
			machine_rows.push({
				identifier: single_m,
				qty: 1
			});
		}
	}

	if (machine_items.length === 0) return;

	frappe.call({
		method: "vin_chakra.technician_api.get_machine_service_charges",
		args: { item_codes: machine_items },
		callback: function(r) {
			let rate_map = r.message || {};
			let total_amount = 0;

			machine_rows.forEach((row) => {
				let rate = flt(rate_map[row.identifier]) || 0;
				total_amount += (row.qty * rate);
			});

			total_amount = Math.round(total_amount * 100) / 100;

			if (total_amount > 0) {
				frm.set_value("custom_service_charges", total_amount);
				frm.refresh_field("custom_service_charges");
			}
		}
	});
}

function apply_service_charges_to_items(frm) {
	if (!frm || !frm.doc) return;

	let charge_amount = flt(frm.doc.custom_service_charges) || 0;
	if (!frm.doc.items) {
		frm.doc.items = [];
	}

	let item_row = (frm.doc.items || []).find((item) => {
		let code = (item.item_code || "").toLowerCase();
		let name = (item.item_name || "").toLowerCase();
		return code.includes("service charge") || name.includes("service charge") || code === "ticket service charges";
	});

	if (item_row) {
		frappe.model.set_value(item_row.doctype, item_row.name, "rate", charge_amount);
		frappe.model.set_value(item_row.doctype, item_row.name, "amount", (flt(item_row.qty) || 1) * charge_amount);
	} else {
		let row = frm.add_child("items");
		row.item_code = "Ticket Service Charges";
		row.item_name = "Ticket Service Charges";
		row.qty = 1;
		row.rate = charge_amount;
		row.amount = charge_amount;
	}

	frm.refresh_field("items");

	if (frm.doc.items && frm.doc.items.length > 0) {
		frm.script_manager.trigger("items_add", frm.doc.items[0].doctype, frm.doc.items[0].name);
	}
	if (frm.cscript && frm.cscript.calculate_taxes_and_totals) {
		frm.cscript.calculate_taxes_and_totals(frm.doc);
	}

	frappe.show_alert({
		message: __("Applied Service Charge ({0}) to Items table", [format_currency(charge_amount)]),
		indicator: "green"
	});
}

function render_apply_button(frm) {
	if (!frm.fields_dict.custom_service_charges) return;
	let $wrapper = frm.fields_dict.custom_service_charges.$wrapper;
	if (!$wrapper || $wrapper.find('.btn-apply-service-charge').length > 0) return;

	let $btn = $(`
		<button type="button" class="btn btn-xs btn-primary btn-apply-service-charge ml-2" style="margin-top: 3px; padding: 4px 12px; font-weight: 600; white-space: nowrap;">
			Apply
		</button>
	`);

	$btn.on('click', function(e) {
		e.preventDefault();
		apply_service_charges_to_items(frm);
	});

	let $inputWrapper = $wrapper.find('.control-input-wrapper');
	if ($inputWrapper.length > 0) {
		$inputWrapper.css({'display': 'flex', 'align-items': 'center'}).append($btn);
	}
}

function clear_invoice_session() {
	sessionStorage.removeItem("tp_invoice_active");
	sessionStorage.removeItem("tp_invoice_customer");
	sessionStorage.removeItem("tp_invoice_mode_of_payment");
	sessionStorage.removeItem("tp_invoice_phone");
	sessionStorage.removeItem("tp_invoice_ticket");
	sessionStorage.removeItem("tp_invoice_machines");
}

function populate_hd_ticket_machines(frm, ticket_name) {
	if (!frm.is_new()) return;

	// Check if rows actually have machine content (ignore Frappe's empty default row)
	let has_real_rows = (frm.doc.custom_hd_ticket_machine_ || []).some(
		row => row.machine_type && String(row.machine_type).trim() !== ""
	);
	if (has_real_rows) {
		update_service_charges_from_machines(frm);
		return;
	}

	function render_machines(machines) {
		if (!Array.isArray(machines) || machines.length === 0) return;
		frm.clear_table("custom_hd_ticket_machine_");
		machines.forEach((m) => {
			let row = frm.add_child("custom_hd_ticket_machine_");
			row.machine_type = m.machine_type || "";
			row.machine_name = m.machine_name || "";
			row.machine_brand = m.machine_brand || "";
			row.machine_quantity = m.machine_quantity || 1;
			row.machine_problem = m.machine_problem || "";
			row.purchased_at_scs = m.purchased_at_scs || "";
			row.purchase_year = m.purchase_year || "";
			row.model_no = m.model_no || "";
		});
		frm.refresh_field("custom_hd_ticket_machine_");
		update_service_charges_from_machines(frm);
	}

	let stored_machines_str = sessionStorage.getItem("tp_invoice_machines");
	if (stored_machines_str) {
		try {
			let machines = JSON.parse(stored_machines_str);
			if (Array.isArray(machines) && machines.length > 0) {
				render_machines(machines);
				return;
			}
		} catch (e) {
			console.error("Error parsing stored machines:", e);
		}
	}

	if (ticket_name) {
		frappe.call({
			method: "vin_chakra.technician_api.get_invoice_init_details",
			args: { ticket_name: ticket_name },
			callback: function(r) {
				let res = r.message || {};
				let machines = res.machines || [];
				if (machines && machines.length > 0) {
					sessionStorage.setItem("tp_invoice_machines", JSON.stringify(machines));
					render_machines(machines);
				}
			}
		});
	}
}

function toggle_service_charges(frm) {
	let val = (frm.doc.custom_nature_of_job || "").trim().toLowerCase();

	// 1. Service charges: Only paid "Service" or "Servicing" shows service charges.
	let show_charges = val === "service" || val === "servicing";
	frm.toggle_display("custom_service_charges", show_charges);
	if (show_charges) {
		render_apply_button(frm);
		update_service_charges_from_machines(frm);
	} else if (frm.doc.custom_service_charges) {
		frm.set_value("custom_service_charges", 0);
		frm.refresh_field("custom_service_charges");
	}

	// 2. Due Date: Hide while custom_nature_of_job is "Installation" or "Service (Warranty)"
	let hide_due_date = val === "installation" || val === "service (warranty)";
	frm.toggle_display("due_date", !hide_due_date);
	frm.set_df_property("due_date", "reqd", !hide_due_date ? 0 : 1);
}
