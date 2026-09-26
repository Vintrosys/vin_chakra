frappe.ui.form.on("Sales Invoice", {
	setup(frm) {
		if (frappe.route_options) {
			let cust = frappe.route_options.customer;
			let mop = frappe.route_options.custom_mode_of_payment;
			let ticket = frappe.route_options.ticket_name;
			if (cust) {
				sessionStorage.setItem("tp_invoice_customer", cust);
			}
			if (mop) {
				sessionStorage.setItem("tp_invoice_mode_of_payment", mop);
			}
			if (ticket) {
				sessionStorage.setItem("tp_invoice_ticket", ticket);
			}
		}
	},

	onload(frm) {
		if (frm.is_new()) {
			let cust = (frappe.route_options && frappe.route_options.customer)
				|| sessionStorage.getItem("tp_invoice_customer");
			let mop = (frappe.route_options && frappe.route_options.custom_mode_of_payment)
				|| sessionStorage.getItem("tp_invoice_mode_of_payment");
			let ticket = (frappe.route_options && frappe.route_options.ticket_name)
				|| sessionStorage.getItem("tp_invoice_ticket");

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

			populate_hd_ticket_machines(frm, ticket);
		}
	},

	refresh(frm) {
		if (frm.is_new()) {
			let cust = (frappe.route_options && frappe.route_options.customer)
				|| sessionStorage.getItem("tp_invoice_customer");
			let mop = (frappe.route_options && frappe.route_options.custom_mode_of_payment)
				|| sessionStorage.getItem("tp_invoice_mode_of_payment");
			let ticket = (frappe.route_options && frappe.route_options.ticket_name)
				|| sessionStorage.getItem("tp_invoice_ticket");

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

			populate_hd_ticket_machines(frm, ticket);
		} else {
			clear_invoice_session();
		}
		toggle_service_charges(frm);
	},

	custom_nature_of_job(frm) {
		toggle_service_charges(frm);
	},

	after_save(frm) {
		clear_invoice_session();
	},

	on_submit(frm) {
		clear_invoice_session();
	}
});

function clear_invoice_session() {
	sessionStorage.removeItem("tp_invoice_customer");
	sessionStorage.removeItem("tp_invoice_mode_of_payment");
	sessionStorage.removeItem("tp_invoice_ticket");
	sessionStorage.removeItem("tp_invoice_machines");
}

function populate_hd_ticket_machines(frm, ticket_name) {
	if (!frm.is_new()) return;

	let stored_mop = sessionStorage.getItem("tp_invoice_mode_of_payment");
	if (stored_mop && (!frm.doc.custom_mode_of_payment || frm.doc.custom_mode_of_payment !== stored_mop)) {
		frm.set_value("custom_mode_of_payment", stored_mop);
	}

	let stored_machines_str = sessionStorage.getItem("tp_invoice_machines");
	let has_machines = false;
	if (stored_machines_str) {
		try {
			let machines = JSON.parse(stored_machines_str);
			if (Array.isArray(machines) && machines.length > 0) {
				has_machines = true;
				if (!frm.doc.custom_hd_ticket_machine_ || frm.doc.custom_hd_ticket_machine_.length === 0) {
					frm.clear_table("custom_hd_ticket_machine_");
					machines.forEach((m) => {
						let row = frm.add_child("custom_hd_ticket_machine_");
						row.machine_type = m.machine_type;
						row.machine_name = m.machine_name;
						row.machine_brand = m.machine_brand;
						row.machine_quantity = m.machine_quantity || 1;
						row.machine_problem = m.machine_problem;
						row.purchased_at_scs = m.purchased_at_scs;
						row.purchase_year = m.purchase_year;
						row.model_no = m.model_no;
					});
					frm.refresh_field("custom_hd_ticket_machine_");
				}
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
				let mode_of_payment = res.mode_of_payment || res.custom_mode_of_payment || "";
				if (mode_of_payment) {
					sessionStorage.setItem("tp_invoice_mode_of_payment", mode_of_payment);
					if (!frm.doc.custom_mode_of_payment || frm.doc.custom_mode_of_payment !== mode_of_payment) {
						frm.set_value("custom_mode_of_payment", mode_of_payment);
					}
				}

				if (!has_machines && (!frm.doc.custom_hd_ticket_machine_ || frm.doc.custom_hd_ticket_machine_.length === 0)) {
					let machines = res.machines || [];
					if (machines && machines.length > 0) {
						sessionStorage.setItem("tp_invoice_machines", JSON.stringify(machines));
						frm.clear_table("custom_hd_ticket_machine_");
						machines.forEach((m) => {
							let row = frm.add_child("custom_hd_ticket_machine_");
							row.machine_type = m.machine_type;
							row.machine_name = m.machine_name;
							row.machine_brand = m.machine_brand;
							row.machine_quantity = m.machine_quantity || 1;
							row.machine_problem = m.machine_problem;
							row.purchased_at_scs = m.purchased_at_scs;
							row.purchase_year = m.purchase_year;
							row.model_no = m.model_no;
						});
						frm.refresh_field("custom_hd_ticket_machine_");
					}
				}
			}
		});
	}
}

function toggle_service_charges(frm) {
	let val = (frm.doc.custom_nature_of_job || "").trim().toLowerCase();

	// 1. Service charges: Only paid "Service" or "Servicing" shows service charges.
	// Options like "Installation" and "Service (Warranty)" hide service charges.
	let show_charges = val === "service" || val === "servicing";
	frm.toggle_display("custom_service_charges", show_charges);
	if (!show_charges && frm.doc.custom_service_charges) {
		frm.set_value("custom_service_charges", 0);
	}

	// 2. Due Date: Hide while custom_nature_of_job is "Installation" or "Service (Warranty)"
	let hide_due_date = val === "installation" || val === "service (warranty)";
	frm.toggle_display("due_date", !hide_due_date);
	frm.set_df_property("due_date", "reqd", !hide_due_date ? 0 : 1);
}


