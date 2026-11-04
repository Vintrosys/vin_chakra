// The Branch filter of the Quotation and Sales Invoice lists. hooks.py loads this file with each
// of them, so it adds the filter to whichever of their list settings exist and lack it, after
// ERPNext and India Compliance have set theirs.
(function () {
	["Quotation", "Sales Invoice"].forEach((doctype) => {
		const settings = frappe.listview_settings[doctype];
		if (!settings || settings.has_branch_filter) return;
		settings.has_branch_filter = true;

		const prev_onload = settings.onload;
		settings.onload = function (listview) {
			if (prev_onload) {
				prev_onload.apply(this, arguments);
			}

			setup_branch_filter(listview);
		};
	});

	// custom_branch is a standard filter, so its value goes into the list's backend query, its
	// count, Load More, saved filters and the URL like any other. Frappe gives it a Link control;
	// this swaps that for a dropdown to offer "All Branches", under the same fieldname so all of
	// the above keeps working.
	function setup_branch_filter(listview) {
		const link_control = listview.page.fields_dict.custom_branch;
		if (!link_control || !listview.filter_area) return;

		const all_branches = { value: "", label: __("All Branches") };
		const has_option = (control, value) =>
			control.df.options.some((option) => (option.value ?? option) === value);

		// A saved filter was restored into the Link control before this runs
		const restored_value = link_control.get_value() || "";
		const select_control = listview.page.add_field(
			{
				fieldtype: "Select",
				fieldname: "custom_branch",
				label: __("Branch"),
				options: restored_value ? [all_branches, restored_value] : [all_branches],
				default: restored_value,
				condition: "=",
				is_filter: 1,
				onchange: () => listview.filter_area.debounced_refresh_list_view(),
			},
			listview.filter_area.standard_filters_wrapper
		);
		$(link_control.wrapper).remove();

		// The URL's filters are applied before the branch list below can arrive. A Select drops
		// a value it has no option for, which would load the list unfiltered, so add the option.
		const set_formatted_input = select_control.set_formatted_input;
		select_control.set_formatted_input = function (value) {
			if (value && !has_option(this, value)) {
				this.df.options = [...this.df.options, value];
			}
			return set_formatted_input.apply(this, arguments);
		};

		frappe.call("vin_chakra.api.get_branches").then((r) => {
			const current_value = select_control.get_value();
			const branches = r.message || [];
			if (current_value && !branches.includes(current_value)) {
				branches.push(current_value);
			}
			select_control.df.options = [all_branches, ...branches];
			select_control.set_options(); // with no argument it keeps the current selection
		});
	}
})();
