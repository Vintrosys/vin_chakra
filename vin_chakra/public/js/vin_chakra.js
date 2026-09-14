// vin_chakra.js - Global Desk enhancements
(function () {
	window.triggerQuickEntryFromSupport = function () {
		const targetJson = sessionStorage.getItem("tk_quick_entry_target");
		let target = null;
		if (targetJson) {
			try { target = JSON.parse(targetJson); } catch (e) {}
		}

		const params = new URLSearchParams(window.location.search);
		const qeParam = params.get("quick_entry");
		let targetDoctype = (target && target.doctype) || (qeParam && qeParam !== "1" ? qeParam : "Customer");

		if (targetDoctype.toLowerCase() === "item" || targetDoctype.toLowerCase() === "machine") {
			targetDoctype = "Item";
		} else if (targetDoctype.toLowerCase() === "machine-problem" || targetDoctype.toLowerCase() === "machine_problem") {
			targetDoctype = "Machine Problem";
		} else if (targetDoctype.toLowerCase() === "customer") {
			targetDoctype = "Customer";
		}

		const params = new URLSearchParams(window.location.search);
		const qeParam = params.get("quick_entry");
		const isQuickEntry = sessionStorage.getItem("tk_is_quick_entry") === "1" || Boolean(qeParam);
		const fromSupport = sessionStorage.getItem("tk_return_to_ticket_support") === "1" || Boolean(qeParam);

		if (!fromSupport || !isQuickEntry) return;
		if (window.__tk_quick_entry_open) return;

		// Check if user is on a Desk full form page (e.g. Form/Customer/...)
		const route = (frappe.get_route_str && frappe.get_route_str()) || "";
		if (route.startsWith("Form/") && !qeParam && sessionStorage.getItem("tk_is_quick_entry") !== "1") {
			return;
		}

		if (!window.frappe || !frappe.ui || !frappe.ui.form || !frappe.ui.form.make_quick_entry) {
			return;
		}

		window.__tk_quick_entry_open = true;
		sessionStorage.setItem("tk_return_to_ticket_support", "1");

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
								mobile_no: doc.mobile_no || doc.mobile_number || "",
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
								sessionStorage.removeItem("tk_is_quick_entry");
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
			});
	};

	window.triggerCustomerQuickEntry = window.triggerQuickEntryFromSupport;

	$(document).on("app_ready", function () {
		const params = new URLSearchParams(window.location.search);
		const isQuickEntry = sessionStorage.getItem("tk_is_quick_entry") === "1" || Boolean(params.get("quick_entry"));
		const fromSupport = sessionStorage.getItem("tk_return_to_ticket_support") === "1" || Boolean(params.get("quick_entry"));
		if (fromSupport && isQuickEntry) {
			setTimeout(window.triggerQuickEntryFromSupport, 250);
		}
	});

	if (frappe.router && frappe.router.on) {
		frappe.router.on("change", function () {
			const params = new URLSearchParams(window.location.search);
			const isQuickEntry = sessionStorage.getItem("tk_is_quick_entry") === "1" || Boolean(params.get("quick_entry"));
			const fromSupport = sessionStorage.getItem("tk_return_to_ticket_support") === "1" || Boolean(params.get("quick_entry"));
			if (fromSupport && isQuickEntry && !window.__tk_quick_entry_open) {
				setTimeout(window.triggerQuickEntryFromSupport, 250);
			}
		});
	}
})();
