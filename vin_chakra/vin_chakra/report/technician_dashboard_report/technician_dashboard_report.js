const TSR_IS_MANAGER = frappe.user.has_role("Agent Manager") || frappe.user.has_role("System Manager");

// View state is kept between refreshes
const TSR = { q: "", group: "", view: "all", page: 1, size: 25, open: {}, sel: {} };

const TSR_STATUS = {
	Open: ["Open", "open"], Working: ["In Progress", "work"], Pending: ["Pending", "pend"],
	Resolved: ["Resolved", "done"], Closed: ["Closed", "closed"],
};
const TSR_VIEWS = {
	all: ["All service tickets", () => true],
	pending: ["Pending tickets", (r) => r.status === "Pending"],
	work: ["In progress", (r) => r.status === "Working"],
	done: ["Resolved", (r) => r.status === "Resolved"],
	nocheck: ["Not checked-in", (r) => !r.first_checkin],
};
const TSR_GROUPS = { "": "None", branch: "Branch", technician: "Technician", status: "Status", ticket_type: "Type" };

const tsr_esc = (v) => frappe.utils.escape_html(v == null ? "" : String(v));
const tsr_date = (s) => (s ? s.slice(0, 10).split("-").reverse().join("-") : "-");
const tsr_dt = (s) => (s ? `${tsr_date(s)} ${s.slice(11, 16)}` : "-");

frappe.query_reports["Technician Dashboard report"] = {
	filters: [
		{
			fieldname: "from_date", label: __("From"), fieldtype: "Date", reqd: 1,
			default: frappe.datetime.add_days(frappe.datetime.get_today(), -30)
		},
		{
			fieldname: "to_date", label: __("To"), fieldtype: "Date", reqd: 1,
			default: frappe.datetime.get_today()
		},
		{
			fieldname: "technician", label: __("Technician"), fieldtype: "Link", options: "User",
			default: TSR_IS_MANAGER ? "" : frappe.session.user, read_only: TSR_IS_MANAGER ? 0 : 1
		},
		{
			fieldname: "branch", label: __("Branch"), fieldtype: "Select",
			options: "All Branches", default: "All Branches"
		},
		{
			fieldname: "status", label: __("Status"), fieldtype: "Select",
			options: "\nOpen\nWorking\nPending\nResolved\nClosed"
		},
		{
			fieldname: "priority", label: __("Priority"), fieldtype: "Select",
			options: "\nLow\nMedium\nHigh\nUrgent"
		},
		{ fieldname: "ticket_type", label: __("Type"), fieldtype: "Link", options: "HD Ticket Type" },
	],

	onload: function (report) {
		tsr_inject_css();

		// Branch options come from the server (same list as the chief dashboard)
		frappe.call({
			method: "vin_chakra.vin_chakra.report.technician_dashboard_report.technician_dashboard_report.get_branch_options",
			callback: function (r) {
				let f = report.get_filter("branch");
				f.df.options = (r.message || []).join("\n");
				f.refresh();
				if (!f.get_value()) f.set_value("All Branches");
			},
		});

		report.page.add_inner_button(__("Reset"), function () {
			let today = frappe.datetime.get_today();
			report.set_filter_value({
				from_date: frappe.datetime.add_days(today, -30), to_date: today,
				technician: TSR_IS_MANAGER ? "" : frappe.session.user,
				branch: "All Branches", status: "", priority: "", ticket_type: "",
			});
			Object.assign(TSR, { q: "", group: "", view: "all", page: 1, open: {}, sel: {} });
			report.refresh();
		});
	},

	// Replace the default table with our own view every time the report is drawn
	after_datatable_render: function () {
		tsr_render(frappe.query_report);
	},
};

