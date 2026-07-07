frappe.pages['technician-portal'].on_page_load = function(wrapper) {
    wrapper._dashboard = new TechnicianPortal(wrapper);
};

frappe.pages['technician-portal'].on_page_show = function(wrapper) {
    if (wrapper._dashboard) {
        wrapper._dashboard.load_data();
    }
};

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
        this.render_skeleton();
        this.bind_events();
        this.fetch_user_fullname();
        this.fetch_day_attendance_status();
        this.load_data();
    }
    
    reset_pagination() {
        this.tickets_start = 0;
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
            callback: function(r) {
                if(r.message && r.message.full_name) {
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
            callback: function(r) {
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

        // Fetch location
        if (!navigator.geolocation) {
            frappe.msgprint("Geolocation is not supported by this browser.");
            self.fetch_day_attendance_status();
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                frappe.call({
                    method: "vin_chakra.technician_api.mark_day_attendance",
                    args: {
                        log_type: action,
                        latitude: pos.coords.latitude,
                        longitude: pos.coords.longitude
                    },
                    callback: function(res) {
                        if (res.message && res.message.status === "success") {
                            frappe.show_alert({message: res.message.message, indicator: "green"});
                        } else {
                            frappe.msgprint(res.message ? res.message.message : "Error marking attendance.");
                        }
                        self.fetch_day_attendance_status();
                    },
                    error: function() {
                        self.fetch_day_attendance_status();
                    }
                });
            },
            (err) => {
                btn.prop("disabled", false);
                self.fetch_day_attendance_status();
                let msg = "Failed to fetch GPS coordinates.";
                if (err.code === 1) msg = "Location access denied. Please enable GPS and allow location permissions.";
                else if (err.code === 2) msg = "Location provider unavailable. Ensure GPS is on.";
                else if (err.code === 3) msg = "GPS fetch timeout occurred.";
                frappe.msgprint(msg);
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
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
                        <button id="tp-day-attendance-btn" class="btn btn-sm" style="background: white; color: var(--tp-primary); font-weight: bold; border-radius: 20px; padding: 4px 12px; display: none; box-shadow: 0 2px 4px rgba(0,0,0,0.1); border: none;">
                            <i class="fa fa-sign-in"></i> Day Check-in
                        </button>
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
        
        // Day Attendance
        this.wrapper.on("click", "#tp-day-attendance-btn", function() {
            self.handle_day_attendance_click();
        });
        
        // Toggle Filters
        this.wrapper.on("click", "#tp-btn-filter-toggle", function() {
            $(this).toggleClass("active");
            self.wrapper.find("#tp-filters-panel").slideToggle(200);
        });
        
        // Filters Change
        this.wrapper.on("change", "#tp-filter-status", function() {
            self.filters.status = $(this).val();
            self.reset_pagination();
            self.load_data();
        });
        
        this.wrapper.on("change", "#tp-filter-priority", function() {
            self.filters.priority = $(this).val();
            self.reset_pagination();
            self.load_data();
        });
        
        // Search Input Debounce
        this.wrapper.on("input", "#tp-ticket-search", function() {
            clearTimeout(self.debounce_timer);
            self.debounce_timer = setTimeout(() => {
                self.search_query = $(this).val();
                self.reset_pagination();
                self.load_data();
            }, 400);
        });
        
        // Toggle view types
        this.wrapper.on("click", ".tp-view-btn", function() {
            let view = $(this).data("view");
            self.wrapper.find(".tp-view-btn").removeClass("active");
            $(this).addClass("active");
            self.view_type = view;
            localStorage.setItem("tp_portal_view_type", view);
            self.render_view_structure();
            self.load_data();
        });
        
        // Pagination Buttons
        this.wrapper.on("click", "#tp-tickets-pagination .tp-page-btn", function() {
            let action = $(this).data("action");
            if (action === "prev" && self.tickets_start > 0) {
                self.tickets_start -= self.tickets_length;
            } else if (action === "next" && (self.tickets_start + self.tickets_length) < self.tickets_total) {
                self.tickets_start += self.tickets_length;
            }
            self.load_data();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
        
        // Calendar navigation
        this.wrapper.on("click", ".tp-cal-prev", function() {
            self.calendar_date.setMonth(self.calendar_date.getMonth() - 1);
            self.load_data();
        });
        this.wrapper.on("click", ".tp-cal-next", function() {
            self.calendar_date.setMonth(self.calendar_date.getMonth() + 1);
            self.load_data();
        });
        
        // Clicking Ticket cards/rows
        this.wrapper.on("click", ".tp-ticket-card, .tp-ticket-list-row", function() {
            let ticket_name = $(this).data("name");
            if (ticket_name) {
                self.open_ticket_details(ticket_name);
            }
        });
        
        // Quick filter pill remove
        this.wrapper.on("click", ".tp-pill-remove", function() {
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
        this.wrapper.on("click", ".tp-summary-card", function() {
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
            callback: function(r) {
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
        let container = $("#tp-tickets-container");
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
            let customer = t.custom_customer_name || 'N/A';
            let address = [t.custom_address, t.custom_city__district_].filter(Boolean).join(', ') || 'N/A';
            let date_str = t.custom_date ? frappe.datetime.global_date_format(t.custom_date) : 'N/A';
            
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
                        <div><i class="fa fa-cogs"></i> <span>Machine: ${t.custom_machine_name || 'N/A'}</span></div>
                        <div><i class="fa fa-calendar"></i> <span>Date: ${date_str}</span></div>
                    </div>
                </div>
            `;
        }).join("");
        
        container.removeClass("tp-tickets-list").addClass("tp-tickets-grid").html(html);
    }
    
    render_ticket_list(tickets) {
        let container = $("#tp-tickets-container");
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
            let customer = t.custom_customer_name || 'N/A';
            let address = [t.custom_address, t.custom_city__district_].filter(Boolean).join(', ') || 'N/A';
            
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
                    </div>
                </div>
            `;
        }).join("");
        
        container.removeClass("tp-tickets-grid").addClass("tp-tickets-list").html(html);
    }
    
    render_ticket_calendar(tickets) {
        let container = $("#tp-tickets-container");
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
                    return `
                        <div class="tp-cal-event" data-name="${t.name}" 
                             style="background: var(--tp-primary-light); color: var(--tp-primary); padding: 3px 6px; border-radius: 4px; font-size: 11px; margin-bottom: 4px; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border: 1px solid rgba(99, 102, 241, 0.2); font-weight:600;" 
                             title="${t.subject}">${t.subject}</div>
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
        container.find(".tp-cal-event").on("click", function(e) {
            e.stopPropagation();
            let name = $(this).data("name");
            if (name) {
                self.open_ticket_details(name);
            }
        });
    }
    
    render_tickets_pagination() {
        let container = $("#tp-tickets-pagination");
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
            callback: function(r) {
                if (r.message) {
                    self.show_ticket_detail_dialog(r.message);
                }
            }
        });
    }
    
    show_ticket_detail_dialog(t) {
        let self = this;
        let phone = t.custom_customer_mobile_number || '';
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
                <h4>Customer & Machine Information</h4>
                <div class="tp-modal-meta-grid">
                    <div class="tp-meta-item">
                        <span class="tp-meta-label">Customer Name</span>
                        <span class="tp-meta-value">${t.custom_customer_name || '-'}</span>
                    </div>
                    <div class="tp-meta-item">
                        <span class="tp-meta-label">Mobile Number</span>
                        <span class="tp-meta-value">
                            ${phone ? `<a href="tel:${phone.replace(/[^\d+]/g, '')}" style="color: var(--tp-primary); text-decoration: none; font-weight: 700;"><i class="fa fa-phone"></i> ${phone}</a>` : '-'}
                        </span>
                    </div>
                    <div class="tp-meta-item" style="grid-column: span 2;">
                        <span class="tp-meta-label">Site Address</span>
                        <span class="tp-meta-value">${address}</span>
                    </div>
                    <div class="tp-meta-item">
                        <span class="tp-meta-label">Machine / Asset</span>
                        <span class="tp-meta-value">${t.custom_machine_name || '-'}</span>
                    </div>
                    <div class="tp-meta-item">
                        <span class="tp-meta-label">Machine Problem</span>
                        <span class="tp-meta-value">${t.custom_machine_problem || '-'}</span>
                    </div>
                    <div class="tp-meta-item">
                        <span class="tp-meta-label">Scheduled Date</span>
                        <span class="tp-meta-value">${date_str}</span>
                    </div>
                </div>
            </div>
            
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
        
        // Helper function to fetch user's GPS coords
        function get_location_promise() {
            return new Promise((resolve, reject) => {
                if (!navigator.geolocation) {
                    reject(new Error("Geolocation is not supported by this browser."));
                } else {
                    navigator.geolocation.getCurrentPosition(
                        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
                        (err) => {
                            let msg = "Failed to fetch GPS coordinates.";
                            if (err.code === 1) msg = "Location access denied. Please enable GPS and allow location permissions.";
                            else if (err.code === 2) msg = "Location provider unavailable. Ensure GPS is on.";
                            else if (err.code === 3) msg = "GPS fetch timeout occurred.";
                            reject(new Error(msg));
                        },
                        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
                    );
                }
            });
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
            
            if (ticket.status === 'Resolved' || ticket.status === 'Closed') {
                box.html(`
                    <div style="color: var(--tp-success); font-weight: 700; font-size: 15px; padding: 8px;">
                        <i class="fa fa-check-circle" style="font-size:18px; margin-right:6px; vertical-align:middle;"></i> Service Completed & Checked Out
                    </div>
                `);
            } else if (has_active_check_in || ticket.status === 'Working') {
                box.addClass("tp-action-working").html(`
                    <h4 style="margin:0 0 6px 0; color:var(--tp-primary-dark); font-size:14px; font-weight:700;">Active Session: Working</h4>
                    <p style="font-size:12px; color:var(--tp-text-muted); margin:0 0 16px 0;">You are checked in. Update status once the task is finished.</p>
                    
                    <div style="display:flex; gap:12px; margin-bottom:12px;" id="tp-action-button-row">
                        <button class="tp-btn tp-btn-primary" id="tp-btn-show-checkout"><i class="fa fa-check-square-o"></i> Complete & Check Out</button>
                        <button class="tp-btn tp-btn-warning" id="tp-btn-show-pending"><i class="fa fa-pause-circle"></i> Mark Pending</button>
                    </div>
                    
                    <!-- Check-out OTP input panel -->
                    <div class="tp-otp-wrap" id="tp-otp-box">
                        <p style="font-size:12px; margin:0 0 6px 0; color:var(--tp-text-muted); font-weight:600;">Enter the 4-digit OTP from customer:</p>
                        <input type="text" id="tp-otp-input" class="tp-otp-input" maxlength="4" placeholder="••••" autocomplete="off" pattern="\\d*">
                        <div style="display:flex; gap:8px;">
                            <button class="tp-btn tp-btn-primary" id="tp-btn-submit-checkout">Verify & Check Out</button>
                            <button class="tp-btn" style="background:#e2e8f0; color:#475569;" id="tp-btn-cancel-checkout">Cancel</button>
                        </div>
                    </div>
                    
                    <!-- Mark Pending Reason panel -->
                    <div class="tp-otp-wrap" id="tp-pending-box">
                        <p style="font-size:12px; margin:0 0 6px 0; color:var(--tp-text-muted); font-weight:600;">Enter reason for leaving pending:</p>
                        <textarea id="tp-pending-reason" class="tp-otp-input" style="font-size:13px; text-align:left; letter-spacing:normal; min-height:60px; resize:vertical;" placeholder="E.g., Spare parts unavailable..."></textarea>
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
            
            // Rebind action click listeners inside the dialog
            dialog.$wrapper.find("#tp-btn-checkin").on("click", function() {
                let btn = $(this);
                btn.prop("disabled", true).html('<i class="fa fa-spinner fa-spin"></i> Fetching GPS Coords...');
                
                get_location_promise().then(coords => {
                    btn.html('<i class="fa fa-spinner fa-spin"></i> Checking In...');
                    
                    frappe.call({
                        method: "vin_chakra.technician_api.technician_checkin",
                        args: {
                            ticket_name: ticket.name,
                            latitude: coords.lat,
                            longitude: coords.lng
                        },
                        callback: function(res) {
                            btn.prop("disabled", false);
                            if (res.message && res.message.status === "success") {
                                frappe.show_alert({message: __("Checked in successfully!"), indicator: "green"});
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
            });
            
            // Show OTP Check-out Panel
            dialog.$wrapper.find("#tp-btn-show-checkout").on("click", function() {
                dialog.$wrapper.find("#tp-action-button-row").hide();
                dialog.$wrapper.find("#tp-otp-box").show();
                dialog.$wrapper.find("#tp-otp-input").focus();
            });
            
            dialog.$wrapper.find("#tp-btn-cancel-checkout").on("click", function() {
                dialog.$wrapper.find("#tp-otp-box").hide();
                dialog.$wrapper.find("#tp-action-button-row").show();
            });
            
            // Show Pending Panel
            dialog.$wrapper.find("#tp-btn-show-pending").on("click", function() {
                dialog.$wrapper.find("#tp-action-button-row").hide();
                dialog.$wrapper.find("#tp-pending-box").show();
                dialog.$wrapper.find("#tp-pending-reason").focus();
            });
            
            dialog.$wrapper.find("#tp-btn-cancel-pending").on("click", function() {
                dialog.$wrapper.find("#tp-pending-box").hide();
                dialog.$wrapper.find("#tp-action-button-row").show();
            });
            
            // Submit Check-out with OTP and GPS location
            dialog.$wrapper.find("#tp-btn-submit-checkout").on("click", function() {
                let otpVal = dialog.$wrapper.find("#tp-otp-input").val().trim();
                if (!otpVal || otpVal.length !== 4) {
                    frappe.show_alert({message: __("Please enter a valid 4-digit OTP"), indicator: "red"});
                    return;
                }
                
                let btn = $(this);
                btn.prop("disabled", true).text("Locating GPS...");
                
                get_location_promise().then(coords => {
                    btn.text("Checking Out...");
                    
                    frappe.call({
                        method: "vin_chakra.technician_api.technician_checkout",
                        args: {
                            ticket_name: ticket.name,
                            otp: otpVal,
                            latitude: coords.lat,
                            longitude: coords.lng
                        },
                        callback: function(res) {
                            btn.prop("disabled", false).text("Verify & Check Out");
                            if (res.message && res.message.status === "success") {
                                frappe.show_alert({message: __("Checked out and ticket resolved successfully!"), indicator: "green"});
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
            dialog.$wrapper.find("#tp-btn-submit-pending").on("click", function() {
                let reasonVal = dialog.$wrapper.find("#tp-pending-reason").val().trim();
                if (!reasonVal) {
                    frappe.show_alert({message: __("Please enter the pending reason"), indicator: "red"});
                    return;
                }
                
                let btn = $(this);
                btn.prop("disabled", true).text("Locating GPS...");
                
                get_location_promise().then(coords => {
                    btn.text("Submitting...");
                    
                    frappe.call({
                        method: "vin_chakra.technician_api.technician_mark_pending",
                        args: {
                            ticket_name: ticket.name,
                            reason: reasonVal,
                            latitude: coords.lat,
                            longitude: coords.lng
                        },
                        callback: function(res) {
                            btn.prop("disabled", false).text("Submit & Leave");
                            if (res.message && res.message.status === "success") {
                                frappe.show_alert({message: __("Ticket status set to Pending!"), indicator: "orange"});
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
        
        dialog.show();
    }
}
