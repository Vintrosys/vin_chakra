frappe.pages['chief-technician-das'].on_page_load = function(wrapper) {
    if (!frappe.user.has_role("Chief Technician") && !frappe.user.has_role("System Manager")) {
        frappe.msgprint(__("You do not have permission to access this dashboard."));
        frappe.set_route("app");
        return;
    }
    wrapper._dashboard = new ChiefTechnicianDashboard(wrapper);
};

frappe.pages['chief-technician-das'].on_page_show = function(wrapper) {
    if (wrapper._dashboard) {
        wrapper._dashboard.load_data();
    }
};

class ChiefTechnicianDashboard {
    constructor(wrapper) {
        this.wrapper = $(wrapper);
        this.page = frappe.ui.make_app_page({
            parent: wrapper,
            title: 'Chief Technician Dashboard',
            single_column: true
        });
        
        // State variables
        this.current_tab = "tickets"; // tickets, analytics, movement
        this.view_type = localStorage.getItem("ct_dashboard_view_type") || "card"; // card, list, calendar
        
        // Paginated tickets filter state
        this.tickets_start = 0;
        this.tickets_length = 10;
        this.tickets_total = 0;
        this.filters = {
            date_from: "",
            date_to: "",
            technician: "",
            status: "",
            priority: ""
        };
        this.search_query = "";
        this.debounce_timer = null;
        
        // Paginated movement log state
        this.movement_start = 0;
        this.movement_length = 10;
        this.movement_total = 0;
        
        // Paginated attendance log state
        this.attendance_start = 0;
        this.attendance_length = 10;
        this.attendance_total = 0;
        
        this.calendar_date = new Date();
        this.map = null;
        this.markers_layer = null;
        this.tech_control = null;
        
        this.init();
    }
    
    init() {
        if (!document.getElementById("leaflet-style-link")) {
            let link = document.createElement("link");
            link.id = "leaflet-style-link";
            link.rel = "stylesheet";
            link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
            document.head.appendChild(link);
        }
        this.render_skeleton();
        this.bind_events();
        this.load_data();
    }
    
    reset_pagination() {
        this.tickets_start = 0;
        this.movement_start = 0;
        this.attendance_start = 0;
    }
    
    render_skeleton() {
        this.page.main.addClass("ct-dashboard");
        
        this.page.main.html(`
            <div class="ct-dashboard-wrapper">
                <!-- Header Area -->
                <div class="ct-header-area">
                    <div class="ct-tabs-container">
                        <button class="ct-tab-btn active" data-tab="tickets"><i class="fa fa-ticket"></i> Ticket Board</button>
                        <button class="ct-tab-btn" data-tab="analytics"><i class="fa fa-pie-chart"></i> Analytics & Leaderboard</button>
                        <button class="ct-tab-btn" data-tab="movement"><i class="fa fa-map-marker"></i> Technician Map</button>
                        <button class="ct-tab-btn" data-tab="attendance"><i class="fa fa-clock-o"></i> Attendance</button>
                    </div>
                    
                    <div style="display: flex; gap: 10px; align-items: center;">
                        <button class="ct-filter-btn" id="ct-btn-filter-toggle">
                            <i class="fa fa-filter"></i> Filters
                        </button>
                    </div>
                </div>
                
                <!-- Filters Panel -->
                <div class="ct-filters-panel" id="ct-filters-panel" style="display: none;">
                    <div class="ct-filter-item">
                        <label>From Date</label>
                        <input type="date" id="ct-filter-date-from">
                    </div>
                    <div class="ct-filter-item">
                        <label>To Date</label>
                        <input type="date" id="ct-filter-date-to">
                    </div>
                    <div class="ct-filter-item">
                        <label>Technician</label>
                        <div id="ct-filter-technician-control"></div>
                    </div>
                    <div class="ct-filter-item" id="ct-filter-status-wrap">
                        <label>Status</label>
                        <select id="ct-filter-status">
                            <option value="">All Statuses</option>
                            <option value="Open">Open</option>
                            <option value="Working">Working</option>
                            <option value="Pending">Pending</option>
                            <option value="Resolved">Resolved</option>
                        </select>
                    </div>
                    <div class="ct-filter-item" id="ct-filter-priority-wrap">
                        <label>Priority</label>
                        <select id="ct-filter-priority">
                            <option value="">All Priorities</option>
                            <option value="Low">Low</option>
                            <option value="Medium">Medium</option>
                            <option value="High">High</option>
                            <option value="Urgent">Urgent</option>
                        </select>
                    </div>
                </div>
                
                <!-- Active Filters Area -->
                <div class="ct-active-filters" id="ct-active-filters"></div>
                
                <!-- Summary Cards Row -->
                <div class="ct-summary-row" id="ct-summary-row">
                    <div class="ct-summary-card" data-status="" style="border-top-color: #64748b; cursor: pointer;">
                        <div class="ct-summary-val" id="ct-summary-total">-</div>
                        <div class="ct-summary-label">Total Filtered</div>
                    </div>
                    <div class="ct-summary-card" data-status="Open" style="border-top-color: #64748b; cursor: pointer;">
                        <div class="ct-summary-val" id="ct-summary-open">-</div>
                        <div class="ct-summary-label">Open</div>
                    </div>
                    <div class="ct-summary-card" data-status="Working" style="border-top-color: #0369a1; cursor: pointer;">
                        <div class="ct-summary-val" id="ct-summary-working">-</div>
                        <div class="ct-summary-label">Working</div>
                    </div>
                    <div class="ct-summary-card" data-status="Resolved" style="border-top-color: #15803d; cursor: pointer;">
                        <div class="ct-summary-val" id="ct-summary-resolved">-</div>
                        <div class="ct-summary-label">Resolved</div>
                    </div>
                    <div class="ct-summary-card" data-status="Pending" style="border-top-color: #d97706; cursor: pointer;">
                        <div class="ct-summary-val" id="ct-summary-pending">-</div>
                        <div class="ct-summary-label">Pending</div>
                    </div>
                </div>
                
                <!-- Main Dynamic Views Section -->
                <div class="ct-loader" id="ct-loader" style="display: none;"></div>
                <div id="ct-view-content"></div>
            </div>
        `);
        
        this.render_tech_filter_control();
        this.render_view_structure();
    }
    
