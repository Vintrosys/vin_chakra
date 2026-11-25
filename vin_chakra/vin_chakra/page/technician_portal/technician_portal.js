frappe.pages['technician-portal'].on_page_load = function (wrapper) {
    wrapper._dashboard = new TechnicianPortal(wrapper);
};

frappe.pages['technician-portal'].on_page_show = function (wrapper) {
    if (wrapper._dashboard) {
        wrapper._dashboard.read_url_params();
        wrapper._dashboard.sync_ui_from_state();
        wrapper._dashboard.render_view_structure();
        wrapper._dashboard.fetch_day_attendance_status();
        wrapper._dashboard.load_data();
    }
};

function getLocationSafe(hardTimeoutMs = 15000) {
    const attempt = (retryCount = 0) => {
        if (retryCount > 0) {
            frappe.show_alert({ message: "Improving GPS accuracy...", indicator: "orange" });
        }
        return Promise.race([
            new Promise((resolve, reject) => {
                if (!navigator.geolocation) {
                    return reject(new Error("Geolocation is not supported by this browser."));
                }
                navigator.geolocation.getCurrentPosition(
                    pos => {
                        const acc = pos.coords.accuracy;
                        if (acc > 100 && retryCount < 2) {
                            resolve(attempt(retryCount + 1));
                        } else {
                            resolve({
                                lat: pos.coords.latitude,
                                lng: pos.coords.longitude,
                                accuracy: acc
                            });
                        }
                    },
                    err => {
                        let msg = "Failed to fetch GPS coordinates.";
                        if (err.code === 1) msg = "Location access denied. Please enable GPS and allow location permissions.";
                        else if (err.code === 2) msg = "Location provider unavailable. Ensure GPS is on.";
                        else if (err.code === 3) msg = "GPS fetch timeout occurred.";
                        reject(new Error(msg));
                    },
                    { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
                );
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Location request timed out. Please move to an open area and retry.")), hardTimeoutMs))
        ]);
    };
    return attempt(0);
}

class TechnicianPortal {
    constructor(wrapper) {
        this.wrapper = $(wrapper);
        this.page = frappe.ui.make_app_page({
            parent: wrapper,
            title: 'Technician Portal',
            single_column: true
        });

        // State variables
        this.view_type = localStorage.getItem("tp_portal_view_type") || "card"; // card, list, calendar

        // Paginated tickets filter state
        this.tickets_start = 0;
        this.tickets_length = 10;
        this.tickets_total = 0;
        this.filters = {
            status: "",
            priority: ""
        };
        this.search_query = "";
        this.debounce_timer = null;
        this.calendar_date = new Date();
        this.current_user_fullname = "Technician";

        this.init();
    }

    init() {
        this.read_url_params();
        this.render_skeleton();
        this.sync_ui_from_state();
        this.bind_events();
        this.bind_popstate();
        this.fetch_user_fullname();
        this.fetch_day_attendance_status();
        this.load_data();
    }

    read_url_params() {
        let params = new URLSearchParams(window.location.search);
        let view = params.get("view");
        if (view && ["card", "list", "calendar"].includes(view)) {
            this.view_type = view;
        }

        let page = parseInt(params.get("tickets_page") || params.get("page") || "1");
        if (!isNaN(page) && page > 0) {
            this.tickets_start = (page - 1) * this.tickets_length;
        } else {
            this.tickets_start = 0;
        }

        this.filters.status = params.get("status") || "";
        this.filters.priority = params.get("priority") || "";
        this.search_query = params.get("search") || "";
    }

    update_url(push = false) {
        let params = new URLSearchParams(window.location.search);
        params.set("view", this.view_type);

        let page = Math.floor(this.tickets_start / this.tickets_length) + 1;
        if (page > 1) {
            params.set("tickets_page", page);
        } else {
            params.delete("tickets_page");
            params.delete("page");
        }

        if (this.filters.status) params.set("status", this.filters.status); else params.delete("status");
        if (this.filters.priority) params.set("priority", this.filters.priority); else params.delete("priority");
        if (this.search_query) params.set("search", this.search_query); else params.delete("search");

        let queryString = params.toString();
        let newUrl = window.location.pathname + (queryString ? "?" + queryString : "") + window.location.hash;

        if (newUrl !== (window.location.pathname + window.location.search + window.location.hash)) {
            if (push) {
                history.pushState({ tickets_start: this.tickets_start }, "", newUrl);
            } else {
                history.replaceState({ tickets_start: this.tickets_start }, "", newUrl);
            }
        }
    }

    sync_ui_from_state() {
        if (!this.wrapper) return;
        this.wrapper.find(".tp-view-btn").removeClass("active");
        this.wrapper.find(`.tp-view-btn[data-view="${this.view_type}"]`).addClass("active");

        this.wrapper.find("#tp-filter-status").val(this.filters.status || "");
        this.wrapper.find("#tp-filter-priority").val(this.filters.priority || "");
        this.wrapper.find("#tp-ticket-search").val(this.search_query || "");
    }

    bind_popstate() {
        let self = this;
        $(window).off("popstate.tech_portal").on("popstate.tech_portal", function () {
            if (!self.wrapper || !$.contains(document.documentElement, self.wrapper[0])) {
                $(window).off("popstate.tech_portal");
                return;
            }
            self.read_url_params();
            self.sync_ui_from_state();
            self.render_view_structure();
            self.load_data();
        });
    }

    reset_pagination() {
        this.tickets_start = 0;
        this.update_url(false);
    }

    fetch_user_fullname() {
        let self = this;
        frappe.call({
            method: 'frappe.client.get_value',
            args: {
                doctype: 'User',
                filters: { name: frappe.session.user },
                fieldname: 'full_name'
            },
            callback: function (r) {
                if (r.message && r.message.full_name) {
                    self.current_user_fullname = r.message.full_name;
                    self.wrapper.find("#tp-welcome-user").text(self.current_user_fullname);
                }
            }
        });
    }
    fetch_day_attendance_status() {
        let self = this;
        frappe.call({
            method: "vin_chakra.technician_api.get_day_attendance_status",
            callback: function (r) {
                if (r.message && r.message.status === "success") {
                    let btn = self.wrapper.find("#tp-day-attendance-btn");
                    btn.show();
                    if (r.message.state === "IN") {
                        btn.html('<i class="fa fa-sign-out"></i> Day Check-out');
                        btn.css({ "background": "#fee2e2", "color": "#b91c1c" });
                        btn.data("action", "OUT");
                    } else {
                        btn.html('<i class="fa fa-sign-in"></i> Day Check-in');
                        btn.css({ "background": "#dcfce7", "color": "#15803d" });
                        btn.data("action", "IN");
                    }
                    btn.prop("disabled", false);
                }
            }
        });
    }

    handle_day_attendance_click() {
        let self = this;
        let btn = self.wrapper.find("#tp-day-attendance-btn");
        let action = btn.data("action");

        if (!action) return;

        btn.prop("disabled", true).html('<i class="fa fa-spinner fa-spin"></i> Processing...');

        getLocationSafe().then(coords => {
            frappe.call({
                method: "vin_chakra.technician_api.mark_day_attendance",
                args: {
                    log_type: action,
                    latitude: coords.lat,
                    longitude: coords.lng,
                    accuracy: coords.accuracy
                },
                callback: function (res) {
                    if (res.message && res.message.status === "success") {
                        frappe.show_alert({ message: res.message.message, indicator: "green" });
                    } else {
                        frappe.msgprint(res.message ? res.message.message : "Error marking attendance.");
                    }
                    self.fetch_day_attendance_status();
                },
                error: function () {
                    self.fetch_day_attendance_status();
                }
            });
        }).catch(err => {
            btn.prop("disabled", false);
            self.fetch_day_attendance_status();
            frappe.msgprint(err.message);
        });
    }

    render_skeleton() {
        this.page.main.addClass("tp-portal");

        this.wrapper.find(".layout-main-section").html(`
            <div class="tp-container">
                <!-- Welcome Banner -->
                <div class="tp-welcome-banner">
                    <div>
                        <h2>Technician Service Portal</h2>
                        <p>Welcome back, <strong id="tp-welcome-user">${this.current_user_fullname}</strong></p>
                    </div>
                    <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 8px;">
                        <span class="badge" style="background: rgba(255,255,255,0.2); color:white; font-size:11px; font-weight:700; padding:6px 12px; border-radius:30px;"><i class="fa fa-circle text-success" style="margin-right:6px;"></i>Active Status</span>
                        <div style="display: flex; gap: 8px; align-items: center;">
                            <button id="tp-hrms-btn" class="btn btn-sm" style="background: white; color: var(--tp-primary); font-weight: bold; border-radius: 20px; padding: 4px 12px; border: none; box-shadow: 0 2px 4px rgba(0,0,0,0.1); cursor: pointer;">
                                <i class="fa fa-users" style="margin-right: 4px;"></i> HRMS
                            </button>
                            <button id="tp-day-attendance-btn" class="btn btn-sm" style="background: white; color: var(--tp-primary); font-weight: bold; border-radius: 20px; padding: 4px 12px; display: none; box-shadow: 0 2px 4px rgba(0,0,0,0.1); border: none;">
                                <i class="fa fa-sign-in"></i> Day Check-in
                            </button>
                        </div>
                    </div>
                </div>
                
                <!-- Filters Bar -->
                <div class="tp-filter-bar">
                    <div style="display:flex; gap:12px; align-items:center; flex-wrap:wrap; flex:1;">
                        <div class="tp-search-input-wrap">
                            <i class="fa fa-search"></i>
                            <input type="text" id="tp-ticket-search" placeholder="Search ticket, customer..." value="${this.search_query}">
                        </div>
                        <button class="tp-filter-btn" id="tp-btn-filter-toggle">
                            <i class="fa fa-filter"></i> Filters
                        </button>
                    </div>
                    
                    <div class="tp-view-selector">
                        <button class="tp-filter-btn" id="tp-btn-expense-claim">
                            <i class="fa fa-money"></i> Expense Claim
                        </button>
                        <button class="tp-view-btn ${this.view_type === 'card' ? 'active' : ''}" data-view="card"><i class="fa fa-th"></i> Card</button>
                        <button class="tp-view-btn ${this.view_type === 'list' ? 'active' : ''}" data-view="list"><i class="fa fa-list"></i> List</button>
                        <button class="tp-view-btn ${this.view_type === 'calendar' ? 'active' : ''}" data-view="calendar"><i class="fa fa-calendar"></i> Calendar</button>
                    </div>
                </div>
                
                <!-- Filters Dropdowns -->
                <div class="tp-filters-panel" id="tp-filters-panel" style="display: none;">
                    <div class="tp-filter-item">
                        <label>Status</label>
                        <select id="tp-filter-status">
                            <option value="">All Statuses</option>
                            <option value="Open">Open</option>
                            <option value="Working">Working</option>
                            <option value="Pending">Pending</option>
                            <option value="Resolved">Resolved</option>
                            <option value="Closed">Closed</option>
                        </select>
                    </div>
                    <div class="tp-filter-item">
                        <label>Priority</label>
                        <select id="tp-filter-priority">
                            <option value="">All Priorities</option>
                            <option value="Low">Low</option>
                            <option value="Medium">Medium</option>
                            <option value="High">High</option>
                            <option value="Urgent">Urgent</option>
                        </select>
                    </div>
                </div>
                
                <!-- Active Filters -->
                <div class="tp-active-filters" id="tp-active-filters"></div>
                
                <!-- Summary Cards Row -->
                <div class="tp-summary-row">
                    <div class="tp-summary-card" data-status="" style="border-top-color: #64748b; cursor: pointer;">
                        <div class="tp-summary-val" id="tp-summary-total">-</div>
                        <div class="tp-summary-label">Total Tickets</div>
                    </div>
                    <div class="tp-summary-card" data-status="Open" style="border-top-color: #64748b; cursor: pointer;">
                        <div class="tp-summary-val" id="tp-summary-open">-</div>
                        <div class="tp-summary-label">Open</div>
                    </div>
                    <div class="tp-summary-card" data-status="Working" style="border-top-color: #0369a1; cursor: pointer;">
                        <div class="tp-summary-val" id="tp-summary-working">-</div>
                        <div class="tp-summary-label">Working</div>
                    </div>
                    <div class="tp-summary-card" data-status="Pending" style="border-top-color: #d97706; cursor: pointer;">
                        <div class="tp-summary-val" id="tp-summary-pending">-</div>
                        <div class="tp-summary-label">Pending</div>
                    </div>
                    <div class="tp-summary-card" data-status="Resolved" style="border-top-color: #15803d; cursor: pointer;">
                        <div class="tp-summary-val" id="tp-summary-resolved">-</div>
                        <div class="tp-summary-label">Resolved</div>
                    </div>
                </div>
                
                <!-- Tickets view container -->
                <div class="tp-loader" id="tp-loader" style="display: none;"></div>
                <div id="tp-view-content">
                    <div id="tp-tickets-container"></div>
                    <div class="tp-pagination" id="tp-tickets-pagination"></div>
                </div>
            </div>
        `);

        this.render_view_structure();
    }

    render_view_structure() {
        let content = this.wrapper.find("#tp-view-content");
        if (this.view_type === "calendar") {
            content.html(`
                <div id="tp-tickets-container"></div>
            `);
        } else {
            content.html(`
                <div id="tp-tickets-container"></div>
                <div class="tp-pagination" id="tp-tickets-pagination"></div>
            `);
        }
    }

    bind_events() {
        let self = this;

        // HRMS Redirect
        this.wrapper.on("click", "#tp-hrms-btn", function () {
            window.location.href = "/hrms";
        });

        // Day Attendance
        this.wrapper.on("click", "#tp-day-attendance-btn", function () {
            self.handle_day_attendance_click();
        });
        this.wrapper.on("click", "#tp-btn-expense-claim", function () {
            self.open_expense_claim_dialog();
        });
        // Toggle Filters
        this.wrapper.on("click", "#tp-btn-filter-toggle", function () {
            $(this).toggleClass("active");
            self.wrapper.find("#tp-filters-panel").slideToggle(200);
        });

        // Filters Change
        this.wrapper.on("change", "#tp-filter-status", function () {
            self.filters.status = $(this).val();
            self.reset_pagination();
            self.load_data();
        });

        this.wrapper.on("change", "#tp-filter-priority", function () {
            self.filters.priority = $(this).val();
            self.reset_pagination();
            self.load_data();
        });

        // Search Input Debounce
        this.wrapper.on("input", "#tp-ticket-search", function () {
            clearTimeout(self.debounce_timer);
            self.debounce_timer = setTimeout(() => {
                self.search_query = $(this).val();
                self.reset_pagination();
                self.load_data();
            }, 400);
        });

        // Toggle view types
        this.wrapper.on("click", ".tp-view-btn", function () {
            let view = $(this).data("view");
            self.wrapper.find(".tp-view-btn").removeClass("active");
            $(this).addClass("active");
            self.view_type = view;
            localStorage.setItem("tp_portal_view_type", view);
            self.update_url(false);
            self.render_view_structure();
            self.load_data();
        });

        // Pagination Buttons
        this.wrapper.on("click", "#tp-tickets-pagination .tp-page-btn", function () {
            let action = $(this).data("action");
            if (action === "prev" && self.tickets_start > 0) {
                self.tickets_start -= self.tickets_length;
            } else if (action === "next" && (self.tickets_start + self.tickets_length) < self.tickets_total) {
                self.tickets_start += self.tickets_length;
            }
            self.update_url(true);
            self.load_data();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });

        // Calendar navigation
        this.wrapper.on("click", ".tp-cal-prev", function () {
            self.calendar_date.setMonth(self.calendar_date.getMonth() - 1);
            self.load_data();
        });
        this.wrapper.on("click", ".tp-cal-next", function () {
            self.calendar_date.setMonth(self.calendar_date.getMonth() + 1);
            self.load_data();
        });

        // Clicking Ticket cards/rows
        this.wrapper.on("click", ".tp-ticket-card, .tp-ticket-list-row", function (e) {
            if ($(e.target).closest(".tp-btn-create-invoice, .tp-btn-send-invoice").length) {
                return;
            }
            let ticket_name = $(this).data("name");
            if (ticket_name) {
                self.open_ticket_details(ticket_name);
            }
        });

        // Create or View Invoice Button Click
        this.wrapper.on("click", ".tp-btn-create-invoice", function (e) {
            e.stopPropagation();
            e.preventDefault();
            let invoice = $(this).data("invoice");
            if (invoice) {
                frappe.set_route("Form", "Sales Invoice", invoice);
                return;
            }
            let ticket_name = $(this).data("name");
            let customer = $(this).data("customer");
            let phone = $(this).data("phone");
            self.create_invoice(ticket_name, customer, phone);
        });

        // Send Invoice via WhatsApp Button Click
        this.wrapper.on("click", ".tp-btn-send-invoice", function (e) {
            e.stopPropagation();
            e.preventDefault();
            let ticket_name = $(this).data("ticket");
            let invoice_name = $(this).data("invoice");
            let customer = $(this).data("customer");
            let phone = $(this).data("phone");
            self.send_invoice_whatsapp(ticket_name, invoice_name, customer, phone);
        });

        // Quick filter pill remove
        this.wrapper.on("click", ".tp-pill-remove", function () {
            let filter = $(this).data("filter");
            if (filter === "status") {
                self.filters.status = "";
                self.wrapper.find("#tp-filter-status").val("");
            } else if (filter === "priority") {
                self.filters.priority = "";
                self.wrapper.find("#tp-filter-priority").val("");
            }
            self.reset_pagination();
            self.load_data();
        });

        // Summary Cards click filter
        this.wrapper.on("click", ".tp-summary-card", function () {
            let status = $(this).data("status");
            self.filters.status = status;
            self.wrapper.find("#tp-filter-status").val(status);
            self.reset_pagination();
            self.load_data();
        });
    }

    render_active_filters() {
        let container = this.wrapper.find("#tp-active-filters").empty();

        // Sync active class on summary cards
        let current_status = this.filters.status || "";
        this.wrapper.find(".tp-summary-card").removeClass("active");
        this.wrapper.find(`.tp-summary-card[data-status="${current_status}"]`).addClass("active");

        if (this.filters.status) {
            container.append(`
                <span class="tp-filter-pill">Status: ${this.filters.status} <i class="fa fa-times tp-pill-remove" data-filter="status"></i></span>
            `);
        }

        if (this.filters.priority) {
            container.append(`
                <span class="tp-filter-pill">Priority: ${this.filters.priority} <i class="fa fa-times tp-pill-remove" data-filter="priority"></i></span>
            `);
        }
    }

    load_data() {
        let self = this;
        this.render_active_filters();
        this.wrapper.find("#tp-loader").show();

        let limit_start = this.tickets_start;
        let limit_len = this.tickets_length;

        if (this.view_type === "calendar") {
            limit_start = 0;
            limit_len = 1000;
        }

        frappe.call({
            method: "vin_chakra.vin_chakra.page.technician_portal.technician_portal.get_portal_data",
            args: {
                status: this.filters.status,
                priority: this.filters.priority,
                search_query: this.search_query,
                limit_start: limit_start,
                limit_page_length: limit_len,
                view: this.view_type
            },
            callback: function (r) {
                self.wrapper.find("#tp-loader").hide();
                if (r.message) {
                    let data = r.message;
                    self.tickets_total = data.total_count;

                    self.update_summary_row(data.summary);

                    if (self.view_type === "card") {
                        self.render_ticket_cards(data.tickets);
                        self.render_tickets_pagination();
                    } else if (self.view_type === "list") {
                        self.render_ticket_list(data.tickets);
                        self.render_tickets_pagination();
                    } else if (self.view_type === "calendar") {
                        self.render_ticket_calendar(data.tickets);
                    }
                }
            }
        });
    }

    update_summary_row(summary) {
        this.wrapper.find("#tp-summary-total").text(summary.Total);
        this.wrapper.find("#tp-summary-open").text(summary.Open);
        this.wrapper.find("#tp-summary-working").text(summary.Working);
        this.wrapper.find("#tp-summary-pending").text(summary.Pending);
        this.wrapper.find("#tp-summary-resolved").text(summary.Resolved);
    }

    render_ticket_cards(tickets) {
        let container = this.wrapper.find("#tp-tickets-container");
        if (!tickets || tickets.length === 0) {
            container.html(`
                <div class="tp-empty-state">
                    <i class="fa fa-ticket"></i>
                    <h3>No tickets assigned</h3>
                    <p>Try adjusting your filters or search query.</p>
                </div>
            `);
            return;
        }

        let html = tickets.map(t => {
            let status_badge = `<span class="tp-badge tp-badge-status-${t.status.replace(/\s+/g, '')}">${t.status}</span>`;
            let priority_badge = `<span class="tp-badge tp-badge-priority-${t.priority}">${t.priority}</span>`;
            let customer = t.custom_customer_name || t.customer || 'N/A';
            let address = [t.custom_address, t.custom_city__district_].filter(Boolean).join(', ') || 'N/A';
            let date_str = t.custom_date ? frappe.datetime.global_date_format(t.custom_date) : 'N/A';
            let machine_display = (t.custom_machine_type_list && t.custom_machine_type_list.length > 0)
                ? t.custom_machine_type_list.map(m => m.machine_name || m.machine_type).filter(Boolean).join(', ')
                : (t.custom_machine_name || 'N/A');

            let is_resolved = t.status && t.status.trim().toLowerCase() === 'resolved';
            let phone = t.primary_phone || t.custom_customer_mobile_number || t.custom__secondary_phone_number || '';
            let invoice_btn = '';
            if (is_resolved) {
                if (t.sales_invoice) {
                    invoice_btn = `
                        <div style="margin-top: 10px; border-top: 1px solid #f1f5f9; padding-top: 10px; display: flex; gap: 8px;">
                            <button class="btn btn-xs btn-outline-secondary tp-btn-create-invoice" data-name="${t.name}" data-customer="${t.customer || t.custom_customer_name || ''}" data-phone="${phone}" data-invoice="${t.sales_invoice.name}" style="flex:1; border-radius: 6px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 4px; padding: 6px 8px;" title="View Sales Invoice">
                                <i class="fa fa-file-text-o"></i> ${t.sales_invoice.name}
                            </button>
                            <button class="btn btn-xs tp-btn-send-invoice" data-ticket="${t.name}" data-invoice="${t.sales_invoice.name}" data-customer="${t.customer || t.custom_customer_name || ''}" data-phone="${phone}" style="flex:1; border-radius: 6px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 4px; padding: 6px 8px; background-color: #25D366; border-color: #25D366; color: white;" title="Send Invoice via WhatsApp">
                                <i class="fa fa-whatsapp"></i> Send Invoice
                            </button>
                        </div>
                    `;
                } else if (this.can_create_invoice(t)) {
                    invoice_btn = `
                        <div style="margin-top: 10px; border-top: 1px solid #f1f5f9; padding-top: 10px;">
                            <button class="btn btn-xs btn-success tp-btn-create-invoice" data-name="${t.name}" data-customer="${t.customer || t.custom_customer_name || ''}" data-phone="${phone}" style="width: 100%; border-radius: 6px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 6px 12px; background-color: #10b981; border-color: #10b981; color: white;">
                                <i class="fa fa-file-text-o"></i> Create Invoice
                            </button>
                        </div>
                    `;
                }
            }

            return `
                <div class="tp-ticket-card" data-name="${t.name}">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span class="tp-ticket-id">${t.name}</span>
                        <div class="tp-card-badges">${status_badge}${priority_badge}</div>
                    </div>
                    <h3 class="tp-ticket-subject">${t.subject}</h3>
                    
                    <div class="tp-card-meta">
                        <div><i class="fa fa-user"></i> <span>Customer: <strong>${customer}</strong></span></div>
                        <div><i class="fa fa-map-marker"></i> <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:85%;" title="${address}">Loc: ${address}</span></div>
                        <div><i class="fa fa-cogs"></i> <span>Machine: ${machine_display}</span></div>
                        ${t.custom_required_spares ? `<div><i class="fa fa-wrench"></i> <span>Required Spares: ${t.custom_required_spares}</span></div>` : ''}
                        <div><i class="fa fa-calendar"></i> <span>Date: ${date_str}</span></div>
                        ${t.custom_branch ? `<div><i class="fa fa-building-o"></i> <span>Branch: ${frappe.utils.escape_html(t.custom_branch)}</span></div>` : ''}
                    </div>
                    ${invoice_btn}
                </div>
            `;
        }).join("");

        container.removeClass("tp-tickets-list").addClass("tp-tickets-grid").html(html);
    }

    render_ticket_list(tickets) {
        let container = this.wrapper.find("#tp-tickets-container");
        if (!tickets || tickets.length === 0) {
            container.html(`
                <div class="tp-empty-state">
                    <i class="fa fa-ticket"></i>
                    <h3>No tickets assigned</h3>
                    <p>Try adjusting your filters or search query.</p>
                </div>
            `);
            return;
        }

        let html = tickets.map(t => {
            let status_badge = `<span class="tp-badge tp-badge-status-${t.status.replace(/\s+/g, '')}">${t.status}</span>`;
            let priority_badge = `<span class="tp-badge tp-badge-priority-${t.priority}">${t.priority}</span>`;
            let customer = t.custom_customer_name || t.customer || 'N/A';
            let address = [t.custom_address, t.custom_city__district_].filter(Boolean).join(', ') || 'N/A';
            let is_resolved = t.status && t.status.trim().toLowerCase() === 'resolved';
            let phone = t.primary_phone || t.custom_customer_mobile_number || t.custom__secondary_phone_number || '';
            let invoice_btn = '';
            if (is_resolved) {
                if (t.sales_invoice) {
                    invoice_btn = `
                        <div class="tp-list-action-col" style="flex-shrink:0; display:flex; gap:6px;">
                            <button class="btn btn-xs btn-outline-secondary tp-btn-create-invoice" data-name="${t.name}" data-customer="${t.customer || t.custom_customer_name || ''}" data-phone="${phone}" data-invoice="${t.sales_invoice.name}" style="border-radius:6px; font-weight:700; display: flex; align-items: center; gap: 4px; padding: 5px 8px;" title="View Sales Invoice">
                                <i class="fa fa-file-text-o"></i> ${t.sales_invoice.name}
                            </button>
                            <button class="btn btn-xs tp-btn-send-invoice" data-ticket="${t.name}" data-invoice="${t.sales_invoice.name}" data-customer="${t.customer || t.custom_customer_name || ''}" data-phone="${phone}" style="border-radius:6px; font-weight:700; display: flex; align-items: center; gap: 4px; padding: 5px 10px; background-color: #25D366; border-color: #25D366; color: white;" title="Send Invoice via WhatsApp">
                                <i class="fa fa-whatsapp"></i> Send Invoice
                            </button>
                        </div>
                    `;
                } else if (this.can_create_invoice(t)) {
                    invoice_btn = `
                        <div class="tp-list-action-col" style="flex-shrink:0;">
                            <button class="btn btn-xs btn-success tp-btn-create-invoice" data-name="${t.name}" data-customer="${t.customer || t.custom_customer_name || ''}" data-phone="${phone}" style="border-radius:6px; font-weight:700; display: flex; align-items: center; gap: 4px; padding: 5px 10px; background-color: #10b981; border-color: #10b981; color: white;">
                                <i class="fa fa-file-text-o"></i> Create Invoice
                            </button>
                        </div>
                    `;
                }
            }

            return `
                <div class="tp-ticket-list-row" data-name="${t.name}">
                    <div class="tp-list-subject-col">
                        <span class="tp-ticket-id">${t.name}</span>
                        <h3 class="tp-ticket-subject" style="margin: 0; font-size:14px;">${t.subject}</h3>
                    </div>
                    <div class="tp-list-badges-col">
                        ${status_badge}
                        ${priority_badge}
                    </div>
                    <div class="tp-list-meta-col">
                        <div><strong>Cust:</strong> ${customer}</div>
                        <div><strong>Loc:</strong> <span style="display:inline-block; max-width:180px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; vertical-align:bottom;">${address}</span></div>
                        ${t.custom_required_spares ? `<div><strong>Spares:</strong> ${t.custom_required_spares}</div>` : ''}
                        ${t.custom_branch ? `<div><strong>Branch:</strong> ${frappe.utils.escape_html(t.custom_branch)}</div>` : ''}
                    </div>
                    ${invoice_btn}
                </div>
            `;
        }).join("");

        container.removeClass("tp-tickets-grid").addClass("tp-tickets-list").html(html);
    }

    render_ticket_calendar(tickets) {
        let container = this.wrapper.find("#tp-tickets-container");
        container.removeClass("tp-tickets-grid tp-tickets-list");

        let month = this.calendar_date.getMonth();
        let year = this.calendar_date.getFullYear();
        let firstDay = new Date(year, month, 1).getDay();
        let daysInMonth = new Date(year, month + 1, 0).getDate();

        let html = `
            <div class="tp-calendar-wrapper" style="background: white; border: 1px solid var(--tp-border); border-radius: var(--tp-radius); padding: 20px; box-shadow: var(--tp-shadow-sm); overflow-x: auto;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 20px; align-items: center;">
                    <button class="btn btn-default btn-sm tp-cal-prev"><i class="fa fa-chevron-left"></i> Prev</button>
                    <h3 style="margin: 0; font-size: 16px; font-weight:700;"><i class="fa fa-calendar" style="color: var(--tp-primary); margin-right: 8px;"></i>${this.calendar_date.toLocaleString('default', { month: 'long' })} ${year}</h3>
                    <button class="btn btn-default btn-sm tp-cal-next">Next <i class="fa fa-chevron-right"></i></button>
                </div>
                <table class="table table-bordered" style="width: 100%; table-layout: fixed; border-collapse: collapse; margin-bottom:0;">
                    <thead><tr>
                        <th style="text-align: center; padding: 8px; background: #f9fafb; font-weight:700;">Sun</th>
                        <th style="text-align: center; padding: 8px; background: #f9fafb; font-weight:700;">Mon</th>
                        <th style="text-align: center; padding: 8px; background: #f9fafb; font-weight:700;">Tue</th>
                        <th style="text-align: center; padding: 8px; background: #f9fafb; font-weight:700;">Wed</th>
                        <th style="text-align: center; padding: 8px; background: #f9fafb; font-weight:700;">Thu</th>
                        <th style="text-align: center; padding: 8px; background: #f9fafb; font-weight:700;">Fri</th>
                        <th style="text-align: center; padding: 8px; background: #f9fafb; font-weight:700;">Sat</th>
                    </tr></thead>
                    <tbody><tr>
        `;

        let ticketsByDate = {};
        tickets.forEach(t => {
            let d_str = t.custom_date || t.creation;
            if (d_str) {
                let d_obj = new Date(d_str);
                if (d_obj.getMonth() === month && d_obj.getFullYear() === year) {
                    let day = d_obj.getDate();
                    if (!ticketsByDate[day]) ticketsByDate[day] = [];
                    ticketsByDate[day].push(t);
                }
            }
        });

        let d = 1;
        for (let i = 0; i < 42; i++) {
            if (i % 7 === 0 && i > 0) {
                if (d > daysInMonth) break;
                html += `</tr><tr>`;
            }
            if (i < firstDay || d > daysInMonth) {
                html += `<td style="height: 90px; background: #f9fafb; border: 1px solid #e2e8f0;"></td>`;
            } else {
                let currentDay = d;
                let day_tickets = ticketsByDate[currentDay] || [];
                let tickets_html = day_tickets.map(t => {
                    let is_res = t.status && t.status.trim().toLowerCase() === 'resolved';
                    let phone = t.primary_phone || t.custom_customer_mobile_number || t.custom__secondary_phone_number || '';
                    let cal_inv_btn = is_res && this.can_create_invoice(t) ? `
                        <button class="btn btn-xs btn-success tp-btn-create-invoice" data-name="${t.name}" data-customer="${t.customer || t.custom_customer_name || ''}" data-phone="${phone}" style="font-size: 10px; padding: 1px 4px; margin-top: 2px; width: 100%; border-radius: 3px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 3px; background-color: #10b981; border-color: #10b981; color: white;" title="Create Invoice">
                            <i class="fa fa-file-text-o"></i> Create Invoice
                        </button>
                    ` : '';
                    return `
                        <div class="tp-cal-event" data-name="${t.name}" 
                             style="background: ${is_res ? '#f0fdf4' : 'var(--tp-primary-light)'}; color: ${is_res ? 'var(--tp-success)' : 'var(--tp-primary)'}; padding: 3px 6px; border-radius: 4px; font-size: 11px; margin-bottom: 4px; cursor: pointer; border: 1px solid ${is_res ? 'rgba(21, 128, 61, 0.3)' : 'rgba(99, 102, 241, 0.2)'}; font-weight:600;" 
                             title="${t.subject}">
                            <div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${t.subject}</div>
                            ${cal_inv_btn}
                        </div>
                    `;
                }).join("");

                html += `
                    <td style="height: 90px; vertical-align: top; position: relative; border: 1px solid #e2e8f0; padding: 6px;">
                        <div style="font-weight: 700; margin-bottom: 6px; font-size: 12px; color: var(--tp-text-muted); text-align: right;">${d}</div>
                        <div style="max-height: 60px; overflow-y: auto;">${tickets_html}</div>
                    </td>
                `;
                d++;
            }
        }

        html += `</tr></tbody></table></div>`;
        container.html(html);

        // Calendar Event Click
        let self = this;
        container.find(".tp-cal-event").on("click", function (e) {
            if ($(e.target).closest(".tp-btn-create-invoice").length) {
                return;
            }
            e.stopPropagation();
            let name = $(this).data("name");
            if (name) {
                self.open_ticket_details(name);
            }
        });
    }

    render_tickets_pagination() {
        let container = this.wrapper.find("#tp-tickets-pagination");
        if (this.tickets_total <= this.tickets_length) {
            container.empty();
            return;
        }

        let current_page = Math.floor(this.tickets_start / this.tickets_length) + 1;
        let total_pages = Math.ceil(this.tickets_total / this.tickets_length);

        container.html(`
            <button class="tp-page-btn" data-action="prev" ${current_page === 1 ? "disabled" : ""}>Previous</button>
            <span class="tp-page-info">Page ${current_page} of ${total_pages}</span>
            <button class="tp-page-btn" data-action="next" ${current_page === total_pages ? "disabled" : ""}>Next</button>
        `);
    }

    // --- Detailed View Dialog Modal ---
    open_ticket_details(ticket_name) {
        let self = this;
        frappe.call({
            method: "vin_chakra.technician_api.get_ticket_detail",
            args: { ticket_name: ticket_name },
            callback: function (r) {
                if (r.message) {
                    self.show_ticket_detail_dialog(r.message);
                }
            }
        });
    }
    open_expense_claim_dialog() {
        new TechnicianExpenseClaim(this).show();
    }

    show_ticket_detail_dialog(t) {
        let self = this;
        let primary_phone = t.primary_phone || t.custom_customer_mobile_number || '';
        let sec_phones = t.secondary_phones || [];
        if (!sec_phones.length && (t.custom__secondary_phone_number || t.custom_secondary_phone_number)) {
            sec_phones = [t.custom__secondary_phone_number || t.custom_secondary_phone_number];
        }
        function clean10(p) {
            if (!p) return '';
            let d = String(p).replace(/\D/g, '');
            if (d.length === 12 && d.startsWith('91')) return d.slice(2);
            if (d.length === 11 && d.startsWith('0')) return d.slice(1);
            return d.slice(-10);
        }
        let primClean = clean10(primary_phone);
        let seenSec = new Set();
        sec_phones = sec_phones.filter(p => {
            let c = clean10(p);
            if (!c || c === primClean || seenSec.has(c)) return false;
            seenSec.add(c);
            return true;
        });
        let address = [t.custom_address, t.custom_city__district_, t.custom_state].filter(Boolean).join(', ') || '-';
        let date_str = t.custom_date ? frappe.datetime.global_date_format(t.custom_date) : '-';

        let status_badge = `<span class="tp-badge tp-badge-status-${t.status.replace(/\s+/g, '')}">${t.status}</span>`;
        let priority_badge = `<span class="tp-badge tp-badge-priority-${t.priority}">${t.priority}</span>`;

        let dialog = new frappe.ui.Dialog({
            title: `Ticket Details: ${t.name}`,
            size: "large",
            fields: [
                {
                    fieldtype: "HTML",
                    fieldname: "detail_html"
                }
            ]
        });
        dialog.onhide = () => {
            dialog.$wrapper.remove();
        };

        // Machine Type List Table Section
        let machine_type_list = t.custom_machine_type_list || [];
        let machine_table_rows = machine_type_list.map((m, idx) => {
            let m_name = m.machine_name || m.machine_type || '-';
            let m_brand = m.machine_brand || '-';
            let m_qty = m.machine_quantity || 1;
            let m_prob = m.machine_problem || '-';
            let m_scs = m.purchased_at_scs || '-';
            let m_year = m.purchase_year || '-';

            return `
                <tr>
                    <td style="text-align: center; font-weight: 600; color: var(--tp-text-muted);">${idx + 1}</td>
                    <td><strong style="color: var(--tp-text-main);">${m_name}</strong></td>
                    <td>${m_brand}</td>
                    <td style="text-align: center; font-weight: 600;">${m_qty}</td>
                    <td>${m_prob}</td>
                    <td style="text-align: center;">${m_scs}</td>
                    <td style="text-align: center;">${m_year}</td>
                </tr>
            `;
        }).join("");

        let machine_table_section = `
            <div class="tp-modal-section">
                <h4 style="display: flex; align-items: center; gap: 6px;"><i class="fa fa-wrench" style="color: var(--tp-primary);"></i> Machine Type List</h4>
                ${machine_type_list.length > 0 ? `
                    <div style="overflow-x: auto; border: 1px solid var(--tp-border); border-radius: 8px; background: white; box-shadow: var(--tp-shadow-sm);">
                        <table class="table table-bordered" style="width: 100%; margin-bottom: 0; font-size: 13px; border-collapse: collapse;">
                            <thead>
                                <tr style="background: #f8fafc; color: var(--tp-text-muted); text-align: left; font-size: 12px;">
                                    <th style="width: 40px; text-align: center;">#</th>
                                    <th>Machine</th>
                                    <th>Brand</th>
                                    <th style="width: 60px; text-align: center;">Qty</th>
                                    <th>Problem</th>
                                    <th style="text-align: center;">Purchased at SCS</th>
                                    <th style="text-align: center;">Year</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${machine_table_rows}
                            </tbody>
                        </table>
                    </div>
                ` : `
                    <div style="font-size: 13px; color: var(--tp-text-muted); background: #f8fafc; padding: 12px 16px; border-radius: 8px; border: 1px solid var(--tp-border); text-align: center;">
                        <i class="fa fa-info-circle" style="margin-right: 4px;"></i> No machine details listed for this ticket.
                    </div>
                `}
            </div>
        `;

        // Build the HTML template for details, service action workflow, and activity timeline
        let html_content = `
            <div class="tp-modal-header">
                <div>
                    <h3 style="margin: 0; font-size: 16px; font-weight: 700; color: var(--tp-text-main);">${t.subject}</h3>
                </div>
                <div style="display: flex; gap: 8px;">
                    ${status_badge}
                    ${priority_badge}
                </div>
            </div>
            
            <div class="tp-modal-section">
                <h4>Customer Information</h4>
                <div class="tp-modal-meta-grid">
                    <div class="tp-meta-item">
                        <span class="tp-meta-label">Customer Name</span>
                        <span class="tp-meta-value">${t.custom_customer_name || t.customer || '-'}</span>
                    </div>
                    <div class="tp-meta-item">
                        <span class="tp-meta-label">Primary Mobile (Row 1)</span>
                        <span class="tp-meta-value">
                            ${primary_phone ? `<a href="tel:${primary_phone.replace(/[^\d+]/g, '')}" style="color: var(--tp-primary); text-decoration: none; font-weight: 700;"><i class="fa fa-phone"></i> ${primary_phone}</a>` : '-'}
                        </span>
                    </div>
                    <div class="tp-meta-item">
                        <span class="tp-meta-label">Secondary Mobile</span>
                        <span class="tp-meta-value">
                            ${sec_phones.length > 0 ? sec_phones.map(p => `<a href="tel:${p.replace(/[^\d+]/g, '')}" style="color: var(--tp-primary); text-decoration: none; font-weight: 700;"><i class="fa fa-phone"></i> ${p}</a>`).join(', ') : '-'}
                        </span>
                    </div>
                    <div class="tp-meta-item">
                        <span class="tp-meta-label">Site Address</span>
                        <span class="tp-meta-value">${address}</span>
                    </div>
                    <div class="tp-meta-item">
                        <span class="tp-meta-label">Required Spares</span>
                        <span class="tp-meta-value">${t.custom_required_spares || '-'}</span>
                    </div>
                    <div class="tp-meta-item">
                        <span class="tp-meta-label">Scheduled Date</span>
                        <span class="tp-meta-value">${date_str}</span>
                    </div>
                    <div class="tp-meta-item">
                        <span class="tp-meta-label">Branch</span>
                        <span class="tp-meta-value">${t.custom_branch ? frappe.utils.escape_html(t.custom_branch) : '-'}</span>
                    </div>
                </div>
            </div>

            ${machine_table_section}
            
            ${t.description ? `
                <div class="tp-modal-section">
                    <h4>Description</h4>
                    <div style="font-size: 13px; line-height: 1.5; color: var(--tp-text-muted); background: white; padding: 10px; border-radius: 6px; border: 1px solid var(--tp-border); max-height: 120px; overflow-y: auto;">
                        ${t.description}
                    </div>
                </div>
            ` : ""}
            
            <!-- Service Workflow Action Section -->
            <div class="tp-modal-section" style="padding: 0; overflow: hidden; border: none;">
                <div class="tp-action-container" id="tp-dialog-action-box">
                    <!-- Dynamic state actions rendered here -->
                </div>
            </div>
            
            <!-- Timeline Logs -->
            <div class="tp-modal-section" id="tp-dialog-timeline-section" style="display: none;">
                <h4>Check Log Timeline</h4>
                <div class="tp-timeline" id="tp-dialog-timeline-logs">
                    <!-- Logs timeline rows rendered here -->
                </div>
            </div>
        `;

        dialog.get_field("detail_html").$wrapper.html(html_content);

        // Helper to prompt Phone Selection and trigger Checkin or Resend OTP
        function trigger_checkin_flow(ticket_doc, is_resend = false) {
            let primary_phone = ticket_doc.primary_phone || ticket_doc.custom_customer_mobile_number || "";
            let secondary_phones = ticket_doc.secondary_phones || [];
            if (!secondary_phones.length && (ticket_doc.custom__secondary_phone_number || ticket_doc.custom_secondary_phone_number)) {
                secondary_phones = [ticket_doc.custom__secondary_phone_number || ticket_doc.custom_secondary_phone_number];
            }
            function clean10(p) {
                if (!p) return '';
                let d = String(p).replace(/\D/g, '');
                if (d.length === 12 && d.startsWith('91')) return d.slice(2);
                if (d.length === 11 && d.startsWith('0')) return d.slice(1);
                return d.slice(-10);
            }
            let primClean = clean10(primary_phone);
            let seenSec = new Set();
            secondary_phones = secondary_phones.filter(p => {
                let c = clean10(p);
                if (!c || c === primClean || seenSec.has(c)) return false;
                seenSec.add(c);
                return true;
            });

            let title_text = is_resend ? `Resend Service OTP: ${ticket_doc.name}` : `Ticket Check-In & OTP Dispatch: ${ticket_doc.name}`;
            let prompt_text = is_resend ? `Select which mobile number to resend the Service OTP SMS to:` : `Select which mobile number to send the Service OTP SMS to upon check-in:`;
            let btn_text = is_resend ? `<i class="fa fa-paper-plane"></i> Resend OTP` : `<i class="fa fa-paper-plane"></i> Confirm Check-In & Send OTP`;

            let checkin_dialog = new frappe.ui.Dialog({
                title: title_text,
                fields: [
                    {
                        fieldtype: "HTML",
                        fieldname: "phone_select_html"
                    }
                ]
            });
            checkin_dialog.onhide = () => {
                checkin_dialog.$wrapper.remove();
            };

            let secondary_cards_html = secondary_phones.map((phone_num, idx) => {
                return `
                    <div class="tp-phone-card" data-choice="secondary_list" data-phone="${phone_num}" style="margin-bottom: 10px; padding: 12px; border: 1px solid #e2e8f0; border-radius: 6px; background: #f8fafc; cursor: pointer;">
                        <label style="display: flex; align-items: center; gap: 8px; font-weight: 600; cursor: pointer; margin: 0;">
                            <input type="radio" name="otp_phone_choice" value="secondary_list" data-phone="${phone_num}">
                            Secondary Mobile (Row ${idx + 2}): <span style="color: var(--tp-primary); font-weight: 700;">${phone_num}</span>
                        </label>
                    </div>
                `;
            }).join("");

            let modal_html = `
                <div style="padding: 10px 0;">
                    <p style="font-size: 13px; color: var(--tp-text-muted); margin-bottom: 15px;">
                        ${prompt_text}
                    </p>
                    
                    <div class="tp-phone-card" data-choice="primary" data-phone="${primary_phone}" style="margin-bottom: 10px; padding: 12px; border: 1px solid #e2e8f0; border-radius: 6px; background: #f8fafc; cursor: pointer;">
                        <label style="display: flex; align-items: center; gap: 8px; font-weight: 600; cursor: pointer; margin: 0;">
                            <input type="radio" name="otp_phone_choice" value="primary" data-phone="${primary_phone}" checked>
                            Primary Mobile (Row 1): <span style="color: var(--tp-primary); font-weight: 700;">${primary_phone || 'Not Set'}</span>
                        </label>
                    </div>

                    ${secondary_cards_html}

                    <div class="tp-phone-card" data-choice="secondary_custom" style="margin-bottom: 18px; padding: 12px; border: 1px solid #e2e8f0; border-radius: 6px; background: #f8fafc; cursor: pointer;">
                        <label style="display: flex; align-items: center; gap: 8px; font-weight: 600; cursor: pointer; margin-bottom: 8px;">
                            <input type="radio" name="otp_phone_choice" value="secondary_custom">
                            Other Secondary Mobile Number
                        </label>
                        <input type="text" id="tp-sec-phone-input" class="form-control" style="font-size: 13px; margin-top: 6px;" placeholder="Enter secondary mobile number (+91-...)">
                    </div>

                    <button class="tp-btn tp-btn-success" id="tp-btn-confirm-checkin" style="width: 100%; justify-content: center; padding: 10px; font-size: 14px;">
                        ${btn_text}
                    </button>
                </div>
            `;

            checkin_dialog.get_field("phone_select_html").$wrapper.html(modal_html);

            let $dialog_wrap = checkin_dialog.$wrapper;

            $dialog_wrap.find(".tp-phone-card").on("click", function (e) {
                if ($(e.target).is("input[type='text']")) return;
                $(this).find("input[name='otp_phone_choice']").prop("checked", true);
            });

            $dialog_wrap.find("#tp-sec-phone-input").on("focus input click change", function (e) {
                e.stopPropagation();
                $dialog_wrap.find("input[name='otp_phone_choice'][value='secondary_custom']").prop("checked", true);
            });

            $dialog_wrap.find("#tp-btn-confirm-checkin").on("click", function () {
                let selected_radio = $dialog_wrap.find("input[name='otp_phone_choice']:checked");
                let choice_val = selected_radio.val() || "primary";
                let selected_phone_num = "";
                let phone_type = "primary";

                if (choice_val === "primary") {
                    phone_type = "primary";
                    selected_phone_num = selected_radio.data("phone") || primary_phone;
                } else if (choice_val === "secondary_list") {
                    phone_type = "secondary";
                    selected_phone_num = selected_radio.data("phone");
                } else if (choice_val === "secondary_custom") {
                    phone_type = "secondary";
                    selected_phone_num = $dialog_wrap.find("#tp-sec-phone-input").val().trim();
                }

                if (!selected_phone_num) {
                    frappe.show_alert({ message: __("Please select or enter a valid mobile number."), indicator: "red" });
                    return;
                }

                let btn = $(this);

                if (is_resend) {
                    btn.prop("disabled", true).html('<i class="fa fa-spinner fa-spin"></i> Resending OTP...');
                    frappe.call({
                        method: "vin_chakra.technician_api.resend_otp",
                        args: {
                            ticket_name: ticket_doc.name,
                            otp_phone_type: phone_type,
                            secondary_phone: selected_phone_num,
                            selected_phone: selected_phone_num
                        },
                        callback: function (res) {
                            btn.prop("disabled", false);
                            if (res.message && res.message.status === "success") {
                                frappe.show_alert({ message: res.message.message, indicator: "green" });
                                checkin_dialog.hide();
                            } else {
                                frappe.msgprint(res.message ? res.message.message : __("Error resending OTP."));
                                btn.html('<i class="fa fa-paper-plane"></i> Resend OTP');
                            }
                        }
                    });
                } else {
                    btn.prop("disabled", true).html('<i class="fa fa-spinner fa-spin"></i> Fetching GPS Coords...');

                    getLocationSafe().then(coords => {
                        btn.html('<i class="fa fa-spinner fa-spin"></i> Checking In & Sending OTP...');

                        frappe.call({
                            method: "vin_chakra.technician_api.technician_checkin",
                            args: {
                                ticket_name: ticket_doc.name,
                                latitude: coords.lat,
                                longitude: coords.lng,
                                accuracy: coords.accuracy,
                                otp_phone_type: phone_type,
                                secondary_phone: selected_phone_num,
                                selected_phone: selected_phone_num
                            },
                            callback: function (res) {
                                btn.prop("disabled", false);
                                if (res.message && res.message.status === "success") {
                                    frappe.show_alert({ message: res.message.message, indicator: "green" });
                                    checkin_dialog.hide();
                                    dialog.hide();
                                    self.load_data();
                                    self.open_ticket_details(ticket_doc.name);
                                } else {
                                    frappe.msgprint(res.message ? res.message.message : __("Error checking in."));
                                    btn.html('<i class="fa fa-paper-plane"></i> Confirm Check-In & Send OTP');
                                }
                            }
                        });
                    }).catch(err => {
                        btn.prop("disabled", false).html('<i class="fa fa-paper-plane"></i> Confirm Check-In & Send OTP');
                        frappe.msgprint(err.message);
                    });
                }
            });

            checkin_dialog.show();
        }

        // Timeline Renderer
        function render_timeline_logs(logs) {
            let container = dialog.wrapper.find("#tp-dialog-timeline-logs");
            let section = dialog.wrapper.find("#tp-dialog-timeline-section");

            if (!logs || logs.length === 0) {
                section.hide();
                return;
            }

            section.show();
            let html = logs.map(l => {
                let isOut = l.check_type === 'Check-out';
                let time_str = frappe.datetime.global_date_format(l.timestamp) + " " + l.timestamp.split(" ")[1].substring(0, 5);

                return `
                    <div class="tp-timeline-item">
                        <div class="tp-timeline-icon ${isOut ? 'tp-timeline-out' : 'tp-timeline-in'}">
                            ${isOut ? '<i class="fa fa-arrow-up"></i>' : '<i class="fa fa-arrow-down"></i>'}
                        </div>
                        <div class="tp-timeline-details">
                            <div class="tp-timeline-title">${l.check_type} (${l.technician})</div>
                            <div class="tp-timeline-time">${time_str}</div>
                            ${l.latitude ? `<div class="tp-timeline-time" style="color:var(--tp-primary);"><i class="fa fa-map-marker"></i> GPS: ${l.latitude.toFixed(5)}, ${l.longitude.toFixed(5)}</div>` : ""}
                        </div>
                    </div>
                `;
            }).join("");
            container.html(html);
        }

        // Render Active Service Actions
        function render_action_state(ticket) {
            let box = dialog.wrapper.find("#tp-dialog-action-box");
            box.removeClass("tp-action-working").empty();

            let last_log = ticket.check_log && ticket.check_log.length > 0 ? ticket.check_log[ticket.check_log.length - 1] : null;
            let has_active_check_in = last_log && last_log.check_type === 'Check-in';

            let is_resolved = ticket.status && ticket.status.trim().toLowerCase() === 'resolved';
            let is_closed = ticket.status && ticket.status.trim().toLowerCase() === 'closed';

            if (is_resolved || is_closed) {
                let inv = ticket.sales_invoice;
                let phone = ticket.custom_customer_mobile_number || ticket.primary_phone || ticket.custom__secondary_phone_number || '';
                let cust = ticket.customer || ticket.custom_customer_name || '';
                box.html(`
                    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; padding: 8px;">
                        <div style="color: var(--tp-success); font-weight: 700; font-size: 15px;">
                            <i class="fa fa-check-circle" style="font-size:18px; margin-right:6px; vertical-align:middle;"></i> Service Completed &amp; Checked Out
                        </div>
                        <div style="display:flex; gap:8px;">
                            ${inv ? `
                                <button class="btn btn-xs btn-outline-secondary tp-btn-create-invoice" data-name="${ticket.name}" data-customer="${cust}" data-phone="${phone}" data-invoice="${inv.name}" style="border-radius:6px; font-weight:700; padding:6px 12px;">
                                    <i class="fa fa-file-text-o"></i> Invoice (${inv.name})
                                </button>
                                <button class="btn btn-xs tp-btn-send-invoice" data-ticket="${ticket.name}" data-invoice="${inv.name}" data-customer="${cust}" data-phone="${phone}" style="border-radius:6px; font-weight:700; display:flex; align-items:center; gap:6px; padding:6px 12px; background-color:#25D366; border-color:#25D366; color:white;">
                                    <i class="fa fa-whatsapp"></i> Send Invoice
                                </button>
                            ` : self.can_create_invoice(ticket) ? `
                                <button class="btn btn-xs btn-success tp-btn-create-invoice" data-name="${ticket.name}" data-customer="${cust}" data-phone="${phone}" style="border-radius:6px; font-weight:700; padding:6px 12px; background-color:#10b981; border-color:#10b981; color:white;">
                                    <i class="fa fa-file-text-o"></i> Create Invoice
                                </button>
                            ` : ''}
                        </div>
                    </div>
                `);
            } else if (has_active_check_in || ticket.status === 'Working') {
                box.addClass("tp-action-working").html(`
                    <h4 style="margin:0 0 6px 0; color:var(--tp-primary-dark); font-size:14px; font-weight:700;">Active Session: Working</h4>
                    <p style="font-size:12px; color:var(--tp-text-muted); margin:0 0 16px 0;">You are checked in. Update status once the task is finished.</p>
                    
                    <div style="display:flex; gap:12px; margin-bottom:12px; flex-wrap:wrap;" id="tp-action-button-row">
                        <button class="tp-btn tp-btn-primary" id="tp-btn-show-checkout"><i class="fa fa-check-square-o"></i> Complete & Check Out</button>
                        <button class="tp-btn tp-btn-warning" id="tp-btn-show-pending"><i class="fa fa-pause-circle"></i> Mark Pending</button>
                        <button class="tp-btn" style="background:#e0e7ff; color:#3730a3;" id="tp-btn-resend-otp"><i class="fa fa-refresh"></i> Resend OTP</button>
                    </div>
                    
                    <!-- Check-out OTP input panel -->
                    <div class="tp-otp-wrap" id="tp-otp-box">
                        <p style="font-size:12px; margin:0 0 6px 0; color:var(--tp-text-muted); font-weight:600;">Mode of Payment:</p>
                        <select id="tp-mop-select" class="tp-otp-input" style="font-size:13px; text-align:left; letter-spacing:normal; width:100%; margin-bottom:10px; padding:8px; border:1px solid var(--tp-border); border-radius:4px; outline:none; background:white;">
                            <option value="">Select Mode of Payment...</option>
                            ${(ticket.mop_options || ["Cash", "UPI", "Bank Transfer"]).map(opt => `<option value="${opt}">${opt}</option>`).join('')}
                        </select>
                        
                        <p style="font-size:12px; margin:0 0 6px 0; color:var(--tp-text-muted); font-weight:600;">GST Bill Required:</p>
                        <select id="tp-gst-select" class="tp-otp-input" style="font-size:13px; text-align:left; letter-spacing:normal; width:100%; margin-bottom:10px; padding:8px; border:1px solid var(--tp-border); border-radius:4px; outline:none; background:white;">
                            <option value="">Select Option...</option>
                            ${(ticket.gst_options || ["Yes", "No"]).map(opt => `<option value="${opt}">${opt}</option>`).join('')}
                        </select>

                        <p style="font-size:12px; margin:0 0 6px 0; color:var(--tp-text-muted); font-weight:600;">Enter the 4-digit OTP from customer:</p>
                        <input type="text" id="tp-otp-input" class="tp-otp-input" maxlength="4" placeholder="••••" autocomplete="off" pattern="\\d*" style="margin-bottom:10px;">
                        <div style="display:flex; gap:8px;">
                            <button class="tp-btn tp-btn-primary" id="tp-btn-submit-checkout">Verify & Check Out</button>
                            <button class="tp-btn" style="background:#e2e8f0; color:#475569;" id="tp-btn-cancel-checkout">Cancel</button>
                        </div>
                    </div>
                    
                    <!-- Mark Pending Reason panel -->
                    <div class="tp-otp-wrap" id="tp-pending-box" style="display:none;">
                        <p style="font-size:12px; margin:0 0 6px 0; color:var(--tp-text-muted); font-weight:600;">Select reason for leaving pending:</p>
                        <select id="tp-pending-reason-select" class="tp-otp-input" style="font-size:13px; text-align:left; letter-spacing:normal; width:100%; margin-bottom:10px; padding:8px; border:1px solid var(--tp-border); border-radius:4px; outline:none; background:white;">
                            <option value="">Select a reason...</option>
                            ${(ticket.pending_reason_options || ["Test", "Others"]).map(opt => `<option value="${opt}">${opt}</option>`).join('')}
                        </select>
                        <div id="tp-custom-reason-box" style="display:none; margin-bottom:10px;">
                            <p style="font-size:12px; margin:0 0 6px 0; color:var(--tp-text-muted); font-weight:600;">Specify reason:</p>
                            <textarea id="tp-custom-reason" class="tp-otp-input" style="font-size:13px; text-align:left; letter-spacing:normal; min-height:60px; resize:vertical; width:100%;" placeholder="Please specify the reason..."></textarea>
                        </div>
                        <div style="display:flex; gap:8px;">
                            <button class="tp-btn tp-btn-warning" id="tp-btn-submit-pending">Submit & Leave</button>
                            <button class="tp-btn" style="background:#e2e8f0; color:#475569;" id="tp-btn-cancel-pending">Cancel</button>
                        </div>
                    </div>
                `);
            } else {
                box.html(`
                    <h4 style="margin:0 0 6px 0; color:var(--tp-success); font-size:14px; font-weight:700;">Service Required</h4>
                    <p style="font-size:12px; color:var(--tp-text-muted); margin:0 0 16px 0;">Requires active check-in at customer site. GPS location access is required.</p>
                    
                    <button class="tp-btn tp-btn-success" id="tp-btn-checkin">
                        <i class="fa fa-sign-in"></i> Check In to Customer Location
                    </button>
                `);
            }

            // Handle Check-in button click with Day Attendance Verification and Active Ticket Check
            dialog.$wrapper.find("#tp-btn-checkin").on("click", function () {
                let btn = $(this);
                btn.prop("disabled", true).html('<i class="fa fa-spinner fa-spin"></i> Checking Day Attendance...');

                frappe.call({
                    method: "vin_chakra.technician_api.get_day_attendance_status",
                    callback: function (r) {
                        if (r.message && r.message.status === "success" && r.message.state === "IN") {
                            btn.html('<i class="fa fa-spinner fa-spin"></i> Checking Active Tickets...');
                            frappe.call({
                                method: "vin_chakra.technician_api.check_active_ticket",
                                args: { current_ticket_name: ticket.name },
                                callback: function (res) {
                                    btn.prop("disabled", false).html('<i class="fa fa-sign-in"></i> Check In to Customer Location');
                                    if (res.message && res.message.has_active) {
                                        frappe.msgprint({
                                            title: __("Close Existing Ticket First"),
                                            indicator: "red",
                                            message: __(res.message.message)
                                        });
                                    } else {
                                        if (ticket.status === 'Pending') {
                                            btn.prop("disabled", true).html('<i class="fa fa-spinner fa-spin"></i> Fetching GPS Coords...');
                                            getLocationSafe().then(coords => {
                                                btn.html('<i class="fa fa-spinner fa-spin"></i> Checking In...');
                                                frappe.call({
                                                    method: "vin_chakra.technician_api.technician_checkin",
                                                    args: {
                                                        ticket_name: ticket.name,
                                                        latitude: coords.lat,
                                                        longitude: coords.lng,
                                                        accuracy: coords.accuracy,
                                                        skip_otp: 1
                                                    },
                                                    callback: function (res) {
                                                        btn.prop("disabled", false);
                                                        if (res.message && res.message.status === "success") {
                                                            frappe.show_alert({ message: res.message.message, indicator: "green" });
                                                            dialog.hide();
                                                            self.load_data();
                                                            self.open_ticket_details(ticket.name);
                                                        } else {
                                                            frappe.msgprint(res.message ? res.message.message : __("Error checking in."));
                                                            btn.html('<i class="fa fa-sign-in"></i> Check In to Customer Location');
                                                        }
                                                    }
                                                });
                                            }).catch(err => {
                                                btn.prop("disabled", false).html('<i class="fa fa-sign-in"></i> Check In to Customer Location');
                                                frappe.msgprint(err.message);
                                            });
                                        } else {
                                            trigger_checkin_flow(ticket, false);
                                        }
                                    }
                                },
                                error: function () {
                                    btn.prop("disabled", false).html('<i class="fa fa-sign-in"></i> Check In to Customer Location');
                                }
                            });
                        } else {
                            btn.prop("disabled", false).html('<i class="fa fa-sign-in"></i> Check In to Customer Location');
                            frappe.msgprint({
                                title: __("Day Attendance Required"),
                                indicator: "orange",
                                message: __("Please check in your day attendance first before checking into a ticket. Click the 'Day Check-in' button at the top right of your portal.")
                            });
                        }
                    },
                    error: function () {
                        btn.prop("disabled", false).html('<i class="fa fa-sign-in"></i> Check In to Customer Location');
                    }
                });
            });

            // Resend OTP handler
            dialog.$wrapper.find("#tp-btn-resend-otp").on("click", function () {
                trigger_checkin_flow(ticket, true);
            });

            // Show OTP Check-out Panel
            dialog.$wrapper.find("#tp-btn-show-checkout").on("click", function () {
                dialog.$wrapper.find("#tp-action-button-row").hide();
                dialog.$wrapper.find("#tp-otp-box").show();
                dialog.$wrapper.find("#tp-otp-input").focus();
            });

            dialog.$wrapper.find("#tp-btn-cancel-checkout").on("click", function () {
                dialog.$wrapper.find("#tp-otp-box").hide();
                dialog.$wrapper.find("#tp-action-button-row").show();
            });

            // Show Pending Panel
            dialog.$wrapper.find("#tp-btn-show-pending").on("click", function () {
                dialog.$wrapper.find("#tp-action-button-row").hide();
                dialog.$wrapper.find("#tp-pending-box").show();
                dialog.$wrapper.find("#tp-pending-reason-select").focus();
            });

            dialog.$wrapper.find("#tp-btn-cancel-pending").on("click", function () {
                dialog.$wrapper.find("#tp-pending-box").hide();
                dialog.$wrapper.find("#tp-action-button-row").show();
            });

            // Handle reason select change
            dialog.$wrapper.find("#tp-pending-reason-select").on("change", function () {
                if ($(this).val() === "Others") {
                    dialog.$wrapper.find("#tp-custom-reason-box").show();
                } else {
                    dialog.$wrapper.find("#tp-custom-reason-box").hide();
                }
            });

            // Submit Check-out with OTP and GPS location
            dialog.$wrapper.find("#tp-btn-submit-checkout").on("click", function () {
                let mopVal = dialog.$wrapper.find("#tp-mop-select").val();
                let gstVal = dialog.$wrapper.find("#tp-gst-select").val();
                let otpVal = dialog.$wrapper.find("#tp-otp-input").val().trim();

                if (!mopVal) {
                    frappe.show_alert({ message: __("Please select Mode of Payment"), indicator: "red" });
                    return;
                }
                if (!gstVal) {
                    frappe.show_alert({ message: __("Please select if GST Bill is required"), indicator: "red" });
                    return;
                }
                if (!otpVal || otpVal.length !== 4) {
                    frappe.show_alert({ message: __("Please enter a valid 4-digit OTP"), indicator: "red" });
                    return;
                }

                let btn = $(this);
                btn.prop("disabled", true).text("Locating GPS...");

                getLocationSafe().then(coords => {
                    btn.text("Checking Out...");

                    frappe.call({
                        method: "vin_chakra.technician_api.technician_checkout",
                        args: {
                            ticket_name: ticket.name,
                            otp: otpVal,
                            mode_of_payment: mopVal,
                            gst_bill_required: gstVal,
                            latitude: coords.lat,
                            longitude: coords.lng,
                            accuracy: coords.accuracy
                        },
                        callback: function (res) {
                            btn.prop("disabled", false).text("Verify & Check Out");
                            if (res.message && res.message.status === "success") {
                                frappe.show_alert({ message: __("Checked out and ticket resolved successfully!"), indicator: "green" });
                                dialog.hide();
                                self.load_data();
                                self.open_ticket_details(ticket.name);
                            } else {
                                frappe.msgprint(res.message ? res.message.message : __("Error checking out."));
                                dialog.$wrapper.find("#tp-otp-input").val("").focus();
                            }
                        }
                    });
                }).catch(err => {
                    btn.prop("disabled", false).text("Verify & Check Out");
                    frappe.msgprint(err.message);
                });
            });

            // Submit Pending
            dialog.$wrapper.find("#tp-btn-submit-pending").on("click", function () {
                let reasonVal = dialog.$wrapper.find("#tp-pending-reason-select").val();
                let customReasonVal = dialog.$wrapper.find("#tp-custom-reason").val().trim();

                if (!reasonVal) {
                    frappe.show_alert({ message: __("Please select a pending reason"), indicator: "red" });
                    return;
                }

                if (reasonVal === "Others" && !customReasonVal) {
                    frappe.show_alert({ message: __("Please specify the custom reason"), indicator: "red" });
                    return;
                }

                let btn = $(this);
                btn.prop("disabled", true).text("Locating GPS...");

                getLocationSafe().then(coords => {
                    btn.text("Submitting...");

                    frappe.call({
                        method: "vin_chakra.technician_api.technician_mark_pending",
                        args: {
                            ticket_name: ticket.name,
                            reason: reasonVal,
                            custom_reason: customReasonVal,
                            latitude: coords.lat,
                            longitude: coords.lng,
                            accuracy: coords.accuracy
                        },
                        callback: function (res) {
                            btn.prop("disabled", false).text("Submit & Leave");
                            if (res.message && res.message.status === "success") {
                                frappe.show_alert({ message: __("Ticket status set to Pending!"), indicator: "orange" });
                                dialog.hide();
                                self.load_data();
                                self.open_ticket_details(ticket.name);
                            } else {
                                frappe.msgprint(res.message ? res.message.message : __("Error marking pending."));
                            }
                        }
                    });
                }).catch(err => {
                    btn.prop("disabled", false).text("Submit & Leave");
                    frappe.msgprint(err.message);
                });
            });
        }

        render_action_state(t);
        render_timeline_logs(t.check_log);

        dialog.$wrapper.on("click", ".tp-btn-create-invoice", function (e) {
            e.stopPropagation();
            e.preventDefault();
            let invoice = $(this).data("invoice");
            if (invoice) {
                dialog.hide();
                frappe.set_route("Form", "Sales Invoice", invoice);
                return;
            }
            let ticket_name = $(this).data("name");
            let customer = $(this).data("customer");
            let phone = $(this).data("phone");
            dialog.hide();
            self.create_invoice(ticket_name, customer, phone);
        });

        dialog.$wrapper.on("click", ".tp-btn-send-invoice", function (e) {
            e.stopPropagation();
            e.preventDefault();
            let ticket_name = $(this).data("ticket");
            let invoice_name = $(this).data("invoice");
            let customer = $(this).data("customer");
            let phone = $(this).data("phone");
            dialog.hide();
            self.send_invoice_whatsapp(ticket_name, invoice_name, customer, phone);
        });

        dialog.show();
    }

    // Installation calls are not invoiced; the server refuses them too
    can_create_invoice(t) {
        return (t.ticket_type || "").trim().toLowerCase() !== "installation";
    }

    create_invoice(ticket_name, customer, phone) {
        let cust = (customer && customer !== 'N/A') ? customer : "";

        frappe.call({
            method: "vin_chakra.technician_api.get_invoice_init_details",
            args: {
                ticket_name: ticket_name || "",
                customer: cust
            },
            callback: function (r) {
                let res = r.message || {};
                let cust_id = res.customer_id || cust || "";
                let mop = res.mode_of_payment || "";
                let noj = res.ticket_type || res.nature_of_job || "";
                let gst_req = (res.gst_bill_required === 1 || res.custom_gst_bill_required === 1) ? 1 : 0;

                // Store scalar values — machines are fetched fresh by the invoice form
                if (cust_id) sessionStorage.setItem("tp_inv_customer", cust_id);
                if (mop) sessionStorage.setItem("tp_inv_mop", mop);
                if (noj) sessionStorage.setItem("tp_inv_noj", noj);
                sessionStorage.setItem("tp_inv_gst", String(gst_req));
                if (ticket_name) sessionStorage.setItem("tp_inv_ticket", ticket_name);
                sessionStorage.setItem("tp_inv_active", "1");

                // Pass same keys via route_options so setup() can also capture them
                let opts = { from_technician_portal: 1 };
                if (cust_id) opts.customer = cust_id;
                if (mop) opts.custom_mode_of_payment = mop;
                if (noj) opts.custom_nature_of_job = noj;
                opts.custom_gst_bill_required = gst_req;
                if (ticket_name) opts.ticket_name = ticket_name;

                frappe.new_doc("Sales Invoice", opts);
            }
        });
    }

    send_invoice_whatsapp(ticket_name, invoice_name, customer, phone) {
        let self = this;
        if (!invoice_name) {
            frappe.msgprint({
                title: __("No Invoice Found"),
                indicator: "orange",
                message: __("An invoice has not been created for this ticket yet. Please click 'Create Invoice' first.")
            });
            return;
        }

        frappe.call({
            method: "vin_chakra.whatsapp_api.get_invoice_notification_preview",
            args: { invoice_name: invoice_name, target_phone: phone || "" },
            freeze: true,
            freeze_message: __("Preparing WhatsApp invoice preview..."),
            callback: function (r) {
                if (r.exc || !r.message) return;
                let res = r.message;

                let pf_options = (res.print_formats && res.print_formats.length) ? res.print_formats : [res.default_print_format || "Service invoice"];
                let selected_pf = res.default_print_format || pf_options[0];

                let _render_pdf_badge = function (pdf_link, pf) {
                    let esc_pf = frappe.utils.escape_html(pf || selected_pf || "Service invoice");
                    return `
                        <div style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:6px; padding:8px 12px; margin:4px 0 10px 0; display:flex; justify-content:space-between; align-items:center;">
                            <span style="font-size:12px; color:#1e40af;">
                                📎 <strong>Invoice PDF will be attached</strong> using format: <strong>${esc_pf}</strong>
                            </span>
                            <a href="${pdf_link}" target="_blank" class="btn btn-xs btn-default" style="font-size:11px; padding:3px 8px; color:#1d4ed8; font-weight:600; text-decoration:none;">
                                ${__("Preview PDF ↗")}
                            </a>
                        </div>
                    `;
                };

                let d = new frappe.ui.Dialog({
                    title: __("💬 Send Invoice via WhatsApp"),
                    fields: [
                        {
                            fieldname: "info_html",
                            fieldtype: "HTML",
                            options: `
                                <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 12px; margin-bottom: 12px;">
                                    <div style="display:flex; justify-content:space-between; margin-bottom: 4px;">
                                        <span style="font-weight:600; color:#166534; font-size:14px;">${frappe.utils.escape_html(res.customer_name || customer || 'Customer')}</span>
                                        <span style="font-weight:700; color:#15803d; font-size:15px;">${frappe.utils.escape_html(res.grand_total || '')}</span>
                                    </div>
                                    <div style="font-size:12px; color:#15803d;">Invoice: <strong>${frappe.utils.escape_html(res.invoice_name || '')}</strong></div>
                                    <div style="font-size:12px; color:#15803d; margin-top:2px;">
                                        AskEva Mode: <strong>${frappe.utils.escape_html(res.send_mode || '')}</strong>
                                        ${res.send_mode === 'Template Message' ? `(Template: <code>${frappe.utils.escape_html(res.template_name || '')}</code> ${res.has_document_header ? '<span class="badge" style="background:#0284c7; color:#fff; padding:1px 6px; border-radius:8px; font-size:10px;">📎 Attached PDF</span>' : ''})` : ''}
                                    </div>
                                    ${!res.is_public_base_url ? `
                                    <div style="margin-top:8px; font-size:11px; color:#92400e; background:#fef3c7; border:1px solid #fcd34d; padding:6px 10px; border-radius:6px; line-height:1.4;">
                                        ⚠️ <strong>Local Base URL Notice:</strong> Server address is local (<code>${frappe.utils.escape_html(res.public_base_url || '')}</code>). For Meta Cloud API to download and deliver the PDF file, set <strong>Public Base URL</strong> in AskEva Settings (e.g. your public domain or ngrok tunnel).
                                    </div>
                                    ` : ''}
                                    ${res.send_mode !== 'Template Message' ? `
                                    <div style="margin-top:8px; font-size:12px; color:#92400e; background:#fef3c7; border:1px solid #fcd34d; padding:6px 10px; border-radius:6px; line-height:1.4;">
                                        ⚠️ <strong>24-Hour Session Rule:</strong> Direct text messages can only be sent if this customer sent a WhatsApp message to your business in the last 24 hours. Outside 24h, Meta requires an approved Template Message in AskEva Settings.
                                    </div>
                                    ` : ''}
                                </div>
                            `
                        },
                        {
                            fieldname: "target_phone",
                            fieldtype: "Data",
                            label: __("Customer Mobile Number (WhatsApp)"),
                            reqd: 1,
                            default: res.target_phone || phone,
                            description: __("10-digit mobile number with or without +91 prefix")
                        },
                        {
                            fieldname: "print_format",
                            fieldtype: "Select",
                            label: __("Print Format"),
                            options: pf_options,
                            default: selected_pf,
                            reqd: 1,
                            description: __("Choose the print format for the attached invoice PDF"),
                            change: function () {
                                let new_pf = (this.get_value() || "").trim();
                                if (!new_pf) return;
                                selected_pf = new_pf;
                                if (d.fields_dict.pdf_badge_html) {
                                    d.fields_dict.pdf_badge_html.$wrapper.html(
                                        _render_pdf_badge(res.pdf_link, new_pf)
                                    );
                                }
                                frappe.call({
                                    method: "vin_chakra.whatsapp_api.get_invoice_notification_preview",
                                    args: {
                                        invoice_name: invoice_name,
                                        target_phone: d.get_value("target_phone") || phone,
                                        print_format: new_pf
                                    },
                                    freeze: false,
                                    callback: function (r) {
                                        if (r.message && r.message.pdf_link) {
                                            res.pdf_link = r.message.pdf_link;
                                            if (d.fields_dict.pdf_badge_html) {
                                                d.fields_dict.pdf_badge_html.$wrapper.html(
                                                    _render_pdf_badge(res.pdf_link, new_pf)
                                                );
                                            }
                                        }
                                    },
                                    error: function (err) {
                                        // Preserve user's format selection without throwing modal
                                    }
                                });
                            }
                        },
                        {
                            fieldname: "pdf_badge_html",
                            fieldtype: "HTML",
                            options: _render_pdf_badge(res.pdf_link, selected_pf)
                        },
                        {
                            fieldname: "preview_html",
                            fieldtype: "HTML",
                            options: `
                                <label class="control-label" style="font-size:12px; font-weight:600; color:#374151; margin-bottom:4px; display:block;">
                                    ${res.send_mode === 'Template Message' ? __('Template Parameters Preview:') : __('Message Text Preview:')}
                                </label>
                                <div style="background:#f9fafb; border:1px solid #e5e7eb; border-radius:6px; padding:10px; font-size:13px; white-space:pre-wrap; max-height:160px; overflow-y:auto; color:#1f2937;">
                                    ${res.send_mode === 'Template Message' ?
                                    `<ol style="padding-left:18px; margin:0;">${(res.param_values || []).map(p => `<li><strong>${frappe.utils.escape_html(p)}</strong></li>`).join('')}</ol>` :
                                    frappe.utils.escape_html(res.rendered_text)}
                                </div>
                            `
                        }
                    ],
                    primary_action_label: __("Send via WhatsApp"),
                    primary_action: function (values) {
                        let dest_phone = (values.target_phone || "").trim();
                        if (!dest_phone) {
                            frappe.msgprint(__("Please enter a mobile number."));
                            return;
                        }
                        let pf = (values.print_format || selected_pf || "").trim();
                        d.hide();
                        frappe.call({
                            method: "vin_chakra.whatsapp_api.send_sales_invoice_whatsapp",
                            args: {
                                invoice_name: invoice_name,
                                target_phone: dest_phone,
                                print_format: pf
                            },
                            freeze: true,
                            freeze_message: __("Dispatching invoice to WhatsApp..."),
                            callback: function (resp) {
                                if (resp.message && resp.message.status === "success") {
                                    frappe.show_alert({
                                        message: resp.message.message || __("Invoice sent via WhatsApp!"),
                                        indicator: "green"
                                    }, 6);
                                    if (typeof self.load_data === 'function') {
                                        self.load_data();
                                    }
                                } else {
                                    frappe.msgprint({
                                        title: __("Dispatch Failed"),
                                        indicator: "red",
                                        message: resp.message ? resp.message.message : __("Failed to send WhatsApp message.")
                                    });
                                }
                            }
                        });
                    }
                });
                d.show();
            }
        });
    }
}

// Expense Claim popup, laid out like the paper "Staff Tour Settlement" form. The first screen
// lists the tickets the technician visited on a day or in a week (Today, Last 1 Week or a picked
// date); tapping one opens that ticket's claim. Edits are kept per ticket until the list's Save,
// the only button that writes (a draft Expense Claim per ticket); Share (Excel) only downloads a
// file. Server side: the Expense Claim popup section of technician_portal.py.
const TP_EXPENSE_API = "vin_chakra.vin_chakra.page.technician_portal.technician_portal.";
const TP_EC_MAX_LIST_DAYS = 92;  // the longest From–To period (MAX_LIST_DAYS on the server)
const TP_EC_PRINT_FORMAT = "Expense Claim";  // Print Format name, exact-ah (Print Format list la irukkura name)

class TechnicianExpenseClaim {
    constructor(portal) {
        this.portal = portal;
        // Unsaved edits per ticket, {ticket: {form, modified, period}}: `modified` is the claim's
        // timestamp they were made on, `period` the list's [from, to] the ticket was opened from.
        // Kept on the portal, so they survive going back to the list, switching the dates and
        // closing the popup, until the list's Save.
        portal.expense_drafts = portal.expense_drafts || {};
        portal.expense_problems = portal.expense_problems || {};  // {ticket: [why it wasn't saved]}
        this.drafts = portal.expense_drafts;
        this.problems = portal.expense_problems;
        // The list shows the visits from `from_date` to `to_date`, both included
        let today = frappe.datetime.get_today();
        [this.from_date, this.to_date] = portal.expense_period || [today, today];
        this.list_notice = null;  // the last Save's result, shown under the list
        this.guard_unsaved_changes();
        this.screen = "list";
        this.list = null;  // get_tickets answer on screen
        this.data = null;  // get_ticket_claim answer on screen
        this.form = null;  // the open ticket's form
        this.base = null;  // that form as saved (or its defaults), to tell edits apart
        this.seq = 0;      // keys for expense rows
        this.uid = frappe.utils.get_random(6);
        this.esc = frappe.utils.escape_html;
        this.touch = window.matchMedia("(pointer: coarse)").matches;
        this.make_dialog();
    }

    show() {
        this.dialog.show();
        this.show_list();
    }

    // Unsaved expenses live only in this page until Save: warn before it is closed or reloaded
    guard_unsaved_changes() {
        if (this.portal.expense_unload_guard) return;
        this.portal.expense_unload_guard = true;
        window.addEventListener("beforeunload", (e) => {
            if (!Object.keys(this.portal.expense_drafts || {}).length) return;
            e.preventDefault();
            e.returnValue = "";
        });
    }

    make_dialog() {
        this.dialog = new frappe.ui.Dialog({
            title: __("Expense Claim"),
            fields: [{ fieldtype: "HTML", fieldname: "body" }],
        });
        this.dialog.$wrapper.addClass("tp-ec-dialog");
        this.$body = this.dialog.get_field("body").$wrapper.addClass("tp-ec");
        // Our own footer (totals, Share, Save) stays in view while the body scrolls
        this.dialog.footer.removeClass("hide");
        this.dialog.standard_actions.addClass("hide");
        this.$footer = $(`<div class="tp-ec-footer"></div>`).appendTo(this.dialog.custom_actions);
        this.bind_events();
        this.dialog.onhide = () => this.dialog.$wrapper.remove();
    }

    // --- List screen ------------------------------------------------------------------

    show_list() {
        this.screen = "list";
        this.ticket = this.data = this.form = this.base = null;
        this.$body.html(`
            <div class="tp-ec-toolbar">
                <div class="tp-view-selector" role="group">
                    <button type="button" class="tp-view-btn" data-range="today">${__("Today")}</button>
                    <button type="button" class="tp-view-btn" data-range="last_week">${__("Last 1 Week")}</button>
                </div>
                <div class="tp-ec-dates">
                    <label class="tp-ec-date-field"><span>${__("From")}</span>
                        ${this.date_box(`<input type="date" class="form-control tp-ec-date" data-date="from" max="${frappe.datetime.get_today()}">`)}</label>
                    <label class="tp-ec-date-field"><span>${__("To")}</span>
                        ${this.date_box(`<input type="date" class="form-control tp-ec-date" data-date="to" max="${frappe.datetime.get_today()}">`)}</label>
                </div>
            </div>
            <div class="tp-ec-list-wrap"><div class="tp-ec-empty">${__("Loading...")}</div></div>
        `);
        this.mark_period();
        this.list = null;
        this.render_footer();
        this.load_list();
    }

    // The dates in the inputs; Today and Last 1 Week (the 7 days up to today) are shortcuts
    mark_period() {
        let today = frappe.datetime.get_today();
        this.$body.find('[data-range="today"]').toggleClass("active", this.from_date === today && this.to_date === today);
        this.$body.find('[data-range="last_week"]').toggleClass("active", this.from_date === frappe.datetime.add_days(today, -6) && this.to_date === today);
        this.$body.find('[data-date="from"]').val(this.from_date);
        this.$body.find('[data-date="to"]').val(this.to_date);
        this.$body.find(".tp-ec-date").removeClass("is-invalid").each((i, el) => this.show_date(el));
    }

    // A date input that shows its date in the system format (dd-mm-yyyy), whatever the
    // browser's language: the input's own text is hidden under ours, so a tap still opens the
    // phone's date picker
    date_box(input, value = "") {
        return `<div class="tp-ec-datebox">${input}<span class="tp-ec-datebox-text ${value ? "" : "is-empty"}" aria-hidden="true">${this.esc(this.user_date(value))}</span></div>`;
    }

    show_date(input) {
        $(input).siblings(".tp-ec-datebox-text").text(this.user_date(input.value)).toggleClass("is-empty", !input.value);
    }

    user_date(value) {
        return value ? frappe.datetime.str_to_user(value) : (frappe.boot.sysdefaults.date_format || "dd-mm-yyyy");
    }

    set_period(from_date, to_date) {
        [this.from_date, this.to_date] = this.portal.expense_period = [from_date, to_date];
        this.list_notice = null;
        this.list = null;  // nothing to share until the new list is in
        this.mark_period();
        this.$body.find(".tp-ec-list-wrap").html(`<div class="tp-ec-empty">${__("Loading...")}</div>`);
        this.render_footer();
        this.load_list();
    }

    // Why the From / To dates can't be listed, or "" (the server checks the same)
    period_problem(from_date, to_date) {
        if (!from_date || !to_date) return __("Choose the From and To dates.");
        if (to_date > frappe.datetime.get_today()) return __("The dates can't be in the future.");
        if (from_date > to_date) return __("The From date can't be after the To date.");
        if (frappe.datetime.get_day_diff(to_date, from_date) >= TP_EC_MAX_LIST_DAYS) {
            return __("Choose a period of up to {0} days.", [TP_EC_MAX_LIST_DAYS]);
        }
        return "";
    }

    load_list() {
        // Only the latest request counts: an older answer is for dates the user has left
        let seq = this.list_seq = (this.list_seq || 0) + 1;
        let current = () => this.screen === "list" && seq === this.list_seq;
        frappe.call({
            method: TP_EXPENSE_API + "get_expense_claim_list",
            args: { from_date: this.from_date, to_date: this.to_date },
            callback: (r) => {
                // Ignore a slower answer for dates or a screen the user has left
                if (!r.message || !current()) return;
                this.list = r.message;
                this.render_list();
            },
            error: () => {
                if (current()) this.$body.find(".tp-ec-list-wrap").html(`<div class="tp-ec-empty">${__("Could not load your visits.")}</div>`);
            },
        });
    }

    render_list() {
        let data = this.list, esc = this.esc;
        let total = 0;
        let rows = data.tickets.map((t) => {
            let draft = this.drafts[t.name];
            let claim = t.claim;
            let amount = draft ? this.form_total(draft.form) : claim ? claim.total : null;
            total += amount || 0;
            let [kind, label] = draft && this.problems[t.name] ? ["problem", __("Needs attention")]
                : draft ? ["unsaved", __("Unsaved")]
                    : claim ? [claim.locked ? "locked" : "draft", __(claim.status)]
                        : ["none", __("Not claimed")];
            return `
                <tr class="tp-ec-list-row" data-ticket="${esc(t.name)}" tabindex="0" role="button">
                    <td>
                        <div class="tp-ec-ticket-no">${esc(t.name)}</div>
                        ${t.customer_name ? `<div class="tp-ec-customer">${esc(t.customer_name)}</div>` : ""}
                        <div class="tp-ec-meta"><span class="text-nowrap">${frappe.datetime.str_to_user(t.visit_date)}</span> <span class="text-nowrap">· ${esc(__(t.status))}</span></div>
                    </td>
                    <td class="tp-ec-claimed">
                        <div class="tp-ec-amount">${amount === null ? "—" : format_currency(amount, data.currency)}</div>
                        <span class="tp-ec-chip is-${kind}">${esc(label)}</span>
                    </td>
                    <td class="tp-ec-go">${frappe.utils.icon("chevron-right", "sm")}</td>
                </tr>`;
        }).join("");
        let from = frappe.datetime.str_to_user(data.from_date), to = frappe.datetime.str_to_user(data.to_date);
        let empty = data.from_date !== data.to_date ? __("No customer visits from {0} to {1}", [from, to])
            : data.to_date === frappe.datetime.get_today() ? __("No customer visits today")
                : __("No customer visits on {0}", [to]);
        this.$body.find(".tp-ec-list-wrap").html(`
            ${data.employee_missing ? `<div class="tp-ec-banner is-warning">${__("No active Employee is linked to your user, so you can't save Expense Claims. Please contact HR.")}</div>` : ""}
            <table class="table table-bordered tp-ec-list">
                <thead><tr><th>${__("Ticket")}</th><th class="tp-ec-claimed" colspan="2">${__("Claimed")}</th></tr></thead>
                <tbody>${rows || `<tr><td colspan="3" class="tp-ec-empty">${empty}</td></tr>`}</tbody>
                ${data.tickets.length ? `<tfoot><tr><th class="text-right">${__("Total")}</th><th class="tp-ec-claimed" colspan="2">${format_currency(total, data.currency)}</th></tr></tfoot>` : ""}
            </table>
            ${data.tickets.length ? `<div class="tp-ec-hint">${__("Tap a ticket to enter its expenses.")}</div>` : ""}
        `);
        this.render_footer();
    }

    // --- Ticket screen ----------------------------------------------------------------

    open_ticket(ticket) {
        this.screen = "ticket";
        this.ticket = ticket;
        this.list_notice = null;  // the last Save's result isn't news any more
        this.data = this.form = this.base = null;
        let draft_period = this.drafts[ticket] && this.drafts[ticket].period;
        this.period = draft_period || (this.list ? [this.list.from_date, this.list.to_date] : null);
        this.$body.html(`${this.back_button()}<div class="tp-ec-empty">${__("Loading...")}</div>`);
        this.$footer.empty();
        this.dialog.$wrapper.find(".modal-body").scrollTop(0);
        let current = () => this.screen === "ticket" && this.ticket === ticket;
        frappe.call({
            method: TP_EXPENSE_API + "get_ticket_expense_claim",
            args: { ticket, from_date: this.period ? this.period[0] : "", to_date: this.period ? this.period[1] : "" },
            callback: (r) => {
                if (!r.message || !current()) return;
                this.data = r.message;
                this.base = this.form_from_data(this.data);
                let saved_modified = this.data.claim ? this.data.claim.modified : null;
                let draft = this.drafts[ticket];
                if (draft && this.is_locked()) {
                    delete this.drafts[ticket];  // submitted meanwhile: HR has it now
                    draft = null;
                }
                // Edits made on an older version of the claim can't be saved over the new one
                this.draft_modified = draft ? draft.modified : saved_modified;
                this.stale = !!draft && draft.modified !== saved_modified;
                this.form = draft ? JSON.parse(JSON.stringify(draft.form)) : JSON.parse(JSON.stringify(this.base));
                this.render_ticket();
                if (this.drafts[ticket] && this.problems[ticket]) this.validate();  // why the last Save skipped it
            },
            error: () => {
                if (current()) this.$body.find(".tp-ec-empty").text(__("Could not load this ticket."));
            },
        });
    }

    back_button() {
        return `<button type="button" class="btn btn-link tp-ec-back">${frappe.utils.icon("chevron-left", "sm")} ${__("Tickets")}</button>`;
    }

    is_locked() {
        return !!(this.data && this.data.claim && this.data.claim.locked);
    }

    new_row(e = {}) {
        return {
            key: `r${++this.seq}`,
            name: e.name || null,
            expense_type: e.expense_type || "",
            amount: e.amount ? flt(e.amount, 2).toFixed(2) : "",
        };
    }

    form_from_data(data) {
        let c = data.claim, d = data.defaults;
        if (!c) {
            return {
                from_location: "",
                journey_date: d.journey_date || "",
                no_of_days: String(d.no_of_days || 1),
                payable_by_customer: d.payable_by_customer || "",
                amount_collected: "",
                expenses: [this.new_row()],
            };
        }
        return {
            from_location: c.from_location || "",
            journey_date: c.journey_date || d.journey_date || "",
            no_of_days: String(c.no_of_days || d.no_of_days || ""),
            payable_by_customer: c.payable_by_customer || d.payable_by_customer || "",
            amount_collected: c.amount_collected === null || c.amount_collected === undefined ? "" : flt(c.amount_collected, 2).toFixed(2),
            expenses: c.expenses.map((e) => this.new_row(e)),
        };
    }

    render_ticket() {
        let d = this.data, t = d.ticket, c = d.claim, f = this.form, esc = this.esc;
        let locked = this.is_locked();
        let dis = locked ? "disabled" : "";
        let id = (name) => `tp-ec-${this.uid}-${name}`;

        let banners = [];
        if (d.employee_missing) {
            banners.push(["warning", esc(__("No active Employee is linked to your user, so you can't save Expense Claims. Please contact HR."))]);
        }
        if (c && c.legacy) {
            banners.push(["info", esc(__("These expenses are in Expense Claim {0} ({1}) together with other tickets. HR has it now, so they can't be changed here.", [c.name, __(c.status)]))]);
        } else if (locked) {
            banners.push(["info", esc(__("Expense Claim {0} is {1}. HR has it now, so it can't be changed here.", [c.name, __(c.status)]))]);
        }
        if (!c && d.cancelled_claim) {
            banners.push(["info", esc(__("Expense Claim {0} for this ticket was cancelled. Saving makes a new claim.", [d.cancelled_claim]))]);
        }
        if (this.drafts[t.name] && this.problems[t.name]) {
            banners.push(["danger tp-ec-problems", esc(__("Not saved: {0}", [this.problems[t.name].join(" ")]))]);
        }
        if (this.stale) {
            banners.push(["warning", esc(__("This claim was changed after you started editing it (for example by HR), so your changes can't be saved over it."))
                + ` <button type="button" class="btn btn-xs btn-default tp-ec-discard">${__("Discard my changes")}</button>`]);
        }

        let field = (name, label, control, opts = {}) => `
            <div class="tp-ec-field" data-field="${name}" ${opts.hidden ? "hidden" : ""}>
                <label class="tp-ec-label" ${opts.no_for ? "" : `for="${id(name)}"`}>${label}${opts.required && !locked ? ` <span class="tp-ec-req">*</span>` : ""}</label>
                ${control}
                <div class="tp-ec-error" role="alert"></div>
            </div>`;
        let select = (name, values, value, placeholder) => {
            let options = values.slice();
            if (value && !options.includes(value)) options.push(value);
            return `<select class="form-control" id="${id(name)}" data-bind="${name}" ${dis}>
                <option value="">${esc(placeholder)}</option>
                ${options.map((o) => `<option value="${esc(o)}" ${o === value ? "selected" : ""}>${esc(__(o))}</option>`).join("")}
            </select>`;
        };

        // The claim's status only; its number (HR-EXP-…) isn't shown here
        let claim_line = c ? esc(__(c.status)) : esc(__("Not saved yet"));
        let rows = f.expenses.map((e) => this.row_html(e, locked)).join("");

        this.$body.html(`
            ${this.back_button()}
            ${banners.map(([kind, html]) => `<div class="tp-ec-banner is-${kind}">${html}</div>`).join("")}
            <section class="tp-ec-section">
                <h5 class="tp-ec-section-title">${__("Trip")}</h5>
                <div class="tp-ec-ticket-head">
                    <a href="#" class="tp-ec-ticket-link" title="${esc(__("Open ticket details"))}">${esc(t.name)}</a>
                    <span class="tp-ec-pill">${esc(__(t.status))}</span>
                </div>
                ${t.customer_name ? `<div class="tp-ec-customer">${esc(t.customer_name)}</div>` : ""}
                <div class="tp-ec-meta">
                    ${esc(__("Visited {0}", [frappe.datetime.str_to_user(t.visit_date)]))} · ${claim_line}
                    <span class="tp-ec-chip is-unsaved tp-ec-unsaved" hidden>${__("Unsaved")}</span>
                </div>
                <div class="tp-ec-grid is-date">
                    ${field("journey_date", __("Date of journey"), this.date_box(`<input type="date" class="form-control" id="${id("journey_date")}" data-bind="journey_date" value="${esc(f.journey_date)}" max="${frappe.datetime.get_today()}" ${dis}>`, f.journey_date), { required: true })}
                    ${field("no_of_days", __("No. of days"), `<input type="number" class="form-control" id="${id("no_of_days")}" data-bind="no_of_days" value="${esc(f.no_of_days)}" min="1" max="31" step="1" inputmode="numeric" ${dis}>`, { required: true })}
                </div>
                ${field("trip_reason", __("Reason for trip (call type)"), this.trip_reason_html(), { no_for: true })}
            </section>
            <section class="tp-ec-section">
                <h5 class="tp-ec-section-title">${__("From → To")}</h5>
                ${field("from_location", __("From Location"), `<input type="text" class="form-control" id="${id("from_location")}" data-bind="from_location" value="${esc(f.from_location)}" maxlength="140" autocomplete="off" enterkeyhint="next" placeholder="${esc(__("Where you started"))}" ${dis}>`, { required: true })}
                ${field("to_location", __("To (customer address)"), this.to_location_html(), { no_for: true })}
            </section>
            <section class="tp-ec-section">
                <h5 class="tp-ec-section-title">${__("Customer payment")}</h5>
                <div class="tp-ec-grid">
                    ${field("payable_by_customer", __("Payable by customer"), select("payable_by_customer", ["Yes", "No"], f.payable_by_customer, __("Select")), { required: true })}
                    ${field("amount_collected", __("Amount collected"), `<input type="number" class="form-control tp-ec-number" id="${id("amount_collected")}" data-bind="amount_collected" value="${esc(f.amount_collected)}" min="0" step="0.01" inputmode="decimal" placeholder="0.00" ${dis}>`, { required: true, hidden: f.payable_by_customer !== "Yes" })}
                </div>
            </section>
            <section class="tp-ec-section" data-field="expenses">
                <h5 class="tp-ec-section-title">${__("Expenses")}</h5>
                <div class="tp-ec-error" role="alert"></div>
                <div class="tp-ec-rows">${rows}</div>
                ${locked ? "" : `<button type="button" class="btn btn-default btn-block tp-ec-add">${frappe.utils.icon("plus", "sm")} <span>${__("Add Another Expense")}</span></button>`}
            </section>
        `);
        this.render_footer();
        this.on_form_change(false);
    }

    // Reason for Trip: the ticket's Call Type (read-only; Save stores it); a submitted claim
    // shows what it saved
    trip_reason_html() {
        let d = this.data, esc = this.esc;
        let text = this.is_locked() ? d.claim.trip_reason : d.ticket.call_type;
        if (!text) {
            return `<div class="tp-ec-static is-empty">${esc(this.is_locked() ? __("Not recorded") : __("Not set on the ticket"))}</div>`;
        }
        return `<div class="tp-ec-static">${esc(__(text))}</div>`;
    }

    // To Location: the customer's address from the ticket (read-only); a submitted claim shows
    // what it saved
    to_location_html() {
        let d = this.data, esc = this.esc;
        let text = this.is_locked() ? d.claim.to_location : d.to_location && d.to_location.text;
        if (!text && !this.is_locked()) {
            return `<div class="tp-ec-banner is-warning tp-ec-no-location">${esc(d.to_location_warning || "")}</div>`;
        }
        return `<div class="tp-ec-to"><div class="tp-ec-to-place">${esc(text || __("Not recorded"))}</div></div>`;
    }

    row_html(e, locked) {
        let esc = this.esc;
        let types = this.data.expense_types.map((t) => t.name);
        if (e.expense_type && !types.includes(e.expense_type)) types.push(e.expense_type);
        let dis = locked ? "disabled" : "";
        return `
            <div class="tp-ec-row ${locked ? "is-locked" : ""}" data-key="${e.key}">
                <select class="form-control tp-ec-type" data-row="expense_type" aria-label="${esc(__("Expense type"))}" ${dis}>
                    <option value="">${__("Select type")}</option>
                    ${types.map((name) => `<option value="${esc(name)}" ${name === e.expense_type ? "selected" : ""}>${esc(__(name))}</option>`).join("")}
                </select>
                <input type="number" class="form-control tp-ec-number" data-row="amount" value="${esc(e.amount)}" min="0.01" step="0.01"
                    inputmode="decimal" placeholder="0.00" aria-label="${esc(__("Amount"))}" ${dis}>
                ${locked ? "" : `<button type="button" class="btn tp-ec-del" aria-label="${esc(__("Delete this expense"))}" title="${esc(__("Delete"))}">${frappe.utils.icon("trash-2", "sm")}</button>`}
                <div class="tp-ec-error" role="alert"></div>
            </div>`;
    }

    // --- Form state -------------------------------------------------------------------

    amount_ok(value, allow_zero) {
        if (value === "" || value === null || value === undefined) return !!allow_zero;
        let n = Number(value);
        return Number.isFinite(n) && n >= 0 && (allow_zero || n > 0);
    }

    form_total(form) {
        return form.expenses.reduce((sum, e) => sum + (this.amount_ok(e.amount) ? flt(e.amount, 2) : 0), 0);
    }

    // The form as compared and saved: trimmed text, 2-decimal amounts, no row keys
    snapshot(form) {
        let amt = (v) => (v === "" || v === null || v === undefined) ? "" : (Number.isFinite(Number(v)) ? flt(v, 2).toFixed(2) : String(v));
        return JSON.stringify({
            from_location: (form.from_location || "").trim(),
            journey_date: form.journey_date || "",
            no_of_days: String(form.no_of_days || "").trim(),
            payable_by_customer: form.payable_by_customer || "",
            amount_collected: form.payable_by_customer === "Yes" ? amt(form.amount_collected) : "",
            expenses: form.expenses.map((e) => [e.name || "", e.expense_type || "", amt(e.amount)]),
        });
    }

    // The form as sent to the server; `period` dates new expense lines (the list's dates)
    payload(form, modified, period) {
        return {
            from_location: (form.from_location || "").trim(),
            journey_date: form.journey_date || "",
            no_of_days: String(form.no_of_days || "").trim(),
            payable_by_customer: form.payable_by_customer || "",
            amount_collected: form.payable_by_customer === "Yes" ? form.amount_collected : "",
            expenses: form.expenses.map((e) => ({ name: e.name, expense_type: e.expense_type, amount: e.amount })),
            modified,
            visit_from: period ? period[0] : "",
            visit_to: period ? period[1] : "",
        };
    }

    // Keep the draft (or drop it when the form is back to what's saved) and refresh the totals
    on_form_change(store = true) {
        if (!this.form) return;
        let dirty = this.snapshot(this.form) !== this.snapshot(this.base);
        if (!dirty && this.stale) {
            // Back to exactly what's saved: nothing of the old edits is left to lose
            this.stale = false;
            this.draft_modified = this.data.claim ? this.data.claim.modified : null;
            this.$body.find(".tp-ec-discard").closest(".tp-ec-banner").remove();
        }
        if (store && !this.is_locked()) {
            if (dirty) this.drafts[this.ticket] = { form: this.form, modified: this.draft_modified, period: this.period };
            else delete this.drafts[this.ticket];
            // An edit makes the last Save's problems and "Please fix" out of date
            delete this.problems[this.ticket];
            this.$body.find(".tp-ec-problems").remove();
            this.notice();
        }
        this.$body.find(".tp-ec-unsaved").prop("hidden", !this.drafts[this.ticket]);
        this.$footer.find(".tp-ec-save").prop("disabled", this.save_blocked());
        this.$footer.find(".tp-ec-total").text(format_currency(this.form_total(this.form), this.data.currency));
    }

    find_row(key) {
        return this.form.expenses.find((e) => e.key === key);
    }

    add_row() {
        let row = this.new_row();
        this.form.expenses.push(row);
        let $row = $(this.row_html(row, false)).appendTo(this.$body.find(".tp-ec-rows"));
        this.clear_error(this.$body.find('[data-field="expenses"]'));
        this.on_form_change();
        $row[0].scrollIntoView({ block: "nearest", behavior: "smooth" });
        $row.find(".tp-ec-type").trigger("focus");
    }

    // --- Footer, validation, Save and Share -------------------------------------------

    render_footer() {
        let share = (disabled) => `<button type="button" class="btn btn-default tp-ec-share" ${disabled ? "disabled" : ""}>
            ${frappe.utils.icon("file-spreadsheet", "sm")} <span>${__("Share (Excel)")}</span></button>`;
        let save = (disabled) => `<button type="button" class="btn btn-primary tp-ec-save" ${disabled ? "disabled" : ""}>
            ${frappe.utils.icon("save", "sm")} <span>${__("Save")}</span></button>`;
        // Messages go in the footer, not in a toast: on phones a toast covers these buttons
        if (this.screen === "list") {
            // Save here saves every ticket with unsaved changes
            let unsaved = Object.keys(this.drafts).length;
            let blocked = !unsaved || (this.list && this.list.employee_missing);
            this.$footer.html(`
                <div class="tp-ec-notice" role="status"></div>
                <div class="tp-ec-actions">
                    ${share(!(this.list && this.list.tickets.length))}
                    ${save(blocked)}
                </div>
            `);
            if (this.list_notice) this.notice(this.list_notice.kind, this.list_notice.message);
            else if (unsaved) this.notice("info", unsaved === 1 ? __("1 ticket has unsaved changes.") : __("{0} tickets have unsaved changes.", [unsaved]));
            return;
        }
        // This ticket's own Save, once it has changes; a submitted claim can't be changed
        this.$footer.html(`
            <div class="tp-ec-notice" role="status"></div>
            <div class="tp-ec-totals">
                <div class="tp-ec-total-line"><span>${__("Total")}</span><b class="tp-ec-total"></b></div>
            </div>
            <div class="tp-ec-actions">${share(false)}${this.is_locked() ? "" : save(this.save_blocked())}</div>
        `);
    }

    // The ticket's Save is off until the form has changes (and when no Employee can claim)
    save_blocked() {
        return !this.drafts[this.ticket] || !!(this.data && this.data.employee_missing);
    }

    notice(kind, message) {
        this.$footer.find(".tp-ec-notice").attr("data-kind", kind || "").text(message || "");
    }

    set_error($field, message) {
        $field.children(".tp-ec-error").text(message);
        this.field_inputs($field).addClass("is-invalid");
        return $field;
    }

    clear_error($field) {
        $field.children(".tp-ec-error").text("");
        this.field_inputs($field).removeClass("is-invalid");
    }

    field_inputs($field) {
        return $field.children("input, select").add($field.children(".tp-ec-datebox").children("input"));
    }

    // The form's problems, [{field, message, key}] (key: an expense row); the server checks the
    // same. `check_to`: only the ticket screen knows whether the ticket has a customer address.
    form_problems(form, check_to) {
        let found = [];
        let add = (field, message, key) => found.push({ field, message, key });
        if (check_to && !this.data.to_location) add("to_location", this.data.to_location_warning || "");
        if (!form.journey_date) add("journey_date", __("Enter the date of journey."));
        else if (form.journey_date > frappe.datetime.get_today()) add("journey_date", __("The date can't be in the future."));
        let days = String(form.no_of_days || "").trim();
        if (!/^\d+$/.test(days) || +days < 1 || +days > 31) add("no_of_days", __("Enter 1 to 31 days."));
        if (!(form.from_location || "").trim()) add("from_location", __("Enter where you started from."));
        if (!form.payable_by_customer) add("payable_by_customer", __("Select Yes or No."));
        else if (form.payable_by_customer === "Yes") {
            // what the customer paid the technician: has to be entered, 0 when nothing was paid
            if (String(form.amount_collected ?? "").trim() === "") add("amount_collected", __("Enter the amount collected (0 if none)."));
            else if (!this.amount_ok(form.amount_collected, true)) add("amount_collected", __("Enter a valid amount."));
        }
        if (!form.expenses.length) add("expenses", __("Add at least one expense."));
        form.expenses.forEach((e) => {
            if (!e.expense_type) add("expense_type", __("Select the expense type."), e.key);
            if (!this.amount_ok(e.amount, false)) add("amount", __("Enter an amount above 0."), e.key);
        });
        return found;
    }

    // Mark the open ticket's problems next to their fields; false when there are any
    validate() {
        let $b = this.$body, marked = [], rows = {};
        $b.find(".tp-ec-field, [data-field], .tp-ec-row").each((i, el) => this.clear_error($(el)));
        this.form_problems(this.form, true).forEach((p) => {
            if (p.key) {
                (rows[p.key] = rows[p.key] || []).push(p);
                return;
            }
            let $field = $b.find(`[data-field="${p.field}"]`);
            marked.push(p.field === "to_location" ? $field : this.set_error($field, p.message));  // its warning says why
        });
        Object.entries(rows).forEach(([key, list]) => {
            let $row = $b.find(`.tp-ec-row[data-key="${key}"]`);
            list.forEach((p) => $row.find(p.field === "expense_type" ? ".tp-ec-type" : ".tp-ec-number").addClass("is-invalid"));
            $row.children(".tp-ec-error").text(list.map((p) => p.message).join(" "));
            marked.push($row);
        });
        if (!marked.length) return true;
        marked[0][0].scrollIntoView({ block: "center", behavior: "smooth" });
        this.notice("error", __("Please fix the highlighted fields."));
        return false;
    }

    // The list's Save: every ticket with unsaved changes, in one request. Each ticket is saved on
    // its own (new claim, or its draft updated), so a ticket with a problem is reported and kept
    // for fixing while the others are saved.
    save_all() {
        if (this.saving) return;
        let tickets = Object.keys(this.drafts);
        if (!tickets.length) return;
        let claims = {}, problems = {};
        tickets.forEach((ticket) => {
            let draft = this.drafts[ticket];
            let found = this.form_problems(draft.form, false);
            if (found.length) problems[ticket] = [...new Set(found.map((p) => p.message))];
            else claims[ticket] = this.payload(draft.form, draft.modified, draft.period);
        });
        if (!Object.keys(claims).length) {
            this.after_save({}, problems);
            return;
        }
        this.saving = true;
        let $btn = this.$footer.find(".tp-ec-save").prop("disabled", true);
        frappe.call({
            method: TP_EXPENSE_API + "save_expense_claims",
            args: { claims: JSON.stringify(claims) },
            freeze: true,
            freeze_message: __("Saving..."),
            callback: (r) => {
                if (!r.message) return;
                Object.keys(r.message.saved).forEach((ticket) => {
                    delete this.drafts[ticket];
                    delete this.problems[ticket];
                });
                Object.entries(r.message.errors).forEach(([ticket, message]) => (problems[ticket] = [message]));
                this.after_save(r.message.saved, problems);
            },
            // On an error Frappe shows the server's message and calls only `error`/`always`
            always: () => {
                this.saving = false;
                $btn.prop("disabled", false);
            },
        });
    }

    // The ticket screen's Save: this ticket only (the list's Save does every ticket with changes).
    // It stays on the ticket with the saved claim; a refusal by the server is shown here, and the
    // edits are kept.
    save_ticket() {
        if (this.saving || !this.data || !this.form || this.is_locked()) return;
        if (this.stale) {
            this.notice("error", __("This claim was changed after you started editing it, so your changes can't be saved over it."));
            let banner = this.$body.find(".tp-ec-discard").closest(".tp-ec-banner")[0];
            if (banner) banner.scrollIntoView({ block: "center", behavior: "smooth" });
            return;
        }
        if (!this.validate()) return;
        let ticket = this.ticket;
        this.saving = true;
        let $btn = this.$footer.find(".tp-ec-save").prop("disabled", true);
        frappe.call({
            method: TP_EXPENSE_API + "save_expense_claims",
            args: { claims: JSON.stringify({ [ticket]: this.payload(this.form, this.draft_modified, this.period) }) },
            freeze: true,
            freeze_message: __("Saving..."),
            callback: (r) => {
                if (!r.message) return;
                let claim = r.message.saved[ticket], message = r.message.errors[ticket] || __("Could not be saved.");
                if (claim) {
                    delete this.drafts[ticket];
                    delete this.problems[ticket];
                } else {
                    this.problems[ticket] = [message];
                }
                if (this.screen !== "ticket" || this.ticket !== ticket) return;  // the popup was left meanwhile
                if (claim) {
                    // What was saved is the form now
                    this.data.claim = claim;
                    this.base = this.form_from_data(this.data);
                    this.form = JSON.parse(JSON.stringify(this.base));
                    this.draft_modified = claim.modified;
                    this.stale = false;
                    this.render_ticket();
                    this.notice("success", __("Saved."));
                } else {
                    this.render_ticket();  // adds the "Not saved: …" banner
                    this.notice("error", message);
                }
            },
            // On an error Frappe shows the server's message and calls only `error`/`always`
            always: () => {
                this.saving = false;
                $btn.prop("disabled", this.screen === "ticket" ? this.save_blocked() : false);
            },
        });
    }

    after_save(saved, problems) {
        Object.assign(this.problems, problems);
        let count = Object.keys(saved).length, skipped = Object.keys(problems);
        let parts = [];
        if (count) parts.push(count === 1 ? __("Saved 1 ticket.") : __("Saved {0} tickets.", [count]));
        if (skipped.length) parts.push(__("Not saved: {0}. Open them to see what needs fixing.", [skipped.join(", ")]));
        this.list_notice = { kind: skipped.length ? "error" : "success", message: parts.join(" ") };
        if (this.screen === "list") {
            this.mark_period();  // dates still being fixed go back to the list's
            this.load_list();  // fresh claims and totals
        }
    }

    export_args() {
        let drafts = {}, args;
        if (this.screen === "list") {
            if (!this.list || !this.list.tickets.length) return;
            this.list.tickets.forEach((t) => {
                let draft = this.drafts[t.name];
                if (draft) drafts[t.name] = this.payload(draft.form, draft.modified, draft.period);
            });
            args = { from_date: this.list.from_date, to_date: this.list.to_date };
        } else {
            if (!this.data) return;
            // Unsaved values are exported as they are, but amounts have to be numbers
            let f = this.form;
            let bad = f.expenses.some((e) => e.amount !== "" && !this.amount_ok(e.amount, true))
                || (f.payable_by_customer === "Yes" && !this.amount_ok(f.amount_collected, true));
            if (bad) {
                this.validate();
                return;
            }
            if (this.drafts[this.ticket]) drafts[this.ticket] = this.payload(f, this.draft_modified, this.period);
            args = { ticket: this.ticket };
        }
        args.drafts = JSON.stringify(drafts);
        return args;
    }

    // Tickets with a claimed amount and their total, i.e. what Print / Excel will contain
    claimed_summary() {
        if (this.screen === "list") {
            let amounts = this.list.tickets
                .map((t) => (this.drafts[t.name] ? this.form_total(this.drafts[t.name].form) : t.claim ? t.claim.total : 0))
                .filter((amount) => amount > 0);
            return { count: amounts.length, total: amounts.reduce((a, b) => a + b, 0), currency: this.list.currency };
        }
        let total = this.form_total(this.form);
        return { count: total > 0 ? 1 : 0, total, currency: this.data.currency };
    }

    // Export Documents: choose Print (the paper form) or Excel
    export_documents() {
        let args = this.export_args();
        if (!args) return;
        let sum = this.claimed_summary();
        if (!sum.count) {
            this.notice("error", __("There are no claimed expenses to export."));
            return;
        }
        let d = new frappe.ui.Dialog({ title: __("Export Documents"), fields: [{ fieldtype: "HTML", fieldname: "choices" }] });
        d.onhide = () => d.$wrapper.remove();
        d.get_field("choices").$wrapper.html(`
            <div style="display:flex; flex-direction:column; gap:10px; padding:6px 0;">
                <div class="text-muted" style="font-size:12px;">
                    ${sum.count === 1 ? __("1 claimed ticket") : __("{0} claimed tickets", [sum.count])} · ${format_currency(sum.total, sum.currency)}
                </div>
                <button type="button" class="btn btn-default btn-block" data-export="print">
                    ${frappe.utils.icon("printer", "sm")} ${__("Print")}</button>
                <button type="button" class="btn btn-default btn-block" data-export="excel">
                    ${frappe.utils.icon("file-spreadsheet", "sm")} ${__("Excel")}</button>
            </div>`);
        d.$wrapper.on("click", "[data-export]", (e) => {
            let kind = e.currentTarget.getAttribute("data-export");
            d.hide();
            if (kind === "print") this.export_print();
            else this.download(TP_EXPENSE_API + "download_expense_claim_excel", args);
        });
        d.show();
    }

    // Print: opens the Print Format PDF of the saved Expense Claim(s)
    export_print() {
        let names = [], unsaved = [];

        if (this.screen === "list") {
            (this.list ? this.list.tickets : []).forEach((t) => {
                let draft = this.drafts[t.name];
                if (draft) {
                    if (this.form_total(draft.form) > 0) unsaved.push(t.name);
                } else if (t.claim && t.claim.total > 0) {
                    names.push(t.claim.name);
                }
            });
        } else if (this.drafts[this.ticket]) {
            unsaved.push(this.ticket);
        } else if (this.data && this.data.claim && this.data.claim.total > 0) {
            names.push(this.data.claim.name);
        }

        if (unsaved.length) {
            frappe.msgprint({
                title: __("Save first"),
                indicator: "orange",
                message: __("Print uses the saved Expense Claim. Please click Save first for: {0}", [unsaved.join(", ")]),
            });
            return;
        }
        if (!names.length) {
            frappe.msgprint(__("There are no saved claimed expenses to print."));
            return;
        }

        let q = { format: TP_EC_PRINT_FORMAT, no_letterhead: 1 };
        let url;
        if (names.length === 1) {
            url = "/api/method/frappe.utils.print_format.download_pdf?" +
                $.param({ doctype: "Expense Claim", name: names[0], ...q });
        } else {
            url = "/api/method/frappe.utils.print_format.download_multi_pdf?" +
                $.param({ doctype: "Expense Claim", name: JSON.stringify(names), ...q });
        }
        window.open(url, "_blank");
    }

    // POST and save the file; on an error show the server's message instead of leaving the page
    async download(method, args) {
        let $btn = this.$footer.find(".tp-ec-share").prop("disabled", true);
        try {
            let res = await fetch(`/api/method/${method}`, {
                method: "POST",
                headers: { "X-Frappe-CSRF-Token": frappe.csrf_token, Accept: "application/json" },
                body: new URLSearchParams(args),
            });
            if (!res.ok) throw new Error(await this.error_message(res));
            let blob = await res.blob();
            let match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(res.headers.get("Content-Disposition") || "");
            let url = URL.createObjectURL(blob);
            let a = document.createElement("a");
            a.href = url;
            a.download = match ? decodeURIComponent(match[1]) : "expense_claim.xlsx";
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 10000);
        } catch (e) {
            frappe.msgprint({ title: __("Share (Excel)"), message: e.message || __("The Excel file could not be made."), indicator: "red" });
        } finally {
            $btn.prop("disabled", false);
        }
    }

    async error_message(res) {
        try {
            let data = await res.json();
            let messages = JSON.parse(data._server_messages || "[]").map((m) => {
                try { return JSON.parse(m).message; } catch (e) { return m; }
            });
            if (messages.length) return messages.join("<br>");
        } catch (e) {
            // not JSON
        }
        return __("The Excel file could not be made.");
    }

    // --- Events -----------------------------------------------------------------------

    bind_events() {
        let $b = this.$body;
        $b.on("click", "[data-range]", (e) => {
            let today = frappe.datetime.get_today();
            let from_date = e.currentTarget.getAttribute("data-range") === "last_week" ? frappe.datetime.add_days(today, -6) : today;
            if (from_date !== this.from_date || today !== this.to_date) this.set_period(from_date, today);
            else this.mark_period();  // e.g. after dates that couldn't be listed
        });
        $b.on("change", ".tp-ec-date", () => {
            let from_date = $b.find('[data-date="from"]').val(), to_date = $b.find('[data-date="to"]').val();
            let problem = this.period_problem(from_date, to_date);
            // While a date is being typed it can be wrong for a moment: say so, keep what's typed
            $b.find(".tp-ec-date").toggleClass("is-invalid", !!problem);
            if (problem) {
                this.list = null;
                this.list_seq = (this.list_seq || 0) + 1;  // an answer still on its way is not shown
                $b.find(".tp-ec-list-wrap").html(`<div class="tp-ec-empty tp-ec-date-problem" role="alert">${this.esc(problem)}</div>`);
                this.render_footer();
                return;
            }
            if (from_date !== this.from_date || to_date !== this.to_date || !this.list) this.set_period(from_date, to_date);
        });
        $b.on("click", ".tp-ec-list-row", (e) => this.open_ticket(e.currentTarget.getAttribute("data-ticket")));
        $b.on("keydown", ".tp-ec-list-row", (e) => {
            if (e.key !== "Enter" && e.key !== " ") return;
            e.preventDefault();
            this.open_ticket(e.currentTarget.getAttribute("data-ticket"));
        });
        $b.on("click", ".tp-ec-back", () => this.show_list());
        $b.on("click", ".tp-ec-ticket-link", (e) => {
            e.preventDefault();
            let ticket = this.ticket;
            this.dialog.hide();
            this.portal.open_ticket_details(ticket);
        });
        $b.on("click", ".tp-ec-discard", () => {
            delete this.drafts[this.ticket];
            delete this.problems[this.ticket];
            this.open_ticket(this.ticket);
        });

        $b.on("input change", ".tp-ec-datebox input", (e) => this.show_date(e.currentTarget));
        $b.on("click", ".tp-ec-datebox input", (e) => {
            if (this.touch) return;  // a tap opens the phone's picker by itself
            try {
                e.currentTarget.showPicker();
            } catch (err) {
                // an older browser: the calendar button still works
            }
        });
        $b.on("input change", "[data-bind]", (e) => {
            let name = e.currentTarget.getAttribute("data-bind");
            this.form[name] = e.currentTarget.value;
            this.clear_error($(e.currentTarget).closest(".tp-ec-field"));
            if (name === "payable_by_customer") {
                $b.find('[data-field="amount_collected"]').prop("hidden", this.form[name] !== "Yes");
            }
            this.on_form_change();
        });
        $b.on("input change", "[data-row]", (e) => {
            let $row = $(e.currentTarget).closest(".tp-ec-row");
            let row = this.find_row($row.attr("data-key"));
            if (!row) return;
            row[e.currentTarget.getAttribute("data-row")] = e.currentTarget.value;
            $(e.currentTarget).removeClass("is-invalid");
            if (!$row.find(".is-invalid").length) $row.children(".tp-ec-error").text("");
            this.on_form_change();
        });
        $b.on("click", ".tp-ec-del", (e) => {
            let $row = $(e.currentTarget).closest(".tp-ec-row");
            this.form.expenses = this.form.expenses.filter((row) => row.key !== $row.attr("data-key"));
            $row.remove();
            this.on_form_change();
        });
        $b.on("click", ".tp-ec-add", () => this.add_row());

        // Without stepper arrows, don't let the mouse wheel change an amount by accident
        $b.on("wheel", "input[type=number]", (e) => {
            if (document.activeElement === e.currentTarget) e.currentTarget.blur();
        });
        // Phones: keep the field being typed in clear of the keyboard and the footer
        $b.on("focusin", "input, select", (e) => {
            if (!this.touch) return;
            setTimeout(() => e.target.scrollIntoView({ block: "center", behavior: "smooth" }), 300);
        });

        this.$footer.on("click", ".tp-ec-share", () => this.export_documents());
        this.$footer.on("click", ".tp-ec-save", () => (this.screen === "list" ? this.save_all() : this.save_ticket()));
    }
}
