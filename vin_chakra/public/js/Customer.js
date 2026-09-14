frappe.ui.form.on("Customer", {
	custom_secondary_phone(frm) {
		if (frm.doc.custom_secondary_phone && frm.doc.phone_nos) {
			const secPhone = String(frm.doc.custom_secondary_phone).trim();
			const exists = (frm.doc.phone_nos || []).some(r => String(r.phone || '').trim() === secPhone);
			if (!exists && secPhone) {
				const row = frm.add_child("phone_nos");
				row.phone = secPhone;
				frm.refresh_field("phone_nos");
			}
		}
	},
	after_save(frm) {
		if (sessionStorage.getItem("tk_return_to_ticket_support") === "1") {
			sessionStorage.removeItem("tk_return_to_ticket_support");
			const targetJson = sessionStorage.getItem("tk_quick_entry_target");
			let target = null;
			if (targetJson) { try { target = JSON.parse(targetJson); } catch (e) {} }
			sessionStorage.setItem(
				"tk_created_doc",
				JSON.stringify({
					doctype: "Customer",
					doc: frm.doc,
					target: target
				})
			);
			sessionStorage.setItem(
				"tk_selected_customer",
				JSON.stringify({
					name: frm.doc.name,
					customer_name: frm.doc.customer_name || frm.doc.name,
					mobile_no: frm.doc.mobile_no || frm.doc.mobile_number || "",
					email_id: frm.doc.email_id || frm.doc.email_address || "",
					address_line1: frm.doc.address_line1 || "",
					city: frm.doc.city || "",
					state: frm.doc.state || "",
				})
			);
			window.location.assign("/ticket-support");
		}
	},
});