    render_tech_filter_control() {
        let self = this;
        this.tech_control = frappe.ui.form.make_control({
            df: {
                fieldtype: "Link",
                options: "User",
                placeholder: "Select Technician",
                onchange: () => {
                    self.filters.technician = self.tech_control.get_value();
                    self.reset_pagination();
                    self.load_data();
                }
            },
            parent: this.wrapper.find("#ct-filter-technician-control"),
            render_input: true
        });
        
        // Remove standard Frappe margins/padding and style the input to match custom inputs
        setTimeout(() => {
            this.tech_control.$wrapper.find('.form-group').css({'margin': '0'});
            this.tech_control.$wrapper.find('.clearfix').hide(); // Hide the empty Frappe label
            this.tech_control.$input.css({
                'background': '#fff', 
                'border': '1px solid #e2e8f0', 
                'border-radius': '6px', 
                'height': '36px', 
                'padding': '0 12px',
                'box-shadow': 'none'
            });
            this.tech_control.$wrapper.css({'background': 'transparent'});
        }, 100);
    }
    
    render_view_structure() {
        if (this.map) {
            try {
                this.map.remove();
            } catch(e) {
                console.error("Error removing Leaflet map:", e);
            }
            this.map = null;
            this.markers_layer = null;
        }

        // Status/Priority filters only apply to the ticket list — hide them
        // on the map tab and attendance tab so it's clear they have no effect there.
        this.wrapper.find("#ct-filter-status-wrap, #ct-filter-priority-wrap")
            .toggle(this.current_tab !== "movement" && this.current_tab !== "attendance");

        let content = this.wrapper.find("#ct-view-content");
        if (this.current_tab === "tickets") {
            content.html(`
                <div class="ct-filter-bar">
                    <div class="ct-search-input-wrap">
                        <i class="fa fa-search"></i>
                        <input type="text" id="ct-ticket-search" placeholder="Search ticket, customer..." value="${this.search_query}">
                    </div>
                    
                    <div class="ct-view-selector">
                        <button class="ct-view-btn ${this.view_type === 'card' ? 'active' : ''}" data-view="card"><i class="fa fa-th"></i> Card</button>
                        <button class="ct-view-btn ${this.view_type === 'list' ? 'active' : ''}" data-view="list"><i class="fa fa-list"></i> List</button>
                        <button class="ct-view-btn ${this.view_type === 'calendar' ? 'active' : ''}" data-view="calendar"><i class="fa fa-calendar"></i> Calendar</button>
                    </div>
                </div>
                
                <div id="ct-tickets-container"></div>
                <div class="ct-pagination" id="ct-tickets-pagination"></div>
            `);
        } else if (this.current_tab === "analytics") {
            content.html(`
                <div class="ct-analytics-grid">
                    <div class="ct-analytics-card">
                        <div class="ct-analytics-card-title"><i class="fa fa-pie-chart"></i> Ticket Status Distribution</div>
                        <div id="ct-chart-status" style="height: 280px;"></div>
                    </div>
                    <div class="ct-analytics-card">
                        <div class="ct-analytics-card-title"><i class="fa fa-bar-chart"></i> Ticket Priority Distribution</div>
                        <div id="ct-chart-priority" style="height: 280px;"></div>
                    </div>
                    <div class="ct-analytics-card" style="grid-column: span 2;">
                        <div class="ct-analytics-card-title"><i class="fa fa-trophy"></i> Technician Performance Leaderboard</div>
                        <div id="ct-leaderboard-container"></div>
                    </div>
                </div>
            `);
        } else if (this.current_tab === "movement") {
            content.html(`
                <div class="ct-movement-layout">
                    <div style="position: relative;">
                        <div class="ct-map-container" id="ct-movement-map"></div>
                        <div class="ct-map-legend" id="ct-map-legend">
                            <div style="font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; margin-bottom: 4px;">Map Legend</div>
                            <div class="ct-map-legend-item"><div class="ct-map-legend-dot" style="background: #3b82f6;"></div> Check-in</div>
                            <div class="ct-map-legend-item"><div class="ct-map-legend-dot" style="background: #10b981;"></div> Check-out</div>
                            <div id="ct-map-legend-routes"></div>
                        </div>
                    </div>
                    <div class="ct-logs-container">
                        <div class="ct-analytics-card-title"><i class="fa fa-history"></i> Recent Check Logs
                            <span style="font-size: 11px; font-weight: 500; color: var(--ct-text-muted); margin-left: 8px;">(grouped by location, then chained by time)</span>
                        </div>
                        <div class="ct-logs-list" id="ct-logs-list"></div>
                        <div class="ct-pagination" id="ct-logs-pagination"></div>
                    </div>
                </div>
            `);
            this.init_map();
        } else if (this.current_tab === "attendance") {
            content.html(`
                <div class="ct-attendance-layout" style="background: white; border: 1px solid var(--ct-border); border-radius: var(--ct-radius); padding: 20px; box-shadow: var(--ct-shadow-sm);">
                    <div class="ct-analytics-card-title" style="margin-bottom: 16px;"><i class="fa fa-clock-o"></i> Technician Day Attendance Logs</div>
                    <div id="ct-attendance-list-container"></div>
                    <div class="ct-pagination" id="ct-attendance-pagination" style="margin-top: 20px;"></div>
                </div>
            `);
        }
    }
    
