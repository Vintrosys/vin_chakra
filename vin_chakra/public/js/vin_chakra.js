// vin_chakra.js - Global Desk enhancements
(function () {
	window.triggerQuickEntryFromSupport = function () {
		const fromSupport = sessionStorage.getItem("tk_return_to_ticket_support") === "1";
		const isQuickEntry = sessionStorage.getItem("tk_is_quick_entry") === "1";

		// Strictly require BOTH flags from ticket-support to be present.
		// If not coming from ticket support form, do absolutely nothing!
		if (!fromSupport || !isQuickEntry) return;

		// Consume tk_is_quick_entry IMMEDIATELY so any page refresh won't re-trigger!
		sessionStorage.removeItem("tk_is_quick_entry");

		// Clean quick_entry query parameter from browser URL if present
		if (window.history && window.history.replaceState) {
			try {
				const url = new URL(window.location.href);
				if (url.searchParams.has("quick_entry")) {
					url.searchParams.delete("quick_entry");
					window.history.replaceState({}, document.title, url.toString());
				}
			} catch (e) {}
		}

		if (window.__tk_quick_entry_open) return;

		const targetJson = sessionStorage.getItem("tk_quick_entry_target");
		let target = null;
		if (targetJson) {
			try { target = JSON.parse(targetJson); } catch (e) {}
		}

		const params = new URLSearchParams(window.location.search);
		const hashParams = new URLSearchParams(window.location.hash.includes('?') ? window.location.hash.split('?')[1] : '');
		const qeParam = params.get("quick_entry") || hashParams.get("quick_entry");
		let targetDoctype = (target && target.doctype) || (qeParam && qeParam !== "1" ? qeParam : "Customer");

		if (targetDoctype.toLowerCase() === "item" || targetDoctype.toLowerCase() === "machine") {
			targetDoctype = "Item";
		} else if (targetDoctype.toLowerCase() === "machine-problem" || targetDoctype.toLowerCase() === "machine_problem") {
			targetDoctype = "Machine Problem";
		} else if (targetDoctype.toLowerCase() === "customer") {
			targetDoctype = "Customer";
		}

		// Check if user is on a Desk full form page (e.g. Form/Customer/...)
		const route = (frappe.get_route_str && frappe.get_route_str()) || "";
		if (route.startsWith("Form/")) {
			return;
		}

		if (!window.frappe || !frappe.ui || !frappe.ui.form || !frappe.ui.form.make_quick_entry) {
			// Restore flag temporarily to retry when UI is ready
			sessionStorage.setItem("tk_is_quick_entry", "1");
			setTimeout(window.triggerQuickEntryFromSupport, 200);
			return;
		}

		window.__tk_quick_entry_open = true;

		frappe.ui.form
			.make_quick_entry(
				targetDoctype,
				function (doc) {
					// Called after document is inserted via Quick Entry
					sessionStorage.removeItem("tk_return_to_ticket_support");
					sessionStorage.removeItem("tk_quick_entry_target");
					sessionStorage.removeItem("tk_is_quick_entry");
					sessionStorage.setItem(
						"tk_created_doc",
						JSON.stringify({
							doctype: targetDoctype,
							doc: doc,
							target: target
						})
					);
					if (targetDoctype === "Customer") {
						sessionStorage.setItem(
							"tk_selected_customer",
							JSON.stringify({
								name: doc.name,
								customer_name: doc.customer_name || doc.name,
								mobile_no: doc.mobile_no || doc.mobile_number || doc.custom_secondary_phone || "",
								email_id: doc.email_id || doc.email_address || "",
								address_line1: doc.address_line1 || "",
								city: doc.city || "",
								state: doc.state || "",
							})
						);
					}
					window.location.assign("/ticket-support");
				},
				null, // init_callback
				null, // doc
				true // force quick entry
			)
			.then((qe) => {
				if (qe && qe.dialog) {
					const orig_onhide = qe.dialog.onhide;
					qe.dialog.onhide = function () {
						if (orig_onhide) orig_onhide.apply(this, arguments);
						window.__tk_quick_entry_open = false;
						setTimeout(() => {
							const curRoute = (frappe.get_route_str && frappe.get_route_str()) || "";
							const cleanRouteTarget = targetDoctype.replace(/\s+/g, "");
							if (curRoute.startsWith(`Form/${cleanRouteTarget}`) || curRoute.startsWith(`Form/${targetDoctype}`)) {
								// User clicked 'Edit Full Form' - let Doctype JS handle after_save
								return;
							}
							if (sessionStorage.getItem("tk_return_to_ticket_support") === "1") {
								sessionStorage.removeItem("tk_return_to_ticket_support");
								sessionStorage.removeItem("tk_quick_entry_target");
								sessionStorage.removeItem("tk_is_quick_entry");
								window.location.assign("/ticket-support");
							}
						}, 300);
					};
				}
			})
			.catch((err) => {
				console.error(`Failed to open ${targetDoctype} Quick Entry:`, err);
				window.__tk_quick_entry_open = false;
				sessionStorage.removeItem("tk_return_to_ticket_support");
				sessionStorage.removeItem("tk_quick_entry_target");
				sessionStorage.removeItem("tk_is_quick_entry");
			});
	};

	window.triggerCustomerQuickEntry = window.triggerQuickEntryFromSupport;

	function checkAndTrigger() {
		const fromSupport = sessionStorage.getItem("tk_return_to_ticket_support") === "1";
		const isQuickEntry = sessionStorage.getItem("tk_is_quick_entry") === "1";
		if (fromSupport && isQuickEntry && !window.__tk_quick_entry_open) {
			window.triggerQuickEntryFromSupport();
		}
	}

	$(document).on("app_ready", function () {
		setTimeout(checkAndTrigger, 200);
	});

	if (frappe.router && frappe.router.on) {
		frappe.router.on("change", function () {
			setTimeout(checkAndTrigger, 200);
		});
	}

	if (window.app_ready || document.readyState === "complete" || (window.frappe && frappe.boot)) {
		setTimeout(checkAndTrigger, 300);
	}
})();


