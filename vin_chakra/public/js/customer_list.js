frappe.provide("frappe.listview_settings.Customer");

(function () {
	const prev_onload = frappe.listview_settings["Customer"].onload;

	frappe.listview_settings["Customer"].onload = function (listview) {
		if (prev_onload) {
			prev_onload.apply(this, arguments);
		}

		if (typeof window.triggerCustomerQuickEntry === "function") {
			window.triggerCustomerQuickEntry();
		}
	};
})();

