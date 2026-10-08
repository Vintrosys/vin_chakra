frappe.ui.form.on('Google Maps Settings', {
	refresh(frm) {
		if (!frm.doc.api_key) {
			frm.dashboard.set_headline_alert(
				'<div class="alert alert-warning" style="font-size:13px;">' +
				'<strong>API key not set.</strong> Enter your Google Maps API Key and save to enable the Technician Map.' +
				'</div>'
			);
		}
	}
});