function tsr_render(report) {
	let host = report.$report;
	host.find(".tsr-wrap").remove();
	host.find(".datatable, .dt-scrollable").hide();
	let wrap = $(`<div class="tsr-wrap"><div class="tsr-cards"></div><div class="tsr-main"></div></div>`).appendTo(host);
	let main = wrap.find(".tsr-main");
	tsr_cards(report, wrap.find(".tsr-cards"));
	host.closest(".report-wrapper, .layout-main-section").find(".datatable").hide();

	let all = (report.data || []).filter((r) => r && r.ticket);

	function draw() {
		let q = TSR.q.trim().toLowerCase();
		let rows = all.filter(TSR_VIEWS[TSR.view][1]).filter((r) =>
			!q || [r.ticket, r.customer, r.technician, r.branch].some((v) => (v || "").toLowerCase().includes(q)));

		if (TSR.group) {
			let key = TSR.group;
			rows = rows.slice().sort((a, b) => cstr(a[key]).localeCompare(cstr(b[key])));
		}

		let pages = Math.max(1, Math.ceil(rows.length / TSR.size));
		if (TSR.page > pages) TSR.page = pages;
		let slice = rows.slice((TSR.page - 1) * TSR.size, TSR.page * TSR.size);

		let body = "", last = null;
		slice.forEach((r, i) => {
			if (TSR.group) {
				let g = cstr(r[TSR.group]) || "-";
				if (g !== last) {
					let n = rows.filter((x) => (cstr(x[TSR.group]) || "-") === g).length;
					body += `<tr class="tsr-group"><td colspan="13">${tsr_esc(g)} <span>${n}</span></td></tr>`;
					last = g;
				}
			}
			let id = r.ticket + "|" + (r.technician || "");
			let st = TSR_STATUS[r.status] || [r.status, "open"];
			let open = TSR.open[id];
			body += `
				<tr class="tsr-row ${open ? "is-open" : ""}" data-id="${tsr_esc(id)}">
					<td><input type="checkbox" class="tsr-sel" ${TSR.sel[id] ? "checked" : ""}></td>
					<td><a class="tsr-link" data-ticket="${tsr_esc(r.ticket)}">${tsr_esc(r.ticket)}</a></td>
					<td>${tsr_date(r.ticket_date)}</td>
					<td>${tsr_esc(r.technician)}</td>
					<td>${tsr_esc(r.customer)}</td>
					<td><span class="tsr-badge ${st[1]}">${tsr_esc(st[0])}</span></td>
					<td>${tsr_esc(r.priority)}</td>
					<td>${tsr_esc(r.ticket_type)}</td>
					<td>${tsr_esc(r.branch)}</td>
					<td>${tsr_dt(r.first_checkin)}</td>
					<td>${tsr_dt(r.last_checkout)}</td>
					<td>${tsr_esc(r.duration)}</td>
					<td class="tsr-arrow">${open ? "&#8964;" : "&#8250;"}</td>
				</tr>`;
			if (open) {
				body += `
				<tr class="tsr-detail"><td colspan="13"><div class="tsr-detail-box">
					<div><b>${__("Visit notes")}</b><span>${tsr_esc(r.notes) || "-"}</span></div>
					<div><b>${__("Parts used")}</b><span>${tsr_esc(r.parts) || "-"}</span></div>
					<div><b>${__("Scheduled")}</b><span>${tsr_date(r.scheduled)}</span></div>
				</div></td></tr>`;
			}
		});
		if (!slice.length) body = `<tr><td colspan="13" class="tsr-empty">${__("No tickets found")}</td></tr>`;

		let from = rows.length ? (TSR.page - 1) * TSR.size + 1 : 0;
		let to = Math.min(TSR.page * TSR.size, rows.length);
		let nsel = Object.keys(TSR.sel).filter((k) => TSR.sel[k]).length;
		let pager = "";
		let start = Math.max(1, Math.min(TSR.page - 2, pages - 4));
		for (let p = start; p <= Math.min(pages, start + 4); p++) {
			pager += `<button class="tsr-pg ${p === TSR.page ? "on" : ""}" data-p="${p}">${p}</button>`;
		}

		let opt = (obj, cur) => Object.entries(obj).map(([k, v]) =>
			`<option value="${k}" ${k === cur ? "selected" : ""}>${tsr_esc(Array.isArray(v) ? v[0] : v)}</option>`).join("");

		main.html(`
			<div class="tsr-card">
				<div class="tsr-bar">
					<b>${rows.length} ${__("records")}</b>
					<input class="tsr-search" placeholder="${__("Search ticket, customer or technician...")}" value="${tsr_esc(TSR.q)}">
					<label>${__("Group by")}: <select class="tsr-group-sel">${opt(TSR_GROUPS, TSR.group)}</select></label>
					<label>${__("Saved view")}: <select class="tsr-view-sel">${opt(TSR_VIEWS, TSR.view)}</select></label>
					${nsel ? `<span class="tsr-selected">${nsel} ${__("selected")}</span>` : ""}
				</div>
				<div class="tsr-scroll"><table class="tsr-table">
					<thead><tr>
						<th></th><th>${__("Ticket ID")}</th><th>${__("Created On")}</th><th>${__("Technician")}</th>
						<th>${__("Customer")}</th><th>${__("Status")}</th><th>${__("Priority")}</th><th>${__("Type")}</th>
						<th>${__("Branch")}</th><th>${__("First Check-in")}</th><th>${__("Last Check-out")}</th>
						<th>${__("Duration")}</th><th></th>
					</tr></thead>
					<tbody>${body}</tbody>
				</table></div>
				<div class="tsr-foot">
					<label>${__("Rows per page")}: <select class="tsr-size">
						${[10, 25, 50, 100].map((n) => `<option ${n === TSR.size ? "selected" : ""}>${n}</option>`).join("")}</select></label>
					<span>${from}-${to} ${__("of")} ${rows.length}</span>
					<span class="tsr-pager">
						<button class="tsr-pg" data-p="${Math.max(1, TSR.page - 1)}">&#8249;</button>${pager}
						<button class="tsr-pg" data-p="${Math.min(pages, TSR.page + 1)}">&#8250;</button>
					</span>
				</div>
			</div>`);
	}

	// Search keeps the typing focus: redraw, then put the cursor back
	wrap.on("input", ".tsr-search", function () {
		TSR.q = this.value; TSR.page = 1;
		let pos = this.selectionStart;
		draw();
		let el = wrap.find(".tsr-search")[0];
		el.focus(); el.setSelectionRange(pos, pos);
	});
	wrap.on("change", ".tsr-group-sel", function () { TSR.group = this.value; TSR.page = 1; draw(); });
	wrap.on("change", ".tsr-view-sel", function () { TSR.view = this.value; TSR.page = 1; draw(); });
	wrap.on("change", ".tsr-size", function () { TSR.size = +this.value; TSR.page = 1; draw(); });
	wrap.on("click", ".tsr-pg", function () { TSR.page = +$(this).data("p"); draw(); });
	wrap.on("click", ".tsr-link", function (e) {
		e.stopPropagation();
		frappe.set_route("Form", "HD Ticket", $(this).data("ticket"));
	});
	wrap.on("change", ".tsr-sel", function () {
		TSR.sel[$(this).closest("tr").data("id")] = this.checked; draw();
	});
	wrap.on("click", ".tsr-row", function (e) {
		if ($(e.target).is("input, a")) return;
		let id = $(this).data("id");
		TSR.open[id] = !TSR.open[id];
		draw();
	});

	draw();
}

