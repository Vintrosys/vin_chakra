frappe.ui.form.on("Sales Invoice", {

	// ─── SETUP ─────────────────────────────────────────────────────────────────
	// Runs once when the form class is first created (before DOM is ready).
	// Capture route_options here so they survive navigation.
	setup(frm) {
		// Only store session keys when navigating FROM the technician portal
		let ro = frappe.route_options || {};
		if (ro.from_technician_portal || ro.ticket_name) {
			if (ro.customer)              sessionStorage.setItem("tp_inv_customer", ro.customer);
			if (ro.ticket_name)           sessionStorage.setItem("tp_inv_ticket",   ro.ticket_name);
			if (ro.custom_mode_of_payment) sessionStorage.setItem("tp_inv_mop",    ro.custom_mode_of_payment);
			// Mark this form session as portal-originated
			sessionStorage.setItem("tp_inv_active", "1");
		}
	},

	// ─── ONLOAD ────────────────────────────────────────────────────────────────
	// Fires once when the form is first loaded. Best place for one-time async
	// operations on a new doc (frm.is_new() is reliable here).
	onload(frm) {
		if (!frm.is_new()) return;

		let is_portal = sessionStorage.getItem("tp_inv_active") === "1";
		if (!is_portal) return;

		let customer   = sessionStorage.getItem("tp_inv_customer") || "";
		let ticket     = sessionStorage.getItem("tp_inv_ticket")   || "";
		let mop        = sessionStorage.getItem("tp_inv_mop")      || "";

		// Set scalar fields immediately
		if (customer && frm.doc.customer !== customer) {
			frm.set_value("customer", customer);
		}
		if (mop && frm.doc.custom_mode_of_payment !== mop) {
			frm.set_value("custom_mode_of_payment", mop);
		}

		// Fetch machines directly from the ticket — no sessionStorage for machines
		if (ticket) {
			frappe.call({
				method: "vin_chakra.technician_api.get_invoice_init_details",
				args: { ticket_name: ticket },
				freeze: false,
				callback(r) {
					let machines = (r.message || {}).machines || [];
					_populate_machine_table(frm, machines);
				}
			});
		}
	},

	// ─── REFRESH ───────────────────────────────────────────────────────────────
	refresh(frm) {
		if (!frm.is_new()) {
			// Saved/submitted doc — clear session so next new invoice starts clean
			_clear_tp_session();
		}

		toggle_service_charges(frm);
		render_apply_button(frm);

		let val = (frm.doc.custom_nature_of_job || "").trim().toLowerCase();
		if (val === "service" || val === "servicing") {
			frm.add_custom_button(__("Apply Service Charge"), function () {
				apply_service_charges_to_items(frm);
			});
		}
	},

	// ─── ONLOAD_POST_RENDER ────────────────────────────────────────────────────
	onload_post_render(frm) {
		render_apply_button(frm);
	},

	// ─── FIELD EVENTS ──────────────────────────────────────────────────────────
	custom_nature_of_job(frm) {
		toggle_service_charges(frm);
		render_apply_button(frm);
		update_service_charges_from_machines(frm);
	},

	// ─── SAVE / SUBMIT ─────────────────────────────────────────────────────────
	before_save(frm) { remove_empty_item_rows(frm); },
	validate(frm)    { remove_empty_item_rows(frm); },
	after_save(frm)  { _clear_tp_session(); },
	on_submit(frm)   { _clear_tp_session(); },

	// ─── UPI QR BUTTON ─────────────────────────────────────────────────────────
	custom_upi_qr_code(frm) {
		let company = frm.doc.company;
		if (!company) {
			frappe.msgprint(__("Please set a Company on this invoice first."));
			return;
		}

		frappe.db.get_value("Company", company, "custom_upi_qr", function (r) {
			let qr_url = r && r.custom_upi_qr;
			if (!qr_url) {
				frappe.msgprint(__("No UPI QR code image found for company: {0}", [company]));
				return;
			}

			let d = new frappe.ui.Dialog({
				title: __("UPI QR Code"),
				size: "large"
			});

			$(d.body).html(`
				<div style="text-align:center; padding: 16px;">
					<img
						src="${qr_url}"
						alt="UPI QR Code"
						style="max-width:100%; max-height:500px; border-radius:8px; box-shadow:0 2px 12px rgba(0,0,0,0.15);"
					/>
					<p style="margin-top:12px; font-size:13px; color:#555;">${company}</p>
				</div>
			`);

			d.show();
		});
	}
});

