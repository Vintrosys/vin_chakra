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
        
        // Map specific state
        this.map_filters = {
            date: frappe.datetime.get_today(),
            technician: "",
            customer: "",
            status: "Resolved"
        };
        this.map_tech_control = null;
        this.map_customer_control = null;
        
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
                        <!-- Quick Date Filters (Three dot button) -->
                        <div class="ct-time-filter-dropdown" id="ct-time-filter-dropdown" style="display: none; position: relative;">
                            <button class="ct-filter-btn" id="ct-btn-time-filter" style="padding: 4px 8px; border-radius: 4px;" title="Quick Date Filter">
                                <i class="fa fa-ellipsis-v"></i>
                            </button>
                            <div class="ct-time-filter-menu" style="display: none; position: absolute; right: 0; top: 100%; background: white; border: 1px solid #e2e8f0; border-radius: 6px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); z-index: 100; min-width: 120px; overflow: hidden; margin-top: 5px;">
                                <div class="ct-time-filter-option" data-val="today" style="padding: 8px 12px; cursor: pointer; border-bottom: 1px solid #f1f5f9; font-size: 13px; font-weight: 500;">Today</div>
                                <div class="ct-time-filter-option" data-val="week" style="padding: 8px 12px; cursor: pointer; border-bottom: 1px solid #f1f5f9; font-size: 13px; font-weight: 500;">This Week</div>
                                <div class="ct-time-filter-option" data-val="month" style="padding: 8px 12px; cursor: pointer; font-size: 13px; font-weight: 500;">This Month</div>
                            </div>
                        </div>

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

        // The quick time filter dropdown should only show for analytics and attendance
        this.wrapper.find("#ct-time-filter-dropdown")
            .toggle(this.current_tab === "analytics" || this.current_tab === "attendance");
            
        // Hide the global filter button in the technician map
        this.wrapper.find("#ct-btn-filter-toggle")
            .toggle(this.current_tab !== "movement");
            
        // Hide the filters panel if it is open when navigating to movement tab
        if (this.current_tab === "movement") {
            this.wrapper.find("#ct-filters-panel").hide();
            this.wrapper.find("#ct-btn-filter-toggle").removeClass("active");
        }
            
        // Hide global summary row (box filters) on the movement and attendance tabs
        this.wrapper.find("#ct-summary-row")
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
                <div class="ct-movement-filters" style="background: white; border: 1px solid var(--ct-border); border-radius: var(--ct-radius); padding: 15px; margin-bottom: 20px; display: flex; gap: 15px; flex-wrap: wrap; box-shadow: var(--ct-shadow-sm); align-items: center;">
                    <div class="ct-filter-item" style="margin: 0; min-width: 150px;">
                        <label style="font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--ct-text-muted); margin-bottom: 4px; display: block;">Date (Mandatory)</label>
                        <input type="date" id="ct-map-filter-date" value="${this.map_filters.date}" style="width: 100%; height: 36px; border: 1px solid #e2e8f0; border-radius: 6px; padding: 0 10px; font-size: 13px;">
                    </div>
                    <div class="ct-filter-item" style="margin: 0; min-width: 200px;">
                        <label style="font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--ct-text-muted); margin-bottom: 4px; display: block;">Technician (Optional)</label>
                        <div id="ct-map-technician-control"></div>
                    </div>
                    <div class="ct-filter-item" style="margin: 0; min-width: 200px;">
                        <label style="font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--ct-text-muted); margin-bottom: 4px; display: block;">Customer (Optional)</label>
                        <div id="ct-map-customer-control"></div>
                    </div>
                    <div class="ct-filter-item" style="margin: 0; min-width: 150px;">
                        <label style="font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--ct-text-muted); margin-bottom: 4px; display: block;">Ticket Status</label>
                        <select id="ct-map-filter-status" style="width: 100%; height: 36px; border: 1px solid #e2e8f0; border-radius: 6px; padding: 0 10px; font-size: 13px; background: white;">
                            <option value="">All Statuses</option>
                            <option value="Open" ${this.map_filters.status === 'Open' ? 'selected' : ''}>Open</option>
                            <option value="Working" ${this.map_filters.status === 'Working' ? 'selected' : ''}>Working</option>
                            <option value="Pending" ${this.map_filters.status === 'Pending' ? 'selected' : ''}>Pending</option>
                            <option value="Resolved" ${this.map_filters.status === 'Resolved' ? 'selected' : ''}>Resolved</option>
                        </select>
                    </div>
                    <div class="ct-filter-item" style="margin: 0; display: flex; align-items: flex-end; height: 55px;">
                        <button class="btn btn-primary btn-sm" id="ct-map-filter-apply" style="height: 36px; padding: 0 16px; font-weight: 600;">Apply Map Filters</button>
                    </div>
                </div>

                <!-- Summary Row for Technician Map -->
                <div class="ct-map-summary-row" id="ct-map-summary-row" style="display: none; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 15px; margin-bottom: 20px;">
                    <!-- Will be populated dynamically -->
                </div>

                <div class="ct-movement-layout" style="display: block;">
                    <div style="position: relative; margin-bottom: 20px;">
                        <div class="ct-map-container" id="ct-movement-map" style="height: 380px; border-radius: var(--ct-radius); border: 1px solid var(--ct-border); box-shadow: var(--ct-shadow-sm);"></div>
                        <div class="ct-map-legend" id="ct-map-legend" style="position: absolute; bottom: 20px; right: 20px; z-index: 400; background: white; padding: 10px; border-radius: 6px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); border: 1px solid #e2e8f0; max-height: 200px; overflow-y: auto;">
                            <div style="font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; margin-bottom: 4px; font-weight: 700;">Map Legend</div>
                            <div id="ct-map-legend-routes"></div>
                        </div>
                    </div>
                    
                    <div class="ct-map-timeline-container" id="ct-map-timeline-container" style="display: none; background: white; border: 1px solid var(--ct-border); border-radius: var(--ct-radius); padding: 20px; box-shadow: var(--ct-shadow-sm);">
                        <div class="ct-analytics-card-title" style="margin-bottom: 16px;"><i class="fa fa-clock-o"></i> Technician Journey Timeline</div>
                        <div class="ct-timeline-list" id="ct-timeline-list" style="display: flex; overflow-x: auto; padding: 10px 0; gap: 20px; align-items: center; min-height: 80px;"></div>
                    </div>
                </div>
            `);
            this.render_map_filter_controls();
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
    
    render_map_filter_controls() {
        let self = this;
        this.map_tech_control = frappe.ui.form.make_control({
            df: {
                fieldtype: "Link",
                options: "User",
                placeholder: "Select Technician",
                default: self.map_filters.technician
            },
            parent: this.wrapper.find("#ct-map-technician-control"),
            render_input: true
        });
        
        this.map_customer_control = frappe.ui.form.make_control({
            df: {
                fieldtype: "Link",
                options: "Customer",
                placeholder: "Select Customer",
                default: self.map_filters.customer
            },
            parent: this.wrapper.find("#ct-map-customer-control"),
            render_input: true
        });
        
        setTimeout(() => {
            [this.map_tech_control, this.map_customer_control].forEach(ctrl => {
                if(ctrl) {
                    ctrl.$wrapper.find('.form-group').css({'margin': '0'});
                    ctrl.$wrapper.find('.clearfix').hide();
                    ctrl.$input.css({
                        'background': '#fff', 
                        'border': '1px solid #e2e8f0', 
                        'border-radius': '6px', 
                        'height': '36px', 
                        'padding': '0 12px',
                        'box-shadow': 'none',
                        'font-size': '13px'
                    });
                    ctrl.$wrapper.css({'background': 'transparent'});
                }
            });
        }, 100);
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
                    self.map = L.map(map_el, { scrollWheelZoom: false }).setView([20.5937, 78.9629], 5);
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
        
        // Time filter dropdown toggle
        this.wrapper.on("click", "#ct-btn-time-filter", function(e) {
            e.stopPropagation();
            self.wrapper.find(".ct-time-filter-menu").toggle();
        });
        
        $(document).on("click", function(e) {
            if (!$(e.target).closest(".ct-time-filter-dropdown").length) {
                self.wrapper.find(".ct-time-filter-menu").hide();
            }
        });
        
        // Time filter option click
        this.wrapper.on("click", ".ct-time-filter-option", function() {
            let val = $(this).data("val");
            let today = frappe.datetime.get_today();
            self.wrapper.find(".ct-time-filter-menu").hide();
            
            if (val === "today") {
                self.filters.date_from = today;
                self.filters.date_to = today;
            } else if (val === "week") {
                self.filters.date_from = frappe.datetime.add_days(today, -7);
                self.filters.date_to = today;
            } else if (val === "month") {
                self.filters.date_from = frappe.datetime.month_start();
                self.filters.date_to = frappe.datetime.month_end();
            }
            
            // Sync with date inputs
            self.wrapper.find("#ct-filter-date-from").val(self.filters.date_from);
            self.wrapper.find("#ct-filter-date-to").val(self.filters.date_to);
            
            self.reset_pagination();
            self.load_data();
        });
        
        // Hover effects for the time filter options
        this.wrapper.on("mouseenter", ".ct-time-filter-option", function() {
            $(this).css("background-color", "#f8fafc");
        });
        this.wrapper.on("mouseleave", ".ct-time-filter-option", function() {
            $(this).css("background-color", "white");
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
        
        // Apply Map Filters
        this.wrapper.on("click", "#ct-map-filter-apply", function() {
            self.map_filters.date = self.wrapper.find("#ct-map-filter-date").val();
            self.map_filters.technician = self.map_tech_control.get_value();
            self.map_filters.customer = self.map_customer_control.get_value();
            self.map_filters.status = self.wrapper.find("#ct-map-filter-status").val();
            
            if(!self.map_filters.date) {
                frappe.msgprint("Date is mandatory for the Technician Map.");
                return;
            }
            
            self.wrapper.find("#ct-loader").show();
            self.load_movement_data();
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
            method: "vin_chakra.vin_chakra.page.chief_technician_das.chief_technician_das.get_technician_map_data",
            args: {
                date: this.map_filters.date,
                technician: this.map_filters.technician,
                customer: this.map_filters.customer,
                ticket_status: this.map_filters.status
            },
            callback: function(r) {
                self.wrapper.find("#ct-loader").hide();
                if (r.message) {
                    let data = r.message;
                    
                    if (data.mode === "all_technicians") {
                        self.render_all_tech_map(data.markers);
                        self.wrapper.find("#ct-map-summary-row").hide();
                        self.wrapper.find("#ct-map-timeline-container").hide();
                    } else {
                        self.render_tech_route_map(data.visits);
                        self.render_map_summary(data.summary);
                        self.render_map_timeline(data.visits);
                        self.wrapper.find("#ct-map-summary-row").css("display", "grid");
                        self.wrapper.find("#ct-map-timeline-container").show();
                    }
                }
            }
        });
    }

    render_all_tech_map(markers) {
        let self = this;
        if (!self.map || !self.markers_layer) return;

        self.markers_layer.clearLayers();
        let bounds = [];
        let legend_html = "";
        
        let route_colors = ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#3b82f6', '#8b5cf6'];
        
        markers.forEach((log, index) => {
            let tech_color = route_colors[index % route_colors.length];
            let tech_name = frappe.user.full_name(log.user) || log.user;
            
            legend_html += `
                <div class="ct-map-legend-item">
                    <div style="width:16px; height:16px; border-radius:50%; background:${tech_color}; display:inline-block; vertical-align:middle; margin-right:6px;"></div>
                    ${tech_name}
                </div>`;
                
            let icon_html = `
                <div class="map-route-marker" style="background-color:${tech_color}; color:white; border-radius:50%; width:26px; height:26px; display:flex; align-items:center; justify-content:center; font-weight:800; border:2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3); font-size:11px;" title="${tech_name}">
                    <i class="fa fa-user"></i>
                </div>
            `;
            let customIcon = L.divIcon({
                className: 'custom-div-icon',
                html: icon_html,
                iconSize: [26, 26],
                iconAnchor: [13, 13]
            });
            
            let marker = L.marker([log.latitude, log.longitude], {icon: customIcon});
            let time_only = frappe.datetime.get_time(log.creation).substring(0, 5);
            let popup_html = `
                <div style="font-family: 'Inter', sans-serif; padding: 4px; width: 220px;">
                    <div style="font-weight: 800; font-size: 13px; margin-bottom: 4px; color: var(--ct-text-main);">
                        ${tech_name}
                    </div>
                    <div style="font-size: 11px; color: var(--ct-text-muted); margin-bottom: 6px; font-weight: 600;">Latest Location at ${time_only}</div>
                    <div style="font-size: 12px; line-height: 1.4; border-top: 1px solid #f1f5f9; padding-top: 6px;">
                        <strong>Ticket:</strong> <a onclick="window.location.href='/helpdesk/tickets/${log.ticket}'" style="cursor:pointer; color:var(--ct-primary); font-weight: 700;">${log.ticket}</a><br>
                        <strong>Customer:</strong> ${log.customer || 'N/A'}<br>
                        <strong>Status:</strong> ${log.status || 'N/A'}<br>
                        <strong>Address:</strong> <span style="color: #475569;">${log.location_address || 'N/A'}</span>
                    </div>
                </div>
            `;
            marker.bindPopup(popup_html);
            self.markers_layer.addLayer(marker);
            bounds.push([log.latitude, log.longitude]);
        });
        
        $("#ct-map-legend-routes").html(legend_html);
        if (bounds.length > 0) {
            self.map.fitBounds(bounds, {padding: [50, 50]});
        } else {
            self.map.setView([20.5937, 78.9629], 5);
        }
    }
    
    render_tech_route_map(visits) {
        let self = this;
        if (!self.map || !self.markers_layer) return;

        self.markers_layer.clearLayers();
        let bounds = [];
        let tech_color = '#3b82f6';
        let tech_name = this.map_filters.technician ? frappe.user.full_name(this.map_filters.technician) : "";
        
        let legend_html = `
            <div class="ct-map-legend-item">
                <div style="width:16px; height:3px; background:${tech_color}; border-radius:2px; display:inline-block; vertical-align:middle; margin-right:6px;"></div>
                ${tech_name} Journey
            </div>
            <div class="ct-map-legend-item">
                <span class="badge" style="background:#10b981; color:white; font-size:9px; padding:2px 4px; margin-right:6px;">START</span> First Ticket
            </div>
            <div class="ct-map-legend-item">
                <span class="badge" style="background:#ef4444; color:white; font-size:9px; padding:2px 4px; margin-right:6px;">END</span> Last Ticket
            </div>`;
        $("#ct-map-legend-routes").html(legend_html);
        
        if (visits.length > 1) {
            let path_coords = visits.map(v => [v.latitude, v.longitude]);
            L.polyline(path_coords, {
                color: tech_color,
                weight: 4,
                opacity: 0.85,
                lineJoin: 'round'
            }).addTo(self.markers_layer);
            
            for (let i = 0; i < path_coords.length - 1; i++) {
                let p1 = path_coords[i];
                let p2 = path_coords[i + 1];
                let mid_lat = (p1[0] + p2[0]) / 2;
                let mid_lng = (p1[1] + p2[1]) / 2;
                let dy = p2[0] - p1[0];
                let dx = p2[1] - p1[1];
                let angle = Math.atan2(dy, dx) * 180 / Math.PI;

                let arrowIcon = L.divIcon({
                    className: 'route-arrow-icon',
                    html: `<div style="transform: rotate(${angle}deg); color: ${tech_color}; font-size: 14px; display: flex; align-items: center; justify-content: center; opacity:1;"><i class="fa fa-chevron-right"></i></div>`,
                    iconSize: [16, 16],
                    iconAnchor: [8, 8]
                });
                L.marker([mid_lat, mid_lng], {icon: arrowIcon, interactive: false}).addTo(self.markers_layer);
            }
        }
        
        self.map_markers = {};
        
        visits.forEach((v, index) => {
            let badge = "";
            let pin_color = '#64748b';
            if (index === 0) { badge = "START"; pin_color = '#10b981'; }
            else if (index === visits.length - 1) { badge = "END"; pin_color = '#ef4444'; }
            
            let icon_html = `
                <div class="map-route-marker" style="background-color:${pin_color}; color:white; border-radius:50%; width:26px; height:26px; display:flex; align-items:center; justify-content:center; font-weight:800; border:2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3); font-size:12px; position: relative;">
                    ${index + 1}
                    ${badge ? `<div style="position: absolute; top: -15px; left: 50%; transform: translateX(-50%); background: ${pin_color}; color: white; font-size: 8px; padding: 2px 4px; border-radius: 4px; font-weight: 700;">${badge}</div>` : ""}
                </div>
            `;
            let customIcon = L.divIcon({
                className: 'custom-div-icon',
                html: icon_html,
                iconSize: [26, 26],
                iconAnchor: [13, 13]
            });
            
            let marker = L.marker([v.latitude, v.longitude], {icon: customIcon});
            
            let format_time = (t) => t ? frappe.datetime.get_time(t).substring(0, 5) : "N/A";
            let duration_str = "N/A";
            if (v.time_spent_seconds !== null) {
                let hrs = Math.floor(v.time_spent_seconds / 3600);
                let mins = Math.floor((v.time_spent_seconds % 3600) / 60);
                duration_str = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
            }
            
            let popup_html = `
                <div style="font-family: 'Inter', sans-serif; padding: 4px; width: 220px;" class="ct-marker-popup" data-ticket="${v.ticket}">
                    <div style="font-weight: 800; font-size: 14px; margin-bottom: 4px; color: var(--ct-text-main);">
                        Ticket #${index + 1}
                    </div>
                    <div style="font-size: 12px; line-height: 1.5; border-top: 1px solid #f1f5f9; padding-top: 6px;">
                        <strong>Ticket ID:</strong> <a onclick="window.location.href='/helpdesk/tickets/${v.ticket}'" style="cursor:pointer; color:var(--ct-primary); font-weight: 700;">${v.ticket}</a><br>
                        <strong>Customer:</strong> ${v.customer || 'N/A'}<br>
                        <strong>Status:</strong> ${v.status}<br>
                        <strong>In:</strong> ${format_time(v.check_in)} | <strong>Out:</strong> ${format_time(v.check_out)}<br>
                        <strong>Time Spent:</strong> ${duration_str}<br>
                        <strong>Location:</strong> <span style="color: #475569; font-size:11px;">${v.address || `${v.latitude.toFixed(4)}, ${v.longitude.toFixed(4)}`}</span>
                    </div>
                </div>
            `;
            
            marker.bindPopup(popup_html);
            
            marker.on('popupopen', function() {
                $(".ct-timeline-item").removeClass("active").css("border-color", "transparent").css("background", "white");
                let t_el = $(`#timeline-item-${v.ticket}`);
                if(t_el.length) {
                    t_el.addClass("active").css("border-color", "var(--ct-primary)").css("background", "#f8fafc");
                    t_el[0].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
                }
            });
            
            self.markers_layer.addLayer(marker);
            self.map_markers[v.ticket] = marker;
            bounds.push([v.latitude, v.longitude]);
        });
        
        if (bounds.length > 0) {
            self.map.fitBounds(bounds, {padding: [50, 50]});
        } else {
            self.map.setView([20.5937, 78.9629], 5);
        }
    }
    
    render_map_summary(summary) {
        let container = this.wrapper.find("#ct-map-summary-row");
        if (!summary.total_tickets) {
            container.hide();
            return;
        }
        
        let format_time = (t) => t ? frappe.datetime.get_time(t).substring(0, 5) : "-";
        
        let format_dur = (sec) => {
            if (!sec) return "-";
            let h = Math.floor(sec / 3600);
            let m = Math.floor((sec % 3600) / 60);
            return h > 0 ? `${h}h ${m}m` : `${m}m`;
        };
        
        let html = `
            <div class="ct-summary-card" style="border-top-color: #6366f1; cursor: default;">
                <div class="ct-summary-val">${summary.total_tickets}</div>
                <div class="ct-summary-label">Total Visits</div>
            </div>
            <div class="ct-summary-card" style="border-top-color: #10b981; cursor: default;">
                <div class="ct-summary-val">${format_time(summary.first_check_in)}</div>
                <div class="ct-summary-label">First Check-in</div>
            </div>
            <div class="ct-summary-card" style="border-top-color: #ef4444; cursor: default;">
                <div class="ct-summary-val">${format_time(summary.last_check_out)}</div>
                <div class="ct-summary-label">Last Check-out</div>
            </div>
            <div class="ct-summary-card" style="border-top-color: #f59e0b; cursor: default;">
                <div class="ct-summary-val">${format_dur(summary.total_duration_seconds)}</div>
                <div class="ct-summary-label">Total Working Duration</div>
            </div>
            <div class="ct-summary-card" style="border-top-color: #8b5cf6; cursor: default;">
                <div class="ct-summary-val">${format_dur(summary.avg_time_seconds)}</div>
                <div class="ct-summary-label">Avg Time/Ticket</div>
            </div>
        `;
        container.html(html);
    }
    
    render_map_timeline(visits) {
        let container = this.wrapper.find("#ct-timeline-list");
        if (!visits || visits.length === 0) {
            container.html(`<div style="color: var(--ct-text-muted); font-size: 13px;">No tickets found for this technician on the selected date.</div>`);
            return;
        }
        
        let format_time = (t) => t ? frappe.datetime.get_time(t).substring(0, 5) : "--:--";
        let self = this;
        
        let html = "";
        visits.forEach((v, index) => {
            let dur_str = "";
            if (v.time_spent_seconds) {
                let m = Math.floor(v.time_spent_seconds / 60);
                dur_str = `<div style="font-size:10px; color:var(--ct-text-muted); margin-top:4px;"><i class="fa fa-clock-o"></i> ${m} min spent</div>`;
            }
            
            html += `
                <div class="ct-timeline-item" id="timeline-item-${v.ticket}" data-ticket="${v.ticket}" style="min-width: 200px; border: 1px solid transparent; border-radius: 8px; padding: 12px; cursor: pointer; transition: all 0.2s; position: relative;">
                    <div style="position: absolute; top: 12px; right: 12px; font-weight: 800; color: #cbd5e1; font-size: 20px;">#${index + 1}</div>
                    <div style="font-size: 14px; font-weight: 700; color: var(--ct-text-main); margin-bottom: 4px; padding-right: 20px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${v.ticket}">${v.ticket}</div>
                    <div style="font-size: 12px; color: var(--ct-text-muted); margin-bottom: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${v.customer || 'No Customer'}"><i class="fa fa-user"></i> ${v.customer || 'No Customer'}</div>
                    
                    <div style="display:flex; justify-content:space-between; align-items:center; background:#f1f5f9; padding: 6px 8px; border-radius:4px; font-size:11px; font-weight:600;">
                        <span><span style="color:#3b82f6;">IN</span> ${format_time(v.check_in)}</span>
                        <span><span style="color:#10b981;">OUT</span> ${format_time(v.check_out)}</span>
                    </div>
                    ${dur_str}
                </div>
                ${index < visits.length - 1 ? `<div style="color: #cbd5e1; flex-shrink: 0;"><i class="fa fa-arrow-right"></i></div>` : ""}
            `;
        });
        
        container.html(html);
        
        container.off("click", ".ct-timeline-item").on("click", ".ct-timeline-item", function() {
            let t_id = $(this).data("ticket");
            if (self.map_markers && self.map_markers[t_id]) {
                self.map_markers[t_id].openPopup();
                let latlng = self.map_markers[t_id].getLatLng();
                self.map.panTo(latlng);
            }
        });
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