// Status boxes (counts come from the server; Status filter is ignored for the counts)
function tsr_cards(report, $el) {
	const defs = [
		["", __("Total Tickets"), "Total", "#475569", "#f1f5f9"],
		["Open", __("Open"), "Open", "#dc2626", "#fef2f2"],
		["Working", __("In Progress"), "Working", "#2563eb", "#eff6ff"],
		["Pending", __("Pending"), "Pending", "#d97706", "#fffbeb"],
		["Resolved", __("Resolved"), "Resolved", "#16a34a", "#f0fdf4"],
	];
	let current = report.get_filter_value("status") || "";
	frappe.call({
		method: "vin_chakra.vin_chakra.report.technician_dashboard_report.technician_dashboard_report.get_status_counts",
		args: { filters: report.get_filter_values() },
		callback: function (r) {
			let c = r.message || {};
			$el.html(defs.map(([val, label, key, color, bg]) => `
				<div class="tsr-box ${val === current ? "on" : ""}" data-status="${val}" style="--c:${color}; --bg:${bg}">
					<b>${c[key] || 0}</b><span>${label}</span>
				</div>`).join(""));
		},
	});
	$el.off("click").on("click", ".tsr-box", function () {
		report.set_filter_value("status", $(this).data("status"));
	});
}

function cstr(v) { return v == null ? "" : String(v); }