    init_map() {
        let self = this;
        setTimeout(() => {
            if (!self.map && $("#ct-movement-map").length) {
                frappe.require([
                    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
                    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
                ], function() {
                    let map_el = $("#ct-movement-map")[0];
                    self.map = L.map(map_el).setView([20.5937, 78.9629], 5);
                    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                        attribution: '© OpenStreetMap contributors'
                    }).addTo(self.map);
                    self.markers_layer = L.layerGroup().addTo(self.map);
                    self.load_movement_data();
                });
            } else if (self.map) {
                self.map.invalidateSize();
                self.load_movement_data();
            }
        }, 150);
    }
    
    bind_events() {
        let self = this;
        
        // Tab switching
        this.wrapper.on("click", ".ct-tab-btn", function() {
            let tab = $(this).data("tab");
            self.wrapper.find(".ct-tab-btn").removeClass("active");
            $(this).addClass("active");
            self.current_tab = tab;
            self.render_view_structure();
            self.load_data();
        });
        
        // View switching
        this.wrapper.on("click", ".ct-view-btn", function() {
            let view = $(this).data("view");
            self.wrapper.find(".ct-view-btn").removeClass("active");
            $(this).addClass("active");
            self.view_type = view;
            localStorage.setItem("ct_dashboard_view_type", view);
            self.render_view_structure();
            self.load_data();
        });
        
        // Search input debounce
        this.wrapper.on("input", "#ct-ticket-search", function() {
            clearTimeout(self.debounce_timer);
            self.debounce_timer = setTimeout(() => {
                self.search_query = $(this).val();
                self.reset_pagination();
                self.load_data();
            }, 400);
        });
        
        // Filter elements change
        this.wrapper.on("change", "#ct-filter-status", function() {
            self.filters.status = $(this).val();
            self.reset_pagination();
            self.load_data();
        });
        
        this.wrapper.on("change", "#ct-filter-priority", function() {
            self.filters.priority = $(this).val();
            self.reset_pagination();
            self.load_data();
        });
        
        this.wrapper.on("change", "#ct-filter-date-from", function() {
            self.filters.date_from = $(this).val();
            self.reset_pagination();
            self.load_data();
        });
        
        this.wrapper.on("change", "#ct-filter-date-to", function() {
            self.filters.date_to = $(this).val();
            self.reset_pagination();
            self.load_data();
        });
        
        // Toggle Filters Panel
        this.wrapper.on("click", "#ct-btn-filter-toggle", function() {
            $(this).toggleClass("active");
            self.wrapper.find("#ct-filters-panel").slideToggle(200);
        });
        
        // Calendar navigation
        this.wrapper.on("click", ".ct-cal-prev", function() {
            self.calendar_date.setMonth(self.calendar_date.getMonth() - 1);
            self.load_data();
        });
        this.wrapper.on("click", ".ct-cal-next", function() {
            self.calendar_date.setMonth(self.calendar_date.getMonth() + 1);
            self.load_data();
        });
        
        // Pagination clicks - Tickets
        this.wrapper.on("click", "#ct-tickets-pagination .ct-page-btn", function() {
            let action = $(this).data("action");
            if (action === "prev" && self.tickets_start > 0) {
                self.tickets_start -= self.tickets_length;
            } else if (action === "next" && (self.tickets_start + self.tickets_length) < self.tickets_total) {
                self.tickets_start += self.tickets_length;
            }
            self.load_data();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
        
        // Pagination clicks - Movement logs
        this.wrapper.on("click", "#ct-logs-pagination .ct-page-btn", function() {
            let action = $(this).data("action");
            if (action === "prev" && self.movement_start > 0) {
                self.movement_start -= self.movement_length;
            } else if (action === "next" && (self.movement_start + self.movement_length) < self.movement_total) {
                self.movement_start += self.movement_length;
            }
            self.load_data();
        });
        
        // Pagination clicks - Attendance logs
        this.wrapper.on("click", "#ct-attendance-pagination .ct-page-btn", function() {
            let action = $(this).data("action");
            if (action === "prev" && self.attendance_start > 0) {
                self.attendance_start -= self.attendance_length;
            } else if (action === "next" && (self.attendance_start + self.attendance_length) < self.attendance_total) {
                self.attendance_start += self.attendance_length;
            }
            self.load_data();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
        
        // Summary Cards click filter
        this.wrapper.on("click", ".ct-summary-card", function() {
            let status = $(this).data("status");
            self.filters.status = status;
            self.wrapper.find("#ct-filter-status").val(status);
            self.reset_pagination();
            self.load_data();
        });
    }
    
    load_data() {
        this.render_active_filters();
        this.wrapper.find("#ct-loader").show();
        
        if (this.current_tab === "tickets") {
            this.load_tickets_data();
        } else if (this.current_tab === "analytics") {
            this.load_analytics_data();
        } else if (this.current_tab === "movement") {
            this.load_movement_data();
        } else if (this.current_tab === "attendance") {
            this.load_attendance_data();
        }
    }
    
    load_tickets_data() {
        let self = this;
        let limit_start = this.tickets_start;
        let limit_len = this.tickets_length;
        
        // In calendar mode, load all tickets in the current month range to plot them
        if (this.view_type === "calendar") {
            limit_start = 0;
            limit_len = 1000;
        }
        
        frappe.call({
            method: "vin_chakra.vin_chakra.page.chief_technician_das.chief_technician_das.get_dashboard_data",
            args: {
                date_from: this.filters.date_from,
                date_to: this.filters.date_to,
                technician: this.filters.technician,
                status: this.filters.status,
                priority: this.filters.priority,
                search_query: this.search_query,
                limit_start: limit_start,
                limit_page_length: limit_len,
                view: "tickets"
            },
            callback: function(r) {
                self.wrapper.find("#ct-loader").hide();
                if (r.message) {
                    let data = r.message;
                    self.tickets_total = data.total_count;
                    
                    // Update Summary Row
                    self.update_summary_row(data.summary);
                    
                    // Render Tickets
                    if (self.view_type === "card") {
                        self.render_ticket_cards(data.tickets);
                        self.render_tickets_pagination();
                    } else if (self.view_type === "list") {
                        self.render_ticket_list(data.tickets);
                        self.render_tickets_pagination();
                    } else if (self.view_type === "calendar") {
                        self.render_ticket_calendar(data.tickets);
                        $("#ct-tickets-pagination").empty();
                    }
                }
            }
        });
    }
    
    update_summary_row(summary) {
        this.wrapper.find("#ct-summary-total").text(summary.Total);
        this.wrapper.find("#ct-summary-open").text(summary.Open);
        this.wrapper.find("#ct-summary-working").text(summary.Working);
        this.wrapper.find("#ct-summary-resolved").text(summary.Resolved);
        this.wrapper.find("#ct-summary-pending").text(summary.Pending);
    }
    
    render_ticket_cards(tickets) {
        let container = $("#ct-tickets-container");
        if (!tickets || tickets.length === 0) {
            container.html(`
                <div class="ct-empty-state">
                    <i class="fa fa-ticket"></i>
                    <h3>No tickets found</h3>
                    <p>Try adjusting your filters or search query.</p>
                </div>
            `);
            return;
        }
        
        let html = tickets.map(t => {
            let assignees = [];
            try { assignees = JSON.parse(t._assign || "[]"); } catch (e) { assignees = []; }
            let avatars = assignees.slice(0, 3).map(u => {
                let initial = u.charAt(0).toUpperCase();
                return `<div class="ct-assignee-avatar" title="${u}">${initial}</div>`;
            }).join("");
            
            let status_badge = `<span class="ct-badge ct-badge-status-${t.status.replace(/\s+/g, '')}" onclick="event.stopPropagation(); frappe.pages['chief-technician-das']._dashboard.open_status_change_dialog('${t.name}', '${t.status}')" style="cursor:pointer;" title="Change status">${t.status} <i class="fa fa-pencil" style="font-size:8px; margin-left:2px;"></i></span>`;
            let priority_badge = `<span class="ct-badge ct-badge-priority-${t.priority}">${t.priority}</span>`;
            
            return `
                <div class="ct-ticket-card" onclick="window.location.href='/helpdesk/tickets/${t.name}'">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span class="ct-ticket-id">${t.name}</span>
                        <div class="ct-card-badges">${status_badge}${priority_badge}</div>
                    </div>
                    <h3 class="ct-ticket-subject">${t.custom_customer_name || 'N/A'}</h3>
                    
                    <div class="ct-card-meta">
                        <div><i class="fa fa-user"></i> <span>Customer: <strong>${t.custom_customer_name || 'N/A'}</strong></span></div>
                        <div><i class="fa fa-cogs"></i> <span>Machine: ${t.custom_machine_name || 'N/A'}</span></div>
                        <div><i class="fa fa-calendar-o"></i> <span>Date: ${t.custom_date ? frappe.datetime.global_date_format(t.custom_date) : 'N/A'}</span></div>
                    </div>
                    
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px;">
                        <div class="ct-assignees">${avatars}${assignees.length > 3 ? `<span class="ct-more-assignees" style="font-size:10px; font-weight:700; color:var(--ct-text-light); margin-left:6px;">+${assignees.length - 3}</span>` : ""}</div>
                    </div>
                </div>
            `;
        }).join("");
        
        container.removeClass("ct-tickets-list").addClass("ct-tickets-grid").html(html);
    }
    
    render_ticket_list(tickets) {
        let container = $("#ct-tickets-container");
        if (!tickets || tickets.length === 0) {
            container.html(`
                <div class="ct-empty-state">
                    <i class="fa fa-ticket"></i>
                    <h3>No tickets found</h3>
                    <p>Try adjusting your filters or search query.</p>
                </div>
            `);
            return;
        }
        
        let html = tickets.map(t => {
            let assignees = [];
            try { assignees = JSON.parse(t._assign || "[]"); } catch (e) { assignees = []; }
            let avatars = assignees.slice(0, 3).map(u => {
                let initial = u.charAt(0).toUpperCase();
                return `<div class="ct-assignee-avatar" title="${u}">${initial}</div>`;
            }).join("");
            
            let status_badge = `<span class="ct-badge ct-badge-status-${t.status.replace(/\s+/g, '')}" onclick="event.stopPropagation(); frappe.pages['chief-technician-das']._dashboard.open_status_change_dialog('${t.name}', '${t.status}')" style="cursor:pointer;" title="Change status">${t.status} <i class="fa fa-pencil" style="font-size:8px; margin-left:2px;"></i></span>`;
            let priority_badge = `<span class="ct-badge ct-badge-priority-${t.priority}">${t.priority}</span>`;
            
            return `
                <div class="ct-ticket-list-row" onclick="window.location.href='/helpdesk/tickets/${t.name}'">
                    <div class="ct-list-subject-col">
                        <span class="ct-ticket-id">${t.name}</span>
                        <h3 class="ct-ticket-subject" style="margin: 0; font-size:14px;">${t.subject}</h3>
                    </div>
                    <div class="ct-list-badges-col">
                        ${status_badge}
                        ${priority_badge}
                    </div>
                    <div class="ct-list-meta-col">
                        <div><strong>Cust:</strong> ${t.custom_customer_name || 'N/A'}</div>
                        <div><strong>Machine:</strong> ${t.custom_machine_name || 'N/A'}</div>
                    </div>
                    <div class="ct-list-assignees-col">
                        <div class="ct-assignees">${avatars}</div>
                    </div>
                </div>
            `;
        }).join("");
        
        container.removeClass("ct-tickets-grid").addClass("ct-tickets-list").html(html);
    }
    
    render_ticket_calendar(tickets) {
        let container = $("#ct-tickets-container");
        container.removeClass("ct-tickets-grid ct-tickets-list");
        
        let month = this.calendar_date.getMonth();
        let year = this.calendar_date.getFullYear();
        let firstDay = new Date(year, month, 1).getDay();
        let daysInMonth = new Date(year, month + 1, 0).getDate();

        let html = `
            <div class="ct-calendar-wrapper" style="background: white; border: 1px solid var(--ct-border); border-radius: var(--ct-radius); padding: 20px; box-shadow: var(--ct-shadow-sm); overflow-x: auto;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 20px; align-items: center;">
                    <button class="btn btn-default btn-sm ct-cal-prev"><i class="fa fa-chevron-left"></i> Prev</button>
                    <h3 style="margin: 0; font-size: 16px; font-weight:700;"><i class="fa fa-calendar" style="color: var(--ct-primary); margin-right: 8px;"></i>${this.calendar_date.toLocaleString('default', { month: 'long' })} ${year}</h3>
                    <button class="btn btn-default btn-sm ct-cal-next">Next <i class="fa fa-chevron-right"></i></button>
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
                html += `<td style="height: 100px; background: #f9fafb; border: 1px solid #e2e8f0;"></td>`;
            } else {
                let currentDay = d;
                let day_tickets = ticketsByDate[currentDay] || [];
                let tickets_html = day_tickets.map(t => {
                    return `
                        <div class="ct-cal-event" onclick="window.location.href='/helpdesk/tickets/${t.name}'" 
                             style="background: var(--ct-primary-light); color: var(--ct-primary); padding: 3px 6px; border-radius: 4px; font-size: 11px; margin-bottom: 4px; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border: 1px solid rgba(99, 102, 241, 0.2); font-weight:600;" 
                             title="${t.subject}">${t.subject}</div>
                    `;
                }).join("");
                
                html += `
                    <td style="height: 100px; vertical-align: top; position: relative; border: 1px solid #e2e8f0; padding: 6px;">
                        <div style="font-weight: 700; margin-bottom: 6px; font-size: 12px; color: var(--ct-text-muted); text-align: right;">${d}</div>
                        <div style="max-height: 70px; overflow-y: auto;">${tickets_html}</div>
                    </td>
                `;
                d++;
            }
        }
        
        html += `</tr></tbody></table></div>`;
        container.html(html);
    }
    
    render_tickets_pagination() {
        let container = $("#ct-tickets-pagination");
        if (this.tickets_total <= this.tickets_length) {
            container.empty();
            return;
        }
        
        let current_page = Math.floor(this.tickets_start / this.tickets_length) + 1;
        let total_pages = Math.ceil(this.tickets_total / this.tickets_length);
        
        container.html(`
            <button class="ct-page-btn" data-action="prev" ${this.tickets_start === 0 ? "disabled" : ""}>
                <i class="fa fa-chevron-left"></i> Previous
            </button>
            <div class="ct-page-info">Page ${current_page} of ${total_pages}</div>
            <button class="ct-page-btn" data-action="next" ${(this.tickets_start + this.tickets_length) >= this.tickets_total ? "disabled" : ""}>
                Next <i class="fa fa-chevron-right"></i>
            </button>
        `);
    }
    
    load_analytics_data() {
        let self = this;
        frappe.call({
            method: "vin_chakra.vin_chakra.page.chief_technician_das.chief_technician_das.get_dashboard_data",
            args: {
                date_from: this.filters.date_from,
                date_to: this.filters.date_to,
                technician: this.filters.technician,
                search_query: this.search_query,
                view: "analytics"
            },
            callback: function(r) {
                self.wrapper.find("#ct-loader").hide();
                if (r.message) {
                    let data = r.message;
                    
                    // Render Status Chart
                    let status_labels = data.status_summary.map(d => d.status);
                    let status_values = data.status_summary.map(d => d.count);
                    
                    $("#ct-chart-status").empty();
                    new frappe.Chart("#ct-chart-status", {
                        data: {
                            labels: status_labels,
                            datasets: [{ values: status_values }]
                        },
                        type: 'donut',
                        height: 250,
                        colors: ['#6366f1', '#10b981', '#f59e0b', '#ef4444']
                    });
                    
                    // Render Priority Chart
                    let priority_labels = data.priority_summary.map(d => d.priority);
                    let priority_values = data.priority_summary.map(d => d.count);
                    
                    $("#ct-chart-priority").empty();
                    new frappe.Chart("#ct-chart-priority", {
                        data: {
                            labels: priority_labels,
                            datasets: [{ values: priority_values }]
                        },
                        type: 'bar',
                        height: 250,
                        colors: ['#10b981', '#f59e0b', '#ea580c', '#ef4444']
                    });
                    
                    // Render Leaderboard
                    self.render_leaderboard(data.performance);
                }
            }
        });
    }
    
    render_leaderboard(performance) {
        let container = $("#ct-leaderboard-container");
        if (!performance || performance.length === 0) {
            container.html(`<div class="ct-empty-state"><p>No technician performance records found.</p></div>`);
            return;
        }
        
        let html = `<ul class="ct-leaderboard-list">`;
        performance.forEach(d => {
            let percent = d.total_assigned ? Math.round((d.total_resolved / d.total_assigned) * 100) : 0;
            let full_name = frappe.user.full_name(d.assigned_to) || d.assigned_to;
            html += `
                <li class="ct-leaderboard-item">
                    <div class="ct-leaderboard-header">
                        <span class="ct-leaderboard-name"><strong>${full_name}</strong></span>
                        <span class="ct-leaderboard-stats">Resolved: <strong>${d.total_resolved}</strong> / Total: ${d.total_assigned} (${percent}%)</span>
                    </div>
                    <div class="ct-leaderboard-bar-outer">
                        <div class="ct-leaderboard-bar-inner" style="width: ${percent}%;"></div>
                    </div>
                </li>
            `;
        });
        html += `</ul>`;
        container.html(html);
    }
    
    load_movement_data() {
        let self = this;
        frappe.call({
            method: "vin_chakra.vin_chakra.page.chief_technician_das.chief_technician_das.get_dashboard_data",
            args: {
                date_from: this.filters.date_from,
                date_to: this.filters.date_to,
                technician: this.filters.technician,
                search_query: this.search_query,
                limit_start: this.movement_start,
                limit_page_length: this.movement_length,
                view: "movement"
            },
            callback: function(r) {
                self.wrapper.find("#ct-loader").hide();
                if (r.message) {
                    let data = r.message;
                    self.movement_total = data.total_count;
                    
                    // Render Logs List
                    self.render_logs_list(data.movement);
                    self.render_logs_pagination();
                    
                    // Render Map Markers & Location-Chained Route
                    self.render_movement_map(data.map_points || []);
                }
            }
        });
    }

    /* ─────────────────────────────────────────────────────────────────
       RENDER MOVEMENT MAP
       Route logic (per technician):
       1. Group that technician's logs by TICKET — each ticket is one
          job/location, so this naturally pairs its Check-in + Check-out
          together instead of letting raw timestamps interleave them
          with a *different* location's logs that happened to fall in
          between.
       2. Within a location, order its own logs chronologically
          (Check-in → Check-out).
       3. Order the locations themselves by each location's earliest
          timestamp — i.e. "when did the technician first arrive here".
       4. Flatten: this connects Check-in→Check-out at location A first,
          then A's last point → location B's Check-in, and so on —
          exactly the chaining behaviour requested, and it can no longer
          zig-zag between two locations whose visits overlapped in time.
    ───────────────────────────────────────────────────────────────── */
    render_movement_map(map_points) {
        let self = this;
        if (!self.map || !self.markers_layer) return;

        self.markers_layer.clearLayers();
        let bounds = [];
        let valid_points = map_points.filter(log => log.latitude && log.longitude);

        // Group by technician — each technician gets their own route/color
        let tech_groups = {};
        valid_points.forEach(log => {
            if (!tech_groups[log.user]) tech_groups[log.user] = [];
            tech_groups[log.user].push(log);
        });

        let route_colors = ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#3b82f6', '#8b5cf6'];
        let color_idx = 0;
        let legend_html = "";

        Object.keys(tech_groups).forEach(tech => {
            let tech_logs = tech_groups[tech];
            let tech_color = route_colors[color_idx % route_colors.length];
            color_idx++;

            let tech_name = frappe.user.full_name(tech) || tech;
            legend_html += `
                <div class="ct-map-legend-item">
                    <div style="width:16px; height:3px; background:${tech_color}; border-radius:2px;"></div>
                    ${tech_name}
                </div>`;

            // Step 1 — group this technician's logs by location (ticket)
            let location_groups = {};
            tech_logs.forEach(log => {
                let key = log.ticket || log.name;
                if (!location_groups[key]) location_groups[key] = [];
                location_groups[key].push(log);
            });

            // Step 2 — within each location, sort chronologically (Check-in → Check-out)
            // Step 3 — order locations by their own earliest timestamp
            let location_blocks = Object.keys(location_groups).map(ticket => {
                let logs_here = location_groups[ticket].slice().sort(
                    (a, b) => new Date(a.creation) - new Date(b.creation)
                );
                return { ticket: ticket, logs: logs_here, start_time: new Date(logs_here[0].creation) };
            }).sort((a, b) => a.start_time - b.start_time);

            // Step 4 — flatten into one travel-ordered sequence
            let ordered_logs = [];
            location_blocks.forEach(block => ordered_logs.push(...block.logs));

            if (ordered_logs.length > 1) {
                let path_coords = ordered_logs.map(log => [log.latitude, log.longitude]);

                L.polyline(path_coords, {
                    color: tech_color,
                    weight: 4,
                    opacity: 0.85,
                    lineJoin: 'round'
                }).addTo(self.markers_layer);

                // Directional chevrons along the chained route.
                // A hop within the same location (check-in↔check-out) is drawn
                // solid; a hop moving to the NEXT location is drawn lighter,
                // so the map visually distinguishes "on-site" from "travel".
                for (let i = 0; i < path_coords.length - 1; i++) {
                    let p1 = path_coords[i];
                    let p2 = path_coords[i + 1];
                    let mid_lat = (p1[0] + p2[0]) / 2;
                    let mid_lng = (p1[1] + p2[1]) / 2;

                    let dy = p2[0] - p1[0];
                    let dx = p2[1] - p1[1];
                    let angle = Math.atan2(dy, dx) * 180 / Math.PI;

                    let same_location = ordered_logs[i].ticket === ordered_logs[i + 1].ticket;

                    let arrowIcon = L.divIcon({
                        className: 'route-arrow-icon',
                        html: `<div style="transform: rotate(${angle}deg); color: ${tech_color}; font-size: 12px; display: flex; align-items: center; justify-content: center; opacity:${same_location ? 1 : 0.55};"><i class="fa fa-chevron-right"></i></div>`,
                        iconSize: [16, 16],
                        iconAnchor: [8, 8]
                    });
                    L.marker([mid_lat, mid_lng], {icon: arrowIcon, interactive: false}).addTo(self.markers_layer);
                }
            }

            // Numbered markers, in the new location-chained travel order
            ordered_logs.forEach((log, index) => {
                let pin_color = log.check_type == 'Check-in' ? '#3b82f6' : '#10b981';
                let time_only = frappe.datetime.get_time(log.creation).substring(0, 5);
                let icon_html = `
                    <div class="map-route-marker" style="background-color:${pin_color}; color:white; border-radius:50%; width:26px; height:26px; display:flex; align-items:center; justify-content:center; font-weight:800; border:2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3); font-size:11px;" title="${log.check_type} at ${time_only}">
                        ${index + 1}
                    </div>
                `;

                let customIcon = L.divIcon({
                    className: 'custom-div-icon',
                    html: icon_html,
                    iconSize: [26, 26],
                    iconAnchor: [13, 13]
                });

                let marker = L.marker([log.latitude, log.longitude], {icon: customIcon});
                let popup_html = `
                    <div style="font-family: 'Inter', sans-serif; padding: 4px; width: 220px;">
                        <div style="font-weight: 800; font-size: 13px; margin-bottom: 4px; color: var(--ct-text-main);">
                            ${frappe.user.full_name(log.user) || log.user}
                        </div>
                        <div style="margin-bottom: 6px;">
                            <span class="badge" style="background-color: ${pin_color}; color: white; font-size: 9px; padding: 2px 5px; text-transform: uppercase;">${log.check_type} #${index + 1}</span>
                            <span style="font-size: 11px; color: var(--ct-text-muted); float: right; font-weight: 600;">${time_only}</span>
                        </div>
                        <div style="font-size: 12px; line-height: 1.4; border-top: 1px solid #f1f5f9; padding-top: 6px;">
                            <strong>Ticket:</strong> <a onclick="window.location.href='/helpdesk/tickets/${log.ticket}'" style="cursor:pointer; color:var(--ct-primary); font-weight: 700;">${log.ticket}</a><br>
                            <strong>Customer:</strong> ${log.customer || 'N/A'}<br>
                            <strong>Address:</strong> <span style="color: #475569;">${log.location_address || 'N/A'}</span>
                        </div>
                    </div>
                `;
                marker.bindPopup(popup_html);
                self.markers_layer.addLayer(marker);
                bounds.push([log.latitude, log.longitude]);
            });
        });

        $("#ct-map-legend-routes").html(legend_html);

        if (bounds.length > 0) {
            self.map.fitBounds(bounds, {padding: [50, 50]});
        }
    }
    
    render_logs_list(logs) {
        let container = $("#ct-logs-list");
        if (!logs || logs.length === 0) {
            container.html(`<div class="ct-empty-state"><p>No movement logs found.</p></div>`);
            return;
        }
        
        let html = logs.map(log => {
            let badge_color = log.check_type === 'Check-in' ? 'badge-check-in' : 'badge-check-out';
            let action_badge = `<span class="badge-custom ${badge_color}" style="padding: 2px 6px; border-radius: 9999px; font-size: 11px; font-weight: 600; display: inline-block;">${log.check_type}</span>`;
            let full_name = frappe.user.full_name(log.user) || log.user;
            
            return `
                <div class="ct-log-row">
                    <div class="ct-log-header">
                        <span class="ct-log-tech">${full_name} ${action_badge}</span>
                        <span class="ct-log-time">${frappe.datetime.global_date_format(log.creation)} ${frappe.datetime.get_time(log.creation)}</span>
                    </div>
                    <div class="ct-log-details">
                        <strong>Ticket:</strong> <a onclick="window.location.href='/helpdesk/tickets/${log.ticket}'" style="cursor:pointer; color:var(--ct-primary);">${log.ticket}</a> - ${log.subject || 'No Subject'}<br>
                        <strong>Cust:</strong> ${log.customer || 'N/A'}<br>
                        <strong>Loc:</strong> ${log.location_address || 'Latitude: ' + log.latitude + ', Longitude: ' + log.longitude}
                    </div>
                </div>
            `;
        }).join("");
        container.html(html);
    }
    
    render_logs_pagination() {
        let container = $("#ct-logs-pagination");
        if (this.movement_total <= this.movement_length) {
            container.empty();
            return;
        }
        
        let current_page = Math.floor(this.movement_start / this.movement_length) + 1;
        let total_pages = Math.ceil(this.movement_total / this.movement_length);
        
        container.html(`
            <button class="ct-page-btn" data-action="prev" ${this.movement_start === 0 ? "disabled" : ""}>
                Prev
            </button>
            <div class="ct-page-info">${current_page} / ${total_pages}</div>
            <button class="ct-page-btn" data-action="next" ${(this.movement_start + this.movement_length) >= this.movement_total ? "disabled" : ""}>
                Next
            </button>
        `);
    }
    
    render_active_filters() {
        let container = this.wrapper.find("#ct-active-filters");
        if (!container.length) return;
        
        // Sync active class on summary cards
        let current_status = this.filters.status || "";
        this.wrapper.find(".ct-summary-card").removeClass("active");
        this.wrapper.find(`.ct-summary-card[data-status="${current_status}"]`).addClass("active");

        let pills_html = "";
        if (this.filters.date_from) pills_html += `<span class="ct-filter-pill">From: ${this.filters.date_from} <i class="fa fa-times ct-filter-remove" data-key="date_from"></i></span>`;
        if (this.filters.date_to) pills_html += `<span class="ct-filter-pill">To: ${this.filters.date_to} <i class="fa fa-times ct-filter-remove" data-key="date_to"></i></span>`;
        if (this.filters.technician) {
            let full_name = frappe.user.full_name(this.filters.technician) || this.filters.technician;
            pills_html += `<span class="ct-filter-pill">Tech: ${full_name} <i class="fa fa-times ct-filter-remove" data-key="technician"></i></span>`;
        }
        if (this.filters.status) pills_html += `<span class="ct-filter-pill">Status: ${this.filters.status} <i class="fa fa-times ct-filter-remove" data-key="status"></i></span>`;
        if (this.filters.priority) pills_html += `<span class="ct-filter-pill">Priority: ${this.filters.priority} <i class="fa fa-times ct-filter-remove" data-key="priority"></i></span>`;
        if (this.search_query) pills_html += `<span class="ct-filter-pill">Search: ${this.search_query} <i class="fa fa-times ct-filter-remove" data-key="search"></i></span>`;
        
        container.html(pills_html);
        
        // Remove filters
        let self = this;
        container.off("click", ".ct-filter-remove").on("click", ".ct-filter-remove", function() {
            let key = $(this).data("key");
            if (key === "technician") {
                self.tech_control.set_value("");
            } else if (key === "search") {
                self.search_query = "";
                self.wrapper.find("#ct-ticket-search").val("");
            } else {
                self.filters[key] = "";
                self.wrapper.find("#ct-filter-" + key.replace("_", "-")).val("");
            }
            self.reset_pagination();
            self.load_data();
        });
    }
    
    open_status_change_dialog(ticket_id, current_status) {
        let self = this;
        let d = new frappe.ui.Dialog({
            title: __("Change Ticket Status"),
            fields: [
                { label: "New Status", fieldname: "status", fieldtype: "Select", options: ["Open", "Working", "Pending", "Resolved"], default: current_status, reqd: 1 }
            ],
            primary_action_label: __("Update"),
            primary_action: (v) => {
                d.get_primary_btn().prop('disabled', true);
                frappe.call({
                    method: "frappe.client.set_value",
                    args: {
                        doctype: "HD Ticket",
                        name: ticket_id,
                        fieldname: "status",
                        value: v.status
                    },
                    callback: (r) => {
                        d.get_primary_btn().prop('disabled', false);
                        if (!r.exc) {
                            frappe.show_alert({ message: __("Status updated successfully"), indicator: "green" });
                            d.hide();
                            self.load_data();
                        }
                    }
                });
            }
        });
        d.show();
    }
    
    load_attendance_data() {
        let self = this;
        frappe.call({
            method: "vin_chakra.vin_chakra.page.chief_technician_das.chief_technician_das.get_dashboard_data",
            args: {
                date_from: this.filters.date_from,
                date_to: this.filters.date_to,
                technician: this.filters.technician,
                limit_start: this.attendance_start,
                limit_page_length: this.attendance_length,
                view: "attendance"
            },
            callback: function(r) {
                self.wrapper.find("#ct-loader").hide();
                if (r.message) {
                    let data = r.message;
                    self.attendance_total = data.total_count;
                    self.render_attendance_list(data.attendance);
                    self.render_attendance_pagination();
                }
            }
        });
    }

    render_attendance_list(logs) {
        let container = $("#ct-attendance-list-container");
        if (!logs || logs.length === 0) {
            container.html(`
                <div class="ct-empty-state">
                    <i class="fa fa-clock-o"></i>
                    <h3>No attendance records found</h3>
                    <p>Try adjusting your filters.</p>
                </div>
            `);
            return;
        }

        let html = `<table class="table table-bordered table-hover" style="font-size: 13px; margin: 0;">
            <thead>
                <tr style="background-color: #f8fafc;">
                    <th>Employee Name</th>
                    <th>Log Type</th>
                    <th>Time</th>
                    <th>Location (GPS)</th>
                    <th>Device ID</th>
                </tr>
            </thead>
            <tbody>`;

        logs.forEach(log => {
            let log_type_badge = log.log_type === "IN" 
                ? `<span class="badge" style="background: #dcfce7; color: #15803d;">IN</span>`
                : `<span class="badge" style="background: #fee2e2; color: #b91c1c;">OUT</span>`;
            
            let time_str = log.time ? frappe.datetime.global_date_format(log.time) + " " + log.time.split(" ")[1].substring(0, 5) : "-";
            
            let location_str = (log.latitude && log.longitude) 
                ? `<a href="javascript:void(0)" onclick="frappe.pages['chief-technician-das']._dashboard.open_map_popup(${log.latitude}, ${log.longitude})" style="color: var(--ct-primary);"><i class="fa fa-map-marker"></i> ${log.latitude.toFixed(5)}, ${log.longitude.toFixed(5)}</a>`
                : "-";

            html += `
                <tr>
                    <td style="font-weight: 500;">${log.employee_name || log.employee}</td>
                    <td>${log_type_badge}</td>
                    <td>${time_str}</td>
                    <td>${location_str}</td>
                    <td style="color: #64748b;">${log.device_id || "-"}</td>
                </tr>
            `;
        });
        
        html += `</tbody></table>`;
        container.html(html);
    }

    render_attendance_pagination() {
        let container = $("#ct-attendance-pagination");
        if (this.attendance_total <= this.attendance_length) {
            container.empty();
            return;
        }
        
        let current_page = Math.floor(this.attendance_start / this.attendance_length) + 1;
        let total_pages = Math.ceil(this.attendance_total / this.attendance_length);
        
        container.html(`
            <button class="ct-page-btn" data-action="prev" ${this.attendance_start === 0 ? "disabled" : ""}>
                <i class="fa fa-chevron-left"></i> Previous
            </button>
            <div class="ct-page-info">Page ${current_page} of ${total_pages}</div>
            <button class="ct-page-btn" data-action="next" ${(this.attendance_start + this.attendance_length) >= this.attendance_total ? "disabled" : ""}>
                Next <i class="fa fa-chevron-right"></i>
            </button>
        `);
    }

    open_map_popup(lat, lng) {
        let d = new frappe.ui.Dialog({
            title: "Check-in Location",
            fields: [
                {
                    fieldtype: "HTML",
                    fieldname: "map_html"
                }
            ]
        });
        
        d.get_field("map_html").$wrapper.html('<div id="ct-popup-map" style="height: 400px; width: 100%; border-radius: 8px;"></div>');
        d.show();
        
        setTimeout(() => {
            frappe.require([
                'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
                'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
            ], function() {
                let map = L.map("ct-popup-map").setView([lat, lng], 15);
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    attribution: '© OpenStreetMap contributors'
                }).addTo(map);
                L.marker([lat, lng]).addTo(map);
                
                // Fix map size after dialog finishes opening
                setTimeout(() => map.invalidateSize(), 200);
            });
        }, 300);
    }
}
frappe.pages['chief-technician-das']._dashboard = null;