// ─── MACHINE TYPE LIST CHILD TABLE EVENTS ──────────────────────────────────────
frappe.ui.form.on("Machine type list", {
	machine_type(frm)                    { update_service_charges_from_machines(frm); },
	machine_quantity(frm)                { update_service_charges_from_machines(frm); },
	custom_hd_ticket_machine__add(frm)   { update_service_charges_from_machines(frm); },
	custom_hd_ticket_machine__remove(frm){ update_service_charges_from_machines(frm); }
});

// ─── HELPERS ───────────────────────────────────────────────────────────────────

/**
 * Populate the custom_hd_ticket_machine_ child table from a machines array
 * returned by get_invoice_init_details. Clears any existing rows first.
 */
function _populate_machine_table(frm, machines) {
	if (!frm || !frm.is_new()) return;
	if (!Array.isArray(machines) || machines.length === 0) return;

	frm.clear_table("custom_hd_ticket_machine_");

	machines.forEach(function (m) {
		let row = frm.add_child("custom_hd_ticket_machine_");
		row.machine_type     = m.machine_type     || "";
		row.machine_name     = m.machine_name     || "";
		row.machine_brand    = m.machine_brand    || "";
		row.machine_quantity = m.machine_quantity || 1;
		row.machine_problem  = m.machine_problem  || "";
		row.purchased_at_scs = m.purchased_at_scs || "";
		row.purchase_year    = m.purchase_year    || "";
		row.model_no         = m.model_no         || "";
	});

	frm.refresh_field("custom_hd_ticket_machine_");
	update_service_charges_from_machines(frm);
}

/** Clear all session keys set by the technician portal invoice flow. */
function _clear_tp_session() {
	["tp_inv_active", "tp_inv_customer", "tp_inv_ticket", "tp_inv_mop"].forEach(function (k) {
		sessionStorage.removeItem(k);
	});
}

function remove_empty_item_rows(frm) {
	if (!frm.doc || !frm.doc.items || !frm.doc.items.length) return;
	let before = frm.doc.items.length;
	frm.doc.items = frm.doc.items.filter(
		row => row.item_code && String(row.item_code).trim() !== ""
	);
	if (frm.doc.items.length !== before) frm.refresh_field("items");
}

function update_service_charges_from_machines(frm) {
	if (!frm || !frm.doc) return;

	let val = (frm.doc.custom_nature_of_job || "").trim().toLowerCase();
	if (val !== "service" && val !== "servicing") return;

	let machine_rows = [];
	let machine_items = [];

	(frm.doc.custom_hd_ticket_machine_ || []).forEach(function (row) {
		let id = row.machine_type || row.machine_name || row.model_no;
		if (id) {
			machine_items.push(id);
			machine_rows.push({ identifier: id, qty: flt(row.machine_quantity) || 1 });
		}
	});

	// Fallback to single machine fields
	if (machine_items.length === 0) {
		let m = frm.doc.custom_machine_type || frm.doc.custom_machine_model || frm.doc.custom_machine_name;
		if (m) {
			machine_items.push(m);
			machine_rows.push({ identifier: m, qty: 1 });
		}
	}

	if (machine_items.length === 0) return;

	frappe.call({
		method: "vin_chakra.technician_api.get_machine_service_charges",
		args: { item_codes: machine_items },
		callback: function (r) {
			let rate_map = r.message || {};
			let total = 0;
			machine_rows.forEach(function (row) {
				total += (flt(rate_map[row.identifier]) || 0) * row.qty;
			});
			total = Math.round(total * 100) / 100;
			if (total > 0) {
				frm.set_value("custom_service_charges", total);
				frm.refresh_field("custom_service_charges");
			}
		}
	});
}