function tsr_inject_css() {
	if (document.getElementById("tsr-css")) return;
	let css = `
	.tsr-cards { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-bottom: 14px; }
	.tsr-box { background: var(--card-bg, #fff); border: 1px solid var(--border-color, #e5e7eb); border-top: 4px solid var(--c); border-radius: 12px; padding: 14px 16px; cursor: pointer; transition: box-shadow .15s, transform .15s; }
	.tsr-box:hover { box-shadow: 0 6px 16px rgba(0,0,0,.08); transform: translateY(-2px); }
	.tsr-box.on { background: var(--bg); box-shadow: 0 0 0 2px var(--c) inset; }
	.tsr-box b { display: block; font-size: 28px; line-height: 1.1; color: var(--c); }
	.tsr-box span { color: var(--text-muted); font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: .4px; }
	@media (max-width: 800px) { .tsr-cards { grid-template-columns: repeat(2, 1fr); } }
	.tsr-wrap { padding: 4px 0 24px; font-size: 13px; }
	.tsr-card { background: var(--card-bg, #fff); border: 1px solid var(--border-color, #e5e7eb); border-radius: 12px; overflow: hidden; }
	.tsr-bar { display: flex; flex-wrap: wrap; gap: 14px; align-items: center; padding: 12px 16px; background: var(--subtle-fg, #f3f4f6); }
	.tsr-search { flex: 1; min-width: 220px; max-width: 420px; border: 1px solid var(--border-color, #e5e7eb); border-radius: 8px; padding: 7px 12px; background: var(--control-bg, #fff); }
	.tsr-bar label, .tsr-foot label { margin: 0; color: var(--text-muted); font-weight: 500; }
	.tsr-bar select, .tsr-foot select { border: 0; background: transparent; font-weight: 600; color: var(--text-color); }
	.tsr-selected { background: #ccfbf1; color: #0f766e; border-radius: 20px; padding: 3px 10px; font-weight: 600; }
	.tsr-scroll { overflow-x: auto; }
	.tsr-table { width: 100%; border-collapse: collapse; }
	.tsr-table th { text-align: left; padding: 11px 12px; font-weight: 700; background: var(--subtle-fg, #f3f4f6); border-bottom: 1px solid var(--border-color, #e5e7eb); white-space: nowrap; }
	.tsr-table td { padding: 11px 12px; border-bottom: 1px solid var(--border-color, #eef0f3); white-space: nowrap; }
	.tsr-row { cursor: pointer; }
	.tsr-row:hover, .tsr-row.is-open { background: #f0fdfa; }
	.tsr-link { color: #2563eb; font-weight: 600; cursor: pointer; }
	.tsr-arrow { font-size: 18px; color: var(--text-muted); text-align: center; }
	.tsr-badge { padding: 2px 10px; border-radius: 6px; font-weight: 600; font-size: 12px; }
	.tsr-badge.done { background: #dcfce7; color: #166534; }
	.tsr-badge.work { background: #dbeafe; color: #1d4ed8; }
	.tsr-badge.pend { background: #ffedd5; color: #c2410c; }
	.tsr-badge.open { background: #f1f5f9; color: #475569; }
	.tsr-badge.closed { background: #e2e8f0; color: #334155; }
	.tsr-group td { background: #ecfeff; font-weight: 700; color: #0f766e; }
	.tsr-group span { background: #0f766e; color: #fff; border-radius: 10px; padding: 0 8px; margin-left: 6px; font-size: 11px; }
	.tsr-detail td { padding: 0 12px 12px; background: #f0fdfa; white-space: normal; }
	.tsr-detail-box { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; background: #fff; border: 1px solid var(--border-color, #e5e7eb); border-radius: 10px; padding: 12px 16px; }
	.tsr-detail-box b, .tsr-detail-box span { display: block; }
	.tsr-detail-box span { color: var(--text-muted); margin-top: 2px; }
	.tsr-empty { text-align: center; padding: 40px !important; color: var(--text-muted); }
	.tsr-foot { display: flex; flex-wrap: wrap; gap: 20px; align-items: center; justify-content: space-between; padding: 12px 16px; }
	.tsr-pager { display: flex; gap: 6px; }
	.tsr-pg { border: 0; background: transparent; border-radius: 6px; min-width: 28px; height: 28px; font-weight: 600; }
	.tsr-pg.on { background: #0f766e; color: #fff; }
	@media (max-width: 700px) { .tsr-detail-box { grid-template-columns: 1fr; } }`;
	let s = document.createElement("style");
	s.id = "tsr-css";
	s.textContent = css;
	document.head.appendChild(s);
}