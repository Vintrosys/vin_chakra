// Employee list only: hide the "All <Region>" branches (All Chennai, All Madurai)
// from the Branch filter dropdown. Other pages keep them.
(function () {
    const proto = frappe.ui.form.ControlLink.prototype;
    if (proto._vc_hide_all_branches) return; // patch once
    proto._vc_hide_all_branches = true;

    const original = proto.set_custom_query;
    proto.set_custom_query = function (args) {
        original.call(this, args);

        const route = frappe.get_route() || [];
        const on_employee_list =
            (route[0] === "List" || route[0] === "Report") && route[1] === "Employee";

        if (!on_employee_list || !this.df || this.df.options !== "Branch" || args.query) return;

        if (!args.filters) {
            args.filters = {};
        }
        if (Array.isArray(args.filters)) {
            args.filters.push(["Branch", "name", "not like", "All %"]);
        } else if (typeof args.filters === "object") {
            args.filters.name = ["not like", "All %"];
        }
    };
})();