function apply_service_charges_to_items(frm) {
	if (!frm || !frm.doc) return;

	let charge_amount = flt(frm.doc.custom_service_charges) || 0;
	if (!frm.doc.items) frm.doc.items = [];

	let existing = (frm.doc.items || []).find(function (item) {
		let code = (item.item_code || "").toLowerCase();
		let name = (item.item_name || "").toLowerCase();
		return code.includes("service charge") || name.includes("service charge") || code === "ticket service charges";
	});

	if (existing) {
		frappe.model.set_value(existing.doctype, existing.name, "rate",   charge_amount);
		frappe.model.set_value(existing.doctype, existing.name, "amount", (flt(existing.qty) || 1) * charge_amount);
		// Ensure mandatory fields are set even on existing row
		if (!existing.uom)            frappe.model.set_value(existing.doctype, existing.name, "uom",               "Nos");
		if (!existing.income_account)  frappe.model.set_value(existing.doctype, existing.name, "income_account",    "Service - SCSS");
		if (!existing.conversion_factor) frappe.model.set_value(existing.doctype, existing.name, "conversion_factor", 1);
	} else {
		let row           = frm.add_child("items");
		row.item_code     = "Ticket Service Charges";
		row.item_name     = "Ticket Service Charges";
		row.qty           = 1;
		row.rate          = charge_amount;
		row.amount        = charge_amount;
		row.uom           = "Nos";
		row.conversion_factor = 1;
		row.income_account = "Service - SCSS";
	}

	frm.refresh_field("items");

	if (frm.doc.items && frm.doc.items.length) {
		frm.script_manager.trigger("items_add", frm.doc.items[0].doctype, frm.doc.items[0].name);
	}
	if (frm.cscript && frm.cscript.calculate_taxes_and_totals) {
		frm.cscript.calculate_taxes_and_totals(frm.doc);
	}

	frappe.show_alert({
		message:   __("Applied Service Charge ({0}) to Items table", [format_currency(charge_amount)]),
		indicator: "green"
	});
}

function render_apply_button(frm) {
	if (!frm.fields_dict.custom_service_charges) return;
	let $wrapper = frm.fields_dict.custom_service_charges.$wrapper;
	if (!$wrapper || $wrapper.find(".btn-apply-service-charge").length) return;

	let $btn = $(`
		<button type="button" class="btn btn-xs btn-primary btn-apply-service-charge ml-2"
			style="margin-top:3px; padding:4px 12px; font-weight:600; white-space:nowrap;">
			Apply
		</button>
	`);

	$btn.on("click", function (e) {
		e.preventDefault();
		apply_service_charges_to_items(frm);
	});

	let $inp = $wrapper.find(".control-input-wrapper");
	if ($inp.length) {
		$inp.css({ display: "flex", "align-items": "center" }).append($btn);
	}
}

function toggle_service_charges(frm) {
	let val = (frm.doc.custom_nature_of_job || "").trim().toLowerCase();

	// Show service charges only for "Service" / "Servicing"
	let show_charges = val === "service" || val === "servicing";
	frm.toggle_display("custom_service_charges", show_charges);
	if (show_charges) {
		render_apply_button(frm);
		update_service_charges_from_machines(frm);
	} else if (frm.doc.custom_service_charges) {
		frm.set_value("custom_service_charges", 0);
		frm.refresh_field("custom_service_charges");
	}

	// Hide due_date for Installation / Service (Warranty)
	let hide_due = val === "installation" || val === "service (warranty)";
	frm.toggle_display("due_date", !hide_due);
	frm.set_df_property("due_date", "reqd", hide_due ? 1 : 0);
}
