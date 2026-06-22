frappe.ui.form.on('CO3 SMS Log', {
	refresh(frm) {
		frm.add_custom_button(__('Resend SMS'), function() {
			frappe.call({
				method: 'vin_chakra.vin_chakra.doctype.co3_sms_log.co3_sms_log.resend_sms',
				args: {
					name: frm.doc.name
				},
				freeze: true,
				freeze_message: __('Resending SMS...'),
				callback: function(r) {
					if (!r.exc) {
						if (r.message && r.message.status === 'success') {
							frappe.show_alert({message: __('SMS Resent Successfully'), indicator: 'green'});
						} else {
							frappe.show_alert({message: __('Failed to resend SMS'), indicator: 'red'});
						}
					}
				}
			});
		});
	}
});
