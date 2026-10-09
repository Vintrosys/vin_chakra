frappe.pages['chief-technician-das'].on_page_load = function(wrapper) {
    if (!frappe.user.has_role("Chief Technician") && !frappe.user.has_role("System Manager")) {
        frappe.msgprint(__("You do not have permission to access this dashboard."));
        frappe.set_route("app");
        return;
    }
    wrapper._dashboard = new ChiefTechnicianDashboard(wrapper);
    frappe.pages['chief-technician-das']._dashboard = wrapper._dashboard;
};

frappe.pages['chief-technician-das'].on_page_show = function(wrapper) {
    if (wrapper._dashboard) {
        wrapper._dashboard.read_url_params();
        wrapper._dashboard.sync_ui_from_state();
        wrapper._dashboard.render_view_structure();
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
        this.current_tab = "tickets"; // tickets, analytics, movement, attendance
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
            priority: "",
            ticket_type: ""
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
        this.map_provider = localStorage.getItem("ct_map_provider") || "google";
        this.map = null;
        this.leaflet_map = null;
        this.gm_markers = [];
        this.gm_polylines = [];
        this.leaflet_markers = [];
        this.leaflet_polylines = [];
        this._open_info_window = null;
        this.tech_control = null;
        this.ticket_type_control = null;
        
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
        this.read_url_params();
        this.render_skeleton();
        this.sync_ui_from_state();
        this.bind_events();
        this.bind_popstate();
        this.load_data();
    }

    read_url_params() {
        let params = new URLSearchParams(window.location.search);
        
        let tab = params.get("tab");
        if (tab && ["tickets", "analytics", "movement", "attendance"].includes(tab)) {
            this.current_tab = tab;
        }
        
        let view = params.get("view");
        if (view && ["card", "list", "calendar"].includes(view)) {
            this.view_type = view;
        }
        
        let tickets_page = parseInt(params.get("tickets_page") || params.get("page") || "1");
        if (!isNaN(tickets_page) && tickets_page > 0) {
            this.tickets_start = (tickets_page - 1) * this.tickets_length;
        } else {
            this.tickets_start = 0;
        }
        
        let attendance_page = parseInt(params.get("attendance_page") || "1");
        if (!isNaN(attendance_page) && attendance_page > 0) {
            this.attendance_start = (attendance_page - 1) * this.attendance_length;
        } else {
            this.attendance_start = 0;
        }
        
        this.filters.date_from = params.get("date_from") || "";
        this.filters.date_to = params.get("date_to") || "";
        this.filters.technician = params.get("technician") || "";
        this.filters.status = params.get("status") || "";
        this.filters.priority = params.get("priority") || "";
        this.filters.ticket_type = params.get("ticket_type") || "";
        this.search_query = params.get("search") || "";
    }

    update_url(push = false) {
        let params = new URLSearchParams(window.location.search);
        
        params.set("tab", this.current_tab);
        params.set("view", this.view_type);
        
        let tickets_page = Math.floor(this.tickets_start / this.tickets_length) + 1;
        if (tickets_page > 1) {
            params.set("tickets_page", tickets_page);
        } else {
            params.delete("tickets_page");
            params.delete("page");
        }
        
        let attendance_page = Math.floor(this.attendance_start / this.attendance_length) + 1;
        if (attendance_page > 1) {
            params.set("attendance_page", attendance_page);
        } else {
            params.delete("attendance_page");
        }
        
        if (this.filters.date_from) params.set("date_from", this.filters.date_from); else params.delete("date_from");
        if (this.filters.date_to) params.set("date_to", this.filters.date_to); else params.delete("date_to");
        if (this.filters.technician) params.set("technician", this.filters.technician); else params.delete("technician");
        if (this.filters.status) params.set("status", this.filters.status); else params.delete("status");
        if (this.filters.priority) params.set("priority", this.filters.priority); else params.delete("priority");
        if (this.filters.ticket_type) params.set("ticket_type", this.filters.ticket_type); else params.delete("ticket_type");
        if (this.search_query) params.set("search", this.search_query); else params.delete("search");
        
        let queryString = params.toString();
        let newUrl = window.location.pathname + (queryString ? "?" + queryString : "") + window.location.hash;
        
        if (newUrl !== (window.location.pathname + window.location.search + window.location.hash)) {
            if (push) {
                history.pushState({ tab: this.current_tab, tickets_start: this.tickets_start }, "", newUrl);
            } else {
                history.replaceState({ tab: this.current_tab, tickets_start: this.tickets_start }, "", newUrl);
            }
        }
    }

    sync_ui_from_state() {
        if (!this.wrapper) return;
        this.wrapper.find(".ct-tab-btn").removeClass("active");
        this.wrapper.find(`.ct-tab-btn[data-tab="${this.current_tab}"]`).addClass("active");

        this.wrapper.find("#ct-filter-date-from").val(this.filters.date_from || "");
        this.wrapper.find("#ct-filter-date-to").val(this.filters.date_to || "");
        this.wrapper.find("#ct-filter-status").val(this.filters.status || "");
        this.wrapper.find("#ct-filter-priority").val(this.filters.priority || "");
        this.wrapper.find("#ct-ticket-search").val(this.search_query || "");

        if (this.tech_control && this.filters.technician) {
            this.tech_control.set_value(this.filters.technician);
        }
        if (this.ticket_type_control && this.filters.ticket_type) {
            this.ticket_type_control.set_value(this.filters.ticket_type);
        }
    }

    bind_popstate() {
        let self = this;
        $(window).off("popstate.chief_tech_dash").on("popstate.chief_tech_dash", function() {
            if (!self.wrapper || !$.contains(document.documentElement, self.wrapper[0])) {
                $(window).off("popstate.chief_tech_dash");
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
        this.movement_start = 0;
        this.attendance_start = 0;
        this.update_url(false);
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

                        <button class="ct-filter-btn" id="ct-btn-raise-ticket">
                            <i class="fa fa-plus"></i> Raise Ticket
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
                    <div class="ct-filter-item" id="ct-filter-ticket-type-wrap">
                        <label>Ticket Type</label>
                        <div id="ct-filter-ticket-type-control"></div>
                    </div>
                </div>
                
                <!-- Active Filters Area -->
                <div class="ct-active-filters" id="ct-active-filters"></div>
                
                 <!-- Summary Cards Row -->
                 <div class="ct-summary-row" id="ct-summary-row"></div>
                 
                 <!-- Main Dynamic Views Section -->
                 <div class="ct-loader" id="ct-loader" style="display: none;"></div>
                 <div id="ct-view-content"></div>
            </div>
        `);
        
        this.render_tech_filter_control();
        this.render_ticket_type_filter_control();
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
    
    render_ticket_type_filter_control() {
        let self = this;
        this.ticket_type_control = frappe.ui.form.make_control({
            df: {
                fieldtype: "Link",
                options: "HD Ticket Type",
                placeholder: "All Ticket Types",
                onchange: () => {
                    self.filters.ticket_type = self.ticket_type_control.get_value();
                    self.reset_pagination();
                    self.load_data();
                }
            },
            parent: this.wrapper.find("#ct-filter-ticket-type-control"),
            render_input: true
        });
        
        setTimeout(() => {
            this.ticket_type_control.$wrapper.find('.form-group').css({'margin': '0'});
            this.ticket_type_control.$wrapper.find('.clearfix').hide();
            this.ticket_type_control.$input.css({
                'background': '#fff', 
                'border': '1px solid #e2e8f0', 
                'border-radius': '6px', 
                'height': '36px', 
                'padding': '0 12px',
                'box-shadow': 'none'
            });
            this.ticket_type_control.$wrapper.css({'background': 'transparent'});

            // Fallback: bind a change event directly on the input in case df.onchange
            // doesn't fire reliably in page context (Link controls outside forms)
            this.ticket_type_control.$input.off('change.ct_type').on('change.ct_type', () => {
                let val = this.ticket_type_control.get_value();
                if (val !== this.filters.ticket_type) {
                    this.filters.ticket_type = val;
                    this.reset_pagination();
                    this.load_data();
                }
            });
        }, 100);
    }
    
    destroy_maps() {
        if (this.map) {
            if (window.google && window.google.maps) {
                google.maps.event.clearInstanceListeners(this.map);
            }
            this.map = null;
        }
        if (this.leaflet_map) {
            try { this.leaflet_map.remove(); } catch(e){}
            this.leaflet_map = null;
        }
        (this.gm_markers || []).forEach(m => { if(m && m.setMap) m.setMap(null); });
        (this.gm_polylines || []).forEach(p => { if(p && p.setMap) p.setMap(null); });
        (this.leaflet_markers || []).forEach(m => { if(m && m.remove) m.remove(); });
        (this.leaflet_polylines || []).forEach(p => { if(p && p.remove) p.remove(); });
        this.gm_markers = [];
        this.gm_polylines = [];
        this.leaflet_markers = [];
        this.leaflet_polylines = [];
        if (this._open_info_window) { 
            if (this._open_info_window.close) this._open_info_window.close(); 
            this._open_info_window = null; 
        }
        this.wrapper.find("#ct-movement-map").empty();
    }

    _load_leaflet(callback) {
        let self = this;
        const set_leaflet_defaults = () => {
            if (window.L && window.L.Icon && window.L.Icon.Default) {
                window.L.Icon.Default.imagePath = "https://unpkg.com/leaflet@1.9.4/dist/images/";
            }
        };

        if (window.L) {
            set_leaflet_defaults();
            callback();
            return;
        }

        const ensure_cdn_css = () => {
            if (!document.getElementById("vc-leaflet-css-cdn")) {
                let cdnLink = document.createElement("link");
                cdnLink.id = "vc-leaflet-css-cdn";
                cdnLink.rel = "stylesheet";
                cdnLink.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
                document.head.appendChild(cdnLink);
            }
        };

        const load_cdn_js = () => {
            ensure_cdn_css();
            if (document.getElementById("vc-leaflet-script-cdn")) {
                let pollCdn = setInterval(() => {
                    if (window.L) {
                        clearInterval(pollCdn);
                        set_leaflet_defaults();
                        callback();
                    }
                }, 50);
                return;
            }
            let cdn = document.createElement("script");
            cdn.id = "vc-leaflet-script-cdn";
            cdn.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
            cdn.onload = () => {
                if (window.L) {
                    set_leaflet_defaults();
                    callback();
                } else {
                    frappe.msgprint(__("Failed to initialize OpenStreetMap library."));
                }
            };
            cdn.onerror = () => {
                frappe.msgprint(__("Failed to load OpenStreetMap library. Please check your network connection."));
            };
            document.head.appendChild(cdn);
        };

        // Always inject local CSS first; if it 404s, inject CDN CSS as backup
        if (!document.getElementById("vc-leaflet-css")) {
            let link = document.createElement("link");
            link.id = "vc-leaflet-css";
            link.rel = "stylesheet";
            link.href = "/assets/vin_chakra/js/lib/leaflet/leaflet.css";
            link.onerror = () => { ensure_cdn_css(); };
            document.head.appendChild(link);
        }

        // If the script tag already exists, poll for it
        if (document.getElementById("vc-leaflet-script") || document.getElementById("vc-leaflet-script-cdn")) {
            let waitCount = 0;
            let wait = setInterval(() => {
                waitCount++;
                if (window.L) {
                    clearInterval(wait);
                    set_leaflet_defaults();
                    callback();
                } else if (waitCount > 50) { // 2.5 seconds timeout
                    clearInterval(wait);
                    load_cdn_js();
                }
            }, 50);
            return;
        }

        let script = document.createElement("script");
        script.id = "vc-leaflet-script";
        script.src = "/assets/vin_chakra/js/lib/leaflet/leaflet.js";
        script.onload = () => {
            if (window.L) {
                set_leaflet_defaults();
                callback();
            } else {
                // Local asset returned 200 OK with HTML error page (e.g. Frappe Cloud 404 fallback)
                load_cdn_js();
            }
        };
        script.onerror = () => {
            load_cdn_js();
        };
        document.head.appendChild(script);
    }

    render_view_structure() {
        this.destroy_maps();

        // Status/Priority/TicketType filters only apply to the ticket list — hide them
        // on the map tab and attendance tab so it's clear they have no effect there.
        this.wrapper.find("#ct-filter-status-wrap, #ct-filter-priority-wrap, #ct-filter-ticket-type-wrap")
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
            let map_status_options = '<option value="">All Statuses</option>';
            let map_statuses = this.enabled_statuses || [
                {name: "Open"},
                {name: "Working"},
                {name: "Pending"},
                {name: "Resolved"}
            ];
            map_statuses.forEach(status => {
                map_status_options += `<option value="${status.name}" ${this.map_filters.status === status.name ? 'selected' : ''}>${status.name}</option>`;
            });

            content.html(`
                <div class="ct-movement-filters" style="background: white; border: 1px solid var(--ct-border); border-radius: var(--ct-radius); padding: 15px; margin-bottom: 20px; display: flex; gap: 15px; flex-wrap: wrap; box-shadow: var(--ct-shadow-sm); align-items: center;">
                    <div class="ct-filter-item" style="margin: 0; min-width: 140px;">
                        <label style="font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--ct-text-muted); margin-bottom: 4px; display: block;">Map View</label>
                        <select id="ct-map-filter-provider" style="width: 100%; height: 36px; border: 1px solid #e2e8f0; border-radius: 6px; padding: 0 10px; font-size: 13px; background: white;">
                            <option value="google" ${this.map_provider === 'google' ? 'selected' : ''}>Google Maps</option>
                            <option value="osm" ${this.map_provider === 'osm' ? 'selected' : ''}>OpenStreetMap</option>
                        </select>
                    </div>
                    <div class="ct-filter-item" style="margin: 0; min-width: 140px;">
                        <label style="font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--ct-text-muted); margin-bottom: 4px; display: block;">Date (Mandatory)</label>
                        <input type="date" id="ct-map-filter-date" value="${this.map_filters.date}" style="width: 100%; height: 36px; border: 1px solid #e2e8f0; border-radius: 6px; padding: 0 10px; font-size: 13px;">
                    </div>
                    <div class="ct-filter-item" style="margin: 0; min-width: 180px;">
                        <label style="font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--ct-text-muted); margin-bottom: 4px; display: block;">Technician (Optional)</label>
                        <div id="ct-map-technician-control"></div>
                    </div>
                    <div class="ct-filter-item" style="margin: 0; min-width: 180px;">
                        <label style="font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--ct-text-muted); margin-bottom: 4px; display: block;">Customer (Optional)</label>
                        <div id="ct-map-customer-control"></div>
                    </div>
                    <div class="ct-filter-item" style="margin: 0; min-width: 140px;">
                        <label style="font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--ct-text-muted); margin-bottom: 4px; display: block;">Ticket Status</label>
                        <select id="ct-map-filter-status" style="width: 100%; height: 36px; border: 1px solid #e2e8f0; border-radius: 6px; padding: 0 10px; font-size: 13px; background: white;">
                            ${map_status_options}
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
    
    _load_google_maps(callback) {
        if (window.google && window.google.maps) {
            callback();
            return;
        }
        frappe.call({
            method: "vin_chakra.vin_chakra.page.chief_technician_das.chief_technician_das.get_google_maps_api_key",
            callback: (r) => {
                let api_key = r.message || "";
                if (!api_key) {
                    frappe.msgprint(__("Google Maps API key is not configured. Please set the API key in <strong>Google Maps Settings</strong>."));
                    return;
                }
                if (document.getElementById("vc-gmaps-script")) {
                    let wait = setInterval(() => {
                        if (window.google && window.google.maps) {
                            clearInterval(wait);
                            callback();
                        }
                    }, 100);
                    return;
                }
                api_key = String(api_key).trim();
                const show_gm_error = (code) => {
                    let map_el = $("#ct-movement-map");
                    if (!map_el.length) return;
                    const origin = window.location.origin;
                    const hints = {
                        BillingNotEnabledMapError: `Billing is not enabled on the Google Cloud project that owns this key. Link a billing account to the project (Billing → Link a billing account).`,
                        RefererNotAllowedMapError: `This site's URL is not allowed by the key's HTTP referrer restriction. Add <code>${frappe.utils.escape_html(origin)}/*</code> to the key's Website restrictions.`,
                        ApiNotActivatedMapError: `The <strong>Maps JavaScript API</strong> is not enabled in the project that owns this key.`,
                        ApiTargetBlockedMapError: `The key's API restrictions do not include the <strong>Maps JavaScript API</strong>.`,
                        InvalidKeyMapError: `The key is invalid. Re-copy it from Google Cloud Console into Google Maps Settings.`,
                        ExpiredKeyMapError: `The key has expired or was deleted. Create a new key.`,
                        MissingKeyMapError: `No key reached Google. Check Google Maps Settings.`,
                    };
                    const hint = hints[code] || `The key in <strong>Google Maps Settings</strong> was rejected by Google. Open the browser console for the exact error.`;
                    map_el.html(`
                        <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; padding:20px; background:#f8fafc; border-radius:8px; text-align:center;">
                            <i class="fa fa-exclamation-triangle" style="font-size:36px; color:#eab308; margin-bottom:12px;"></i>
                            <h4 style="margin:0 0 8px 0; color:#1e293b; font-weight:700;">Google Maps Key Error${code ? `: ${frappe.utils.escape_html(code)}` : ""}</h4>
                            <p style="margin:0; color:#64748b; font-size:13px; max-width:520px; line-height:1.5;">${hint}<br><br>Changes in Google Cloud can take a few minutes to apply.</p>
                            <a href="/app/google-maps-settings" class="btn btn-primary btn-sm" style="margin-top:16px; font-weight:600;">
                                <i class="fa fa-cog"></i> Open Google Maps Settings
                            </a>
                        </div>
                    `);
                };
                // Google reports the precise reason (e.g. BillingNotEnabledMapError) only via console.error.
                // Capture it so the dashboard can show an actionable message instead of a watermarked map.
                window._vc_gm_error_code = null;
                if (!window._vc_console_patched) {
                    window._vc_console_patched = true;
                    const orig_error = console.error.bind(console);
                    console.error = (...args) => {
                        try {
                            const text = args.map(a => (a && a.message) || String(a)).join(" ");
                            const m = text.match(/Google Maps JavaScript API error: (\w+)/) || text.match(/\b(\w+MapError)\b/);
                            if (m && !window._vc_gm_error_code) {
                                window._vc_gm_error_code = m[1];
                                show_gm_error(m[1]);
                            }
                        } catch (e) {}
                        orig_error(...args);
                    };
                }
                window.gm_authFailure = () => {
                    show_gm_error(window._vc_gm_error_code);
                };
                window._vc_gm_cb = () => {
                    delete window._vc_gm_cb;
                    callback();
                };
                let script = document.createElement("script");
                script.id = "vc-gmaps-script";
                script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(api_key)}&v=weekly&loading=async&callback=_vc_gm_cb`;
                script.async = true;
                script.defer = true;
                script.onerror = () => {
                    show_gm_error("ScriptLoadError");
                };
                document.head.appendChild(script);
            }
        });
    }

    init_map() {
        let self = this;
        // Use a slightly longer delay to ensure the DOM container is fully
        // rendered and has its final computed dimensions before Leaflet or
        // Google Maps initialises (avoids the blank-tile / 0-height issue).
        setTimeout(() => {
            let map_el = self.wrapper.find("#ct-movement-map")[0];
            if (!map_el) return;

            if (self.map_provider === "osm") {
                if (self.map) self.destroy_maps();
                if (self.leaflet_map) {
                    // Map already exists – just force size recalculations and reload data
                    try { self.leaflet_map.invalidateSize(); } catch(e){}
                    setTimeout(() => { if (self.leaflet_map) try { self.leaflet_map.invalidateSize(); } catch(e){} }, 200);
                    self.load_movement_data();
                    return;
                }
                self._load_leaflet(() => {
                    let el = self.wrapper.find("#ct-movement-map")[0];
                    if (!el) return;
                    // Ensure the container has an explicit height so Leaflet
                    // can calculate tile positions correctly
                    if (!el.style.height) {
                        el.style.height = "380px";
                    }
                    self.leaflet_map = L.map(el, { preferCanvas: true }).setView([20.5937, 78.9629], 5);

                    // Primary Tile Layer: standard OpenStreetMap tiles (free, no API key required)
                    let primaryTile = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                        maxZoom: 19,
                        subdomains: 'abc',
                        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    });

                    // Secondary Fallback Tile Layer: Wikimedia's OSM tiles (different host/CDN, also free, no API key)
                    let fallbackTile = L.tileLayer('https://maps.wikimedia.org/osm-intl/{z}/{x}/{y}.png', {
                        maxZoom: 19,
                        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    });

                    let tileErrorHandled = false;
                    primaryTile.on('tileerror', function() {
                        if (!tileErrorHandled && self.leaflet_map) {
                            tileErrorHandled = true;
                            try {
                                self.leaflet_map.removeLayer(primaryTile);
                                fallbackTile.addTo(self.leaflet_map);
                            } catch(e) {}
                        }
                    });

                    primaryTile.addTo(self.leaflet_map);

                    self.leaflet_markers = [];
                    self.leaflet_polylines = [];
                    // Multi-pass size recalculation after DOM rendering
                    [100, 300, 600].forEach(delay => {
                        setTimeout(() => {
                            if (self.leaflet_map) {
                                try { self.leaflet_map.invalidateSize(); } catch(e){}
                            }
                        }, delay);
                    });
                    self.load_movement_data();
                });
            } else {
                if (self.leaflet_map) self.destroy_maps();
                if (self.map) {
                    if (window.google && window.google.maps) {
                        google.maps.event.trigger(self.map, "resize");
                    }
                    self.load_movement_data();
                    return;
                }
                self._load_google_maps(() => {
                    let el = self.wrapper.find("#ct-movement-map")[0];
                    if (!el) return;
                    self.map = new google.maps.Map(el, {
                        center: { lat: 20.5937, lng: 78.9629 },
                        zoom: 5,
                        scrollwheel: false,
                        mapTypeControl: true,
                        streetViewControl: false,
                        fullscreenControl: true,
                        gestureHandling: "cooperative"
                    });
                    self.gm_markers = [];
                    self.gm_polylines = [];
                    self.load_movement_data();
                });
            }
        }, 250);
    }
    
    bind_events() {
        let self = this;
        
        // Tab switching
        this.wrapper.on("click", ".ct-tab-btn", function() {
            let tab = $(this).data("tab");
            self.wrapper.find(".ct-tab-btn").removeClass("active");
            $(this).addClass("active");
            self.current_tab = tab;
            self.update_url(true);
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
            self.update_url(false);
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
            self.update_url(true);
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
            self.update_url(true);
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
            self.update_url(true);
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
        
        // Map Provider Direct Selection Change
        this.wrapper.on("change", "#ct-map-filter-provider", function() {
            let new_provider = $(this).val() || "google";
            if (new_provider !== self.map_provider) {
                self.map_provider = new_provider;
                localStorage.setItem("ct_map_provider", self.map_provider);
                self.destroy_maps();
                self.init_map();
            }
        });

        // Apply Map Filters
        this.wrapper.on("click", "#ct-map-filter-apply", function() {
            self.map_filters.date = self.wrapper.find("#ct-map-filter-date").val();
            self.map_filters.technician = self.map_tech_control.get_value();
            self.map_filters.customer = self.map_customer_control.get_value();
            self.map_filters.status = self.wrapper.find("#ct-map-filter-status").val();
            
            let new_provider = self.wrapper.find("#ct-map-filter-provider").val() || "google";
            let provider_changed = (new_provider !== self.map_provider);
            self.map_provider = new_provider;
            localStorage.setItem("ct_map_provider", self.map_provider);
            
            if(!self.map_filters.date) {
                frappe.msgprint("Date is mandatory for the Technician Map.");
                return;
            }
            
            if (provider_changed) {
                self.destroy_maps();
                self.init_map();
            } else {
                self.wrapper.find("#ct-loader").show();
                self.load_movement_data();
            }
        });

        // Redirect to raise ticket page
        this.wrapper.on("click", "#ct-btn-raise-ticket", function() {
            window.location.href = "/ticket-support";
        });
        
        // Attendance location map popup click
        this.wrapper.on("click", ".ct-attendance-map-link", function(e) {
            e.preventDefault();
            let lat = parseFloat($(this).data("lat"));
            let lng = parseFloat($(this).data("lng"));
            if (!isNaN(lat) && !isNaN(lng)) {
                self.open_map_popup(lat, lng);
            }
        });

        // Popup Lat & Long Google Map modal click
        $(document).off("click", ".ct-popup-gmap-link").on("click", ".ct-popup-gmap-link", function(e) {
            e.preventDefault();
            let lat = parseFloat($(this).data("lat"));
            let lng = parseFloat($(this).data("lng"));
            if (!isNaN(lat) && !isNaN(lng)) {
                self.open_google_map_popup(lat, lng);
            }
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
                ticket_type: this.filters.ticket_type,
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
                     self.update_summary_row(data.summary, data.enabled_statuses);
                    
                    // Render Tickets
                    if (self.view_type === "card") {
                        self.render_ticket_cards(data.tickets);
                        self.render_tickets_pagination();
                    } else if (self.view_type === "list") {
                        self.render_ticket_list(data.tickets);
                        self.render_tickets_pagination();
                    } else if (self.view_type === "calendar") {
                        self.render_ticket_calendar(data.tickets);
                        self.wrapper.find("#ct-tickets-pagination").empty();
                    }
                }
            }
        });
    }
    
    update_summary_row(summary, enabled_statuses) {
        if (enabled_statuses) {
            this.enabled_statuses = enabled_statuses;
            this.enabled_status_names = enabled_statuses.map(s => s.name);
        }

        let row_container = this.wrapper.find("#ct-summary-row");
        if (!row_container.length) return;

        let current_status = this.filters.status || "";
        
        let html = `
            <div class="ct-summary-card ${current_status === "" ? "active" : ""}" data-status="" style="border-top-color: #64748b; cursor: pointer;">
                <div class="ct-summary-val">${summary.Total}</div>
                <div class="ct-summary-label">Total Filtered</div>
            </div>
        `;

        const STATUS_COLOR_MAP = {
            "Gray": "#64748b",
            "Grey": "#64748b",
            "Blue": "#0369a1",
            "Green": "#15803d",
            "Orange": "#d97706",
            "Red": "#dc2626",
            "Yellow": "#ca8a04",
            "Purple": "#7c3aed",
            "Pink": "#db2777",
            "Cyan": "#0891b2",
            "Black": "#1f2937"
        };

        let statuses = this.enabled_statuses || [
            {name: "Open", color: "Gray"},
            {name: "Working", color: "Blue"},
            {name: "Resolved", color: "Green"},
            {name: "Pending", color: "Orange"}
        ];

        statuses.forEach(status => {
            let count = summary[status.name] || 0;
            let color_val = (status.color && status.color.startsWith("#"))
                ? status.color
                : (STATUS_COLOR_MAP[status.color] || "#64748b");
            
            html += `
                <div class="ct-summary-card ${current_status === status.name ? "active" : ""}" data-status="${status.name}" style="border-top-color: ${color_val}; cursor: pointer;">
                    <div class="ct-summary-val">${count}</div>
                    <div class="ct-summary-label">${status.name}</div>
                </div>
            `;
        });

        row_container.html(html);

        // Dynamically populate filter status select dropdown
        let status_select = this.wrapper.find("#ct-filter-status");
        if (status_select.length && this.enabled_statuses) {
            let current_val = status_select.val() || "";
            let options_html = '<option value="">All Statuses</option>';
            this.enabled_statuses.forEach(status => {
                options_html += `<option value="${status.name}">${status.name}</option>`;
            });
            status_select.html(options_html);
            status_select.val(current_val);
        }
    }

    get_status_badge(status, ticket_name) {
        let status_obj = this.enabled_statuses ? this.enabled_statuses.find(s => s.name === status) : null;
        let color = status_obj ? status_obj.color : "Gray";

        const BADGE_COLOR_MAP = {
            "Gray": { bg: "#f1f5f9", text: "#475569" },
            "Grey": { bg: "#f1f5f9", text: "#475569" },
            "Blue": { bg: "#e0f2fe", text: "#0369a1" },
            "Green": { bg: "#dcfce7", text: "#15803d" },
            "Orange": { bg: "#fef3c7", text: "#d97706" },
            "Red": { bg: "#fee2e2", text: "#dc2626" },
            "Yellow": { bg: "#fef9c3", text: "#854d0e" },
            "Purple": { bg: "#f3e8ff", text: "#7c3aed" },
            "Pink": { bg: "#fce7f3", text: "#db2777" },
            "Cyan": { bg: "#ecfeff", text: "#0891b2" },
            "Black": { bg: "#f3f4f6", text: "#1f2937" }
        };

        let badge_style = BADGE_COLOR_MAP[color] || BADGE_COLOR_MAP["Gray"];
        
        return `
            <span class="ct-badge" 
                  onclick="event.stopPropagation(); frappe.pages['chief-technician-das']._dashboard.open_status_change_dialog('${ticket_name}', '${status}')" 
                  style="background-color: ${badge_style.bg}; color: ${badge_style.text}; cursor:pointer;" 
                  title="Change status">
                ${status} <i class="fa fa-pencil" style="font-size:8px; margin-left:2px;"></i>
            </span>
        `;
    }

    get_resolved_date_formatted(t) {
        let is_resolved = ["Resolved", "Closed", "Self-Completed"].includes(t.status);
        if (!is_resolved) return null;
        let date_val = t.resolution_date || t.modified;
        if (!date_val) return null;
        return frappe.datetime.global_date_format(date_val);
    }
    get_resolved_by_formatted(t) {
        let is_resolved = ["Resolved", "Closed", "Self-Completed"].includes(t.status);
        if (!is_resolved) return null;
        let assignees = [];
        try { assignees = JSON.parse(t._assign || "[]"); } catch(e) { assignees = []; }
        if (!assignees.length) return null;
        return frappe.user.full_name(assignees[0]) || assignees[0];
    }
    render_ticket_cards(tickets) {
        let self = this;
        let container = this.wrapper.find("#ct-tickets-container");
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
            
         let status_badge = self.get_status_badge(t.status, t.name);
        let priority_badge = `<span class="ct-badge ct-badge-priority-${t.priority}">${t.priority}</span>`;
        let res_date = self.get_resolved_date_formatted(t);
        let resolved_by = self.get_resolved_by_formatted(t);
        let res_date_html = res_date 
            ? `<div><i class="fa fa-check-circle" style="color: #10b981;"></i> <span>Resolved Date: <strong>${res_date}</strong></span></div>
            ${resolved_by ? `<div><i class="fa fa-user-o" style="color: #10b981;"></i> <span>Resolved by: <strong>${resolved_by}</strong></span></div>` : ""}` 
            : "";
            
            return `
                <div class="ct-ticket-card" onclick="window.location.href='/helpdesk/tickets/${t.name}'">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span class="ct-ticket-id">${t.name}</span>
                        <div class="ct-card-badges">${status_badge}${priority_badge}</div>
                    </div>
                    <h3 class="ct-ticket-subject">${t.custom_customer_name || t.customer || 'N/A'}</h3>
                    
                    <div class="ct-card-meta">
                        <div><i class="fa fa-user"></i> <span>Customer: <strong>${t.custom_customer_name || t.customer || 'N/A'}</strong></span></div>
                        <div><i class="fa fa-calendar-o"></i> <span>Date: ${t.custom_date ? frappe.datetime.global_date_format(t.custom_date) : 'N/A'}</span></div>
                        ${res_date_html}
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
        let self = this;
        let container = this.wrapper.find("#ct-tickets-container");
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
            
            let status_badge = self.get_status_badge(t.status, t.name);
            let priority_badge = `<span class="ct-badge ct-badge-priority-${t.priority}">${t.priority}</span>`;
            let res_date = self.get_resolved_date_formatted(t);
            let resolved_by = self.get_resolved_by_formatted(t);
            let res_date_html = res_date 
                ? `<div><i class="fa fa-check-circle" style="color: #10b981;"></i> <span>Resolved Date: <strong>${res_date}</strong></span></div>
                ${resolved_by ? `<div><i class="fa fa-user-o" style="color: #10b981;"></i> <span>Resolved by: <strong>${resolved_by}</strong></span></div>` : ""}` 
                : "";
            
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
                        <div><strong>Cust:</strong> ${t.custom_customer_name || t.customer || 'N/A'}</div>
                        ${res_date_html}
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
        let self = this;
        let container = this.wrapper.find("#ct-tickets-container");
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
                    let res_date = self.get_resolved_date_formatted(t);
                    let resolved_by = self.get_resolved_by_formatted(t);
                    let is_resolved = t.status === 'Resolved' || !!res_date;
                    let bg_color = is_resolved ? "rgba(16, 185, 129, 0.12)" : "var(--ct-primary-light)";
                    let text_color = is_resolved ? "#15803d" : "var(--ct-primary)";
                    let border_color = is_resolved ? "rgba(16, 185, 129, 0.3)" : "rgba(99, 102, 241, 0.2)";
                    let tooltip = t.subject + (res_date ? ` (Resolved: ${res_date}${resolved_by ? ` by ${resolved_by}` : ""})` : "");
                    return `
                        <div class="ct-cal-event" onclick="window.location.href='/helpdesk/tickets/${t.name}'" 
                             style="background: ${bg_color}; color: ${text_color}; padding: 3px 6px; border-radius: 4px; font-size: 11px; margin-bottom: 4px; cursor: pointer; border: 1px solid ${border_color}; font-weight:600;" 
                             title="${tooltip}">
                            <div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${t.subject}</div>
                            ${res_date ? `<div style="font-size: 9px; font-weight: 700; color: #15803d; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"><i class="fa fa-check-circle" style="font-size: 8px;"></i> ${res_date}</div>${resolved_by ? `<div style="font-size: 9px; font-weight: 600; color: #64748b; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Resolved by ${resolved_by}</div>` : ""}` : ""}
                        </div>
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
        let container = this.wrapper.find("#ct-tickets-pagination");
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
                    
                    self.wrapper.find("#ct-chart-status").empty();
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
                    
                    self.wrapper.find("#ct-chart-priority").empty();
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
        let container = this.wrapper.find("#ct-leaderboard-container");
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
                        if (self.map_provider === "osm") {
                            self.render_all_tech_osm_map(data.markers);
                        } else {
                            self.render_all_tech_map(data.markers);
                        }
                        self.wrapper.find("#ct-map-summary-row").hide();
                        self.wrapper.find("#ct-map-timeline-container").hide();
                    } else {
                        if (self.map_provider === "osm") {
                            self.render_tech_route_osm_map(data.visits);
                        } else {
                            self.render_tech_route_map(data.visits);
                        }
                        self.render_map_summary(data.summary);
                        self.render_map_timeline(data.visits);
                        self.wrapper.find("#ct-map-summary-row").css("display", "grid");
                        self.wrapper.find("#ct-map-timeline-container").show();
                    }
                }
            }
        });
    }

    render_all_tech_osm_map(markers) {
        let self = this;
        if (!self.leaflet_map) return;

        (self.leaflet_markers || []).forEach(m => { if(m && m.remove) m.remove(); });
        (self.leaflet_polylines || []).forEach(p => { if(p && p.remove) p.remove(); });
        self.leaflet_markers = [];
        self.leaflet_polylines = [];

        let bounds = L.latLngBounds();
        let legend_html = "";
        let route_colors = ["#6366f1", "#10b981", "#f59e0b", "#ec4899", "#3b82f6", "#8b5cf6"];

        markers.forEach((log, index) => {
            if (!log.latitude || !log.longitude) return;
            let lat = parseFloat(log.latitude);
            let lng = parseFloat(log.longitude);
            let tech_color = route_colors[index % route_colors.length];
            let tech_name = frappe.user.full_name(log.user) || log.user;

            legend_html += `<div class="ct-map-legend-item">
                <div style="width:16px;height:16px;border-radius:50%;background:${tech_color};display:inline-block;vertical-align:middle;margin-right:6px;"></div>
                ${tech_name}</div>`;

            let iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">` +
                `<circle cx="14" cy="14" r="12" fill="${tech_color}" stroke="white" stroke-width="2"/>` +
                `<text x="14" y="19" text-anchor="middle" fill="white" font-size="12" font-weight="bold" font-family="sans-serif">T</text></svg>`;

            let customIcon = L.divIcon({
                className: "ct-osm-custom-marker",
                html: iconSvg,
                iconSize: [28, 28],
                iconAnchor: [14, 14]
            });

            let time_only = frappe.datetime.get_time(log.creation).substring(0, 5);
            let iwContent = `<div style="font-family:'Inter',sans-serif;padding:4px;width:240px;">
                <div style="font-weight:800;font-size:13px;margin-bottom:4px;">${tech_name}</div>
                <div style="font-size:11px;color:#64748b;margin-bottom:6px;font-weight:600;">Latest location at ${time_only}</div>
                <div style="font-size:12px;line-height:1.4;border-top:1px solid #f1f5f9;padding-top:6px;">
                    <strong>Ticket:</strong> <a href="/helpdesk/tickets/${log.ticket}" style="color:#6366f1;font-weight:700;">${log.ticket}</a><br>
                    <strong>Customer:</strong> ${log.customer || "N/A"}<br>
                    <strong>Status:</strong> ${log.status || "N/A"}<br>
                    <strong>Address:</strong> <span style="color:#475569;">${log.display_address || "N/A"}</span><br>
                    <strong>Lat & Long:</strong> <a href="#" class="ct-popup-gmap-link" data-lat="${lat}" data-lng="${lng}" style="color:#6366f1;font-weight:700;text-decoration:underline;" title="View on Google Maps"><i class="fa fa-map-marker"></i> ${lat.toFixed(5)}, ${lng.toFixed(5)}</a>
                </div></div>`;

            let marker = L.marker([lat, lng], { icon: customIcon, title: tech_name })
                .addTo(self.leaflet_map)
                .bindPopup(iwContent);

            self.leaflet_markers.push(marker);
            bounds.extend([lat, lng]);
        });

        self.wrapper.find("#ct-map-legend-routes").html(legend_html);
        if (bounds.isValid()) {
            self.leaflet_map.fitBounds(bounds, { padding: [30, 30] });
        } else {
            self.leaflet_map.setView([20.5937, 78.9629], 5);
        }
        setTimeout(() => {
            if (self.leaflet_map) { try { self.leaflet_map.invalidateSize(); } catch(e){} }
        }, 200);
    }

    render_tech_route_osm_map(visits) {
        let self = this;
        if (!self.leaflet_map) return;

        (self.leaflet_markers || []).forEach(m => { if(m && m.remove) m.remove(); });
        (self.leaflet_polylines || []).forEach(p => { if(p && p.remove) p.remove(); });
        self.leaflet_markers = [];
        self.leaflet_polylines = [];

        let bounds = L.latLngBounds();
        let tech_color = "#3b82f6";
        let tech_name = this.map_filters.technician ? frappe.user.full_name(this.map_filters.technician) : "";

        self.wrapper.find("#ct-map-legend-routes").html(`
            <div class="ct-map-legend-item"><div style="width:16px;height:3px;background:${tech_color};border-radius:2px;display:inline-block;vertical-align:middle;margin-right:6px;"></div>${tech_name} Journey</div>
            <div class="ct-map-legend-item"><span class="badge" style="background:#10b981;color:white;font-size:9px;padding:2px 4px;margin-right:6px;">START</span>First Ticket</div>
            <div class="ct-map-legend-item"><span class="badge" style="background:#ef4444;color:white;font-size:9px;padding:2px 4px;margin-right:6px;">END</span>Last Ticket</div>`);

        let path = visits.filter(v => v.latitude && v.longitude)
                         .map(v => [parseFloat(v.latitude), parseFloat(v.longitude)]);

        if (path.length > 1) {
            let polyline = L.polyline(path, { color: tech_color, opacity: 0.85, weight: 4 }).addTo(self.leaflet_map);
            self.leaflet_polylines.push(polyline);

            for (let i = 0; i < path.length - 1; i++) {
                let p1 = path[i], p2 = path[i + 1];
                let angle = Math.atan2(p2[0] - p1[0], p2[1] - p1[1]) * 180 / Math.PI;
                let arrowSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><g transform="rotate(${angle},8,8)"><polygon points="8,2 14,14 8,10 2,14" fill="${tech_color}" opacity="0.9"/></g></svg>`;
                let arrowIcon = L.divIcon({
                    className: "ct-osm-arrow",
                    html: arrowSvg,
                    iconSize: [16, 16],
                    iconAnchor: [8, 8]
                });
                let midLat = (p1[0] + p2[0]) / 2;
                let midLng = (p1[1] + p2[1]) / 2;
                let arrowMarker = L.marker([midLat, midLng], { icon: arrowIcon, interactive: false }).addTo(self.leaflet_map);
                self.leaflet_markers.push(arrowMarker);
            }
        }

        self.map_markers = {};

        visits.forEach((v, index) => {
            if (!v.latitude || !v.longitude) return;
            let lat = parseFloat(v.latitude);
            let lng = parseFloat(v.longitude);
            let pin_color = index === 0 ? "#10b981" : (index === visits.length - 1 ? "#ef4444" : "#64748b");
            let lbl = String(index + 1);
            let pinSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="42" viewBox="0 0 32 42">` +
                `<path d="M16 0C7.163 0 0 7.163 0 16c0 12 16 26 16 26s16-14 16-26C32 7.163 24.837 0 16 0z" fill="${pin_color}"/>` +
                `<circle cx="16" cy="16" r="9" fill="white" opacity="0.25"/>` +
                `<text x="16" y="21" text-anchor="middle" fill="white" font-size="${lbl.length > 1 ? "9" : "11"}" font-weight="800" font-family="sans-serif">${lbl}</text></svg>`;

            let pinIcon = L.divIcon({
                className: "ct-osm-pin",
                html: pinSvg,
                iconSize: [32, 42],
                iconAnchor: [16, 42],
                popupAnchor: [0, -36]
            });

            let fmt = (t) => t ? frappe.datetime.get_time(t).substring(0, 5) : "N/A";
            let dur = "N/A";
            if (v.time_spent_seconds !== null && v.time_spent_seconds !== undefined) {
                let hrs = Math.floor(v.time_spent_seconds / 3600), mins = Math.floor((v.time_spent_seconds % 3600) / 60);
                dur = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
            }
            let iwContent = `<div style="font-family:'Inter',sans-serif;padding:4px;width:240px;">
                <div style="font-weight:800;font-size:14px;margin-bottom:4px;">Ticket #${index + 1}</div>
                <div style="font-size:12px;line-height:1.5;border-top:1px solid #f1f5f9;padding-top:6px;">
                    <strong>Ticket ID:</strong> <a href="/helpdesk/tickets/${v.ticket}" style="color:#6366f1;font-weight:700;">${v.ticket}</a><br>
                    <strong>Customer:</strong> ${v.customer || "N/A"}<br>
                    <strong>Status:</strong> ${v.status}<br>
                    <strong>In:</strong> ${fmt(v.check_in)} | <strong>Out:</strong> ${fmt(v.check_out)}<br>
                    <strong>Time Spent:</strong> ${dur}<br>
                    <strong>Address:</strong> <span style="color:#475569;font-size:11px;">${v.address || "N/A"}</span><br>
                    <strong>Lat & Long:</strong> <a href="#" class="ct-popup-gmap-link" data-lat="${lat}" data-lng="${lng}" style="color:#6366f1;font-weight:700;text-decoration:underline;" title="View on Google Maps"><i class="fa fa-map-marker"></i> ${lat.toFixed(5)}, ${lng.toFixed(5)}</a>
                </div></div>`;

            let marker = L.marker([lat, lng], { icon: pinIcon, title: `Ticket #${index + 1}: ${v.ticket}` })
                .addTo(self.leaflet_map)
                .bindPopup(iwContent);

            marker.on("click", () => {
                $(".ct-timeline-item").removeClass("active").css({"border-color": "transparent", "background": "white"});
                let t_el = $(`#timeline-item-${v.ticket}`);
                if (t_el.length) { 
                    t_el.addClass("active").css({"border-color": "var(--ct-primary)", "background": "#f8fafc"}); 
                    t_el[0].scrollIntoView({behavior:"smooth",block:"nearest",inline:"center"}); 
                }
            });

            self.leaflet_markers.push(marker);
            self.map_markers[v.ticket] = { marker, is_osm: true };
            bounds.extend([lat, lng]);
        });

        if (bounds.isValid()) {
            self.leaflet_map.fitBounds(bounds, { padding: [30, 30] });
        } else {
            self.leaflet_map.setView([20.5937, 78.9629], 5);
        }
        setTimeout(() => {
            if (self.leaflet_map) { try { self.leaflet_map.invalidateSize(); } catch(e){} }
        }, 200);
    }

    render_all_tech_map(markers) {
        let self = this;
        if (!self.map) return;

        (self.gm_markers || []).forEach(m => m.setMap(null));
        (self.gm_polylines || []).forEach(p => p.setMap(null));
        self.gm_markers = [];
        self.gm_polylines = [];
        if (self._open_info_window) { self._open_info_window.close(); self._open_info_window = null; }

        let bounds = new google.maps.LatLngBounds();
        let legend_html = "";
        let route_colors = ["#6366f1", "#10b981", "#f59e0b", "#ec4899", "#3b82f6", "#8b5cf6"];

        markers.forEach((log, index) => {
            if (!log.latitude || !log.longitude) return;
            let tech_color = route_colors[index % route_colors.length];
            let tech_name = frappe.user.full_name(log.user) || log.user;

            legend_html += `<div class="ct-map-legend-item">
                <div style="width:16px;height:16px;border-radius:50%;background:${tech_color};display:inline-block;vertical-align:middle;margin-right:6px;"></div>
                ${tech_name}</div>`;

            let icon = {
                url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(
                    `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">` +
                    `<circle cx="14" cy="14" r="12" fill="${tech_color}" stroke="white" stroke-width="2"/>` +
                    `<text x="14" y="19" text-anchor="middle" fill="white" font-size="12" font-weight="bold" font-family="sans-serif">T</text></svg>`
                ),
                scaledSize: new google.maps.Size(28, 28),
                anchor: new google.maps.Point(14, 14)
            };
            let marker = new google.maps.Marker({
                position: { lat: parseFloat(log.latitude), lng: parseFloat(log.longitude) },
                map: self.map, icon, title: tech_name
            });
            let time_only = frappe.datetime.get_time(log.creation).substring(0, 5);
            let lat_num = parseFloat(log.latitude), lng_num = parseFloat(log.longitude);
            let iw = new google.maps.InfoWindow({ content:
                `<div style="font-family:'Inter',sans-serif;padding:4px;width:240px;">
                <div style="font-weight:800;font-size:13px;margin-bottom:4px;">${tech_name}</div>
                <div style="font-size:11px;color:#64748b;margin-bottom:6px;font-weight:600;">Latest location at ${time_only}</div>
                <div style="font-size:12px;line-height:1.4;border-top:1px solid #f1f5f9;padding-top:6px;">
                    <strong>Ticket:</strong> <a href="/helpdesk/tickets/${log.ticket}" style="color:#6366f1;font-weight:700;">${log.ticket}</a><br>
                    <strong>Customer:</strong> ${log.customer || "N/A"}<br>
                    <strong>Status:</strong> ${log.status || "N/A"}<br>
                    <strong>Address:</strong> <span style="color:#475569;">${log.display_address || "N/A"}</span><br>
                    <strong>Lat & Long:</strong> <a href="#" class="ct-popup-gmap-link" data-lat="${lat_num}" data-lng="${lng_num}" style="color:#6366f1;font-weight:700;text-decoration:underline;" title="View on Google Maps"><i class="fa fa-map-marker"></i> ${lat_num.toFixed(5)}, ${lng_num.toFixed(5)}</a>
                </div></div>`
            });
            marker.addListener("click", () => {
                if (self._open_info_window) self._open_info_window.close();
                iw.open(self.map, marker);
                self._open_info_window = iw;
            });
            self.gm_markers.push(marker);
            bounds.extend({ lat: parseFloat(log.latitude), lng: parseFloat(log.longitude) });
        });

        self.wrapper.find("#ct-map-legend-routes").html(legend_html);
        if (!bounds.isEmpty()) {
            self.map.fitBounds(bounds);
        } else {
            self.map.setCenter({ lat: 20.5937, lng: 78.9629 });
            self.map.setZoom(5);
        }
    }
    render_tech_route_map(visits) {
        let self = this;
        if (!self.map) return;

        (self.gm_markers || []).forEach(m => m.setMap(null));
        (self.gm_polylines || []).forEach(p => p.setMap(null));
        self.gm_markers = [];
        self.gm_polylines = [];
        if (self._open_info_window) { self._open_info_window.close(); self._open_info_window = null; }

        let bounds = new google.maps.LatLngBounds();
        let tech_color = "#3b82f6";
        let tech_name = this.map_filters.technician ? frappe.user.full_name(this.map_filters.technician) : "";

        self.wrapper.find("#ct-map-legend-routes").html(`
            <div class="ct-map-legend-item"><div style="width:16px;height:3px;background:${tech_color};border-radius:2px;display:inline-block;vertical-align:middle;margin-right:6px;"></div>${tech_name} Journey</div>
            <div class="ct-map-legend-item"><span class="badge" style="background:#10b981;color:white;font-size:9px;padding:2px 4px;margin-right:6px;">START</span>First Ticket</div>
            <div class="ct-map-legend-item"><span class="badge" style="background:#ef4444;color:white;font-size:9px;padding:2px 4px;margin-right:6px;">END</span>Last Ticket</div>`);

        if (visits.length > 1) {
            let path = visits.filter(v => v.latitude && v.longitude)
                             .map(v => ({ lat: parseFloat(v.latitude), lng: parseFloat(v.longitude) }));
            let polyline = new google.maps.Polyline({ path, geodesic: true, strokeColor: tech_color, strokeOpacity: 0.85, strokeWeight: 4, map: self.map });
            self.gm_polylines.push(polyline);
            for (let i = 0; i < path.length - 1; i++) {
                let p1 = path[i], p2 = path[i + 1];
                let angle = Math.atan2(p2.lat - p1.lat, p2.lng - p1.lng) * 180 / Math.PI;
                let arrowSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><g transform="rotate(${angle},8,8)"><polygon points="8,2 14,14 8,10 2,14" fill="${tech_color}" opacity="0.9"/></g></svg>`;
                let arrow = new google.maps.Marker({
                    position: { lat: (p1.lat + p2.lat) / 2, lng: (p1.lng + p2.lng) / 2 },
                    map: self.map, clickable: false, zIndex: 1,
                    icon: { url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(arrowSvg), scaledSize: new google.maps.Size(16, 16), anchor: new google.maps.Point(8, 8) }
                });
                self.gm_markers.push(arrow);
            }
        }

        self.map_markers = {};

        visits.forEach((v, index) => {
            if (!v.latitude || !v.longitude) return;
            let pin_color = index === 0 ? "#10b981" : (index === visits.length - 1 ? "#ef4444" : "#64748b");
            let lbl = String(index + 1);
            let pinSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="42" viewBox="0 0 32 42">` +
                `<path d="M16 0C7.163 0 0 7.163 0 16c0 12 16 26 16 26s16-14 16-26C32 7.163 24.837 0 16 0z" fill="${pin_color}"/>` +
                `<circle cx="16" cy="16" r="9" fill="white" opacity="0.25"/>` +
                `<text x="16" y="21" text-anchor="middle" fill="white" font-size="${lbl.length > 1 ? "9" : "11"}" font-weight="800" font-family="sans-serif">${lbl}</text></svg>`;
            let marker = new google.maps.Marker({
                position: { lat: parseFloat(v.latitude), lng: parseFloat(v.longitude) },
                map: self.map, zIndex: 10, title: `Ticket #${index + 1}: ${v.ticket}`,
                icon: { url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(pinSvg), scaledSize: new google.maps.Size(32, 42), anchor: new google.maps.Point(16, 42) }
            });
            let fmt = (t) => t ? frappe.datetime.get_time(t).substring(0, 5) : "N/A";
            let dur = "N/A";
            if (v.time_spent_seconds !== null && v.time_spent_seconds !== undefined) {
                let hrs = Math.floor(v.time_spent_seconds / 3600), mins = Math.floor((v.time_spent_seconds % 3600) / 60);
                dur = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
            }
            let lat_num = parseFloat(v.latitude), lng_num = parseFloat(v.longitude);
            let iw = new google.maps.InfoWindow({ content:
                `<div style="font-family:'Inter',sans-serif;padding:4px;width:240px;">
                <div style="font-weight:800;font-size:14px;margin-bottom:4px;">Ticket #${index + 1}</div>
                <div style="font-size:12px;line-height:1.5;border-top:1px solid #f1f5f9;padding-top:6px;">
                    <strong>Ticket ID:</strong> <a href="/helpdesk/tickets/${v.ticket}" style="color:#6366f1;font-weight:700;">${v.ticket}</a><br>
                    <strong>Customer:</strong> ${v.customer || "N/A"}<br>
                    <strong>Status:</strong> ${v.status}<br>
                    <strong>In:</strong> ${fmt(v.check_in)} | <strong>Out:</strong> ${fmt(v.check_out)}<br>
                    <strong>Time Spent:</strong> ${dur}<br>
                    <strong>Address:</strong> <span style="color:#475569;font-size:11px;">${v.address || "N/A"}</span><br>
                    <strong>Lat & Long:</strong> <a href="#" class="ct-popup-gmap-link" data-lat="${lat_num}" data-lng="${lng_num}" style="color:#6366f1;font-weight:700;text-decoration:underline;" title="View on Google Maps"><i class="fa fa-map-marker"></i> ${lat_num.toFixed(5)}, ${lng_num.toFixed(5)}</a>
                </div></div>`
            });
            marker.addListener("click", () => {
                if (self._open_info_window) self._open_info_window.close();
                iw.open(self.map, marker);
                self._open_info_window = iw;
                $(".ct-timeline-item").removeClass("active").css({"border-color": "transparent", "background": "white"});
                let t_el = $(`#timeline-item-${v.ticket}`);
                if (t_el.length) { t_el.addClass("active").css({"border-color": "var(--ct-primary)", "background": "#f8fafc"}); t_el[0].scrollIntoView({behavior:"smooth",block:"nearest",inline:"center"}); }
            });
            self.gm_markers.push(marker);
            self.map_markers[v.ticket] = { marker, iw };
            bounds.extend({ lat: parseFloat(v.latitude), lng: parseFloat(v.longitude) });
        });

        if (!bounds.isEmpty()) {
            self.map.fitBounds(bounds);
        } else {
            self.map.setCenter({ lat: 20.5937, lng: 78.9629 });
            self.map.setZoom(5);
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
                let item = self.map_markers[t_id];
                if (item.is_osm) {
                    if (item.marker) {
                        item.marker.openPopup();
                        if (self.leaflet_map) self.leaflet_map.panTo(item.marker.getLatLng());
                    }
                } else {
                    let { marker, iw } = item;
                    if (self._open_info_window) self._open_info_window.close();
                    if (iw && self.map) {
                        iw.open(self.map, marker);
                        self._open_info_window = iw;
                        self.map.panTo(marker.getPosition());
                    }
                }
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
        if (this.filters.ticket_type) pills_html += `<span class="ct-filter-pill">Type: ${this.filters.ticket_type} <i class="fa fa-times ct-filter-remove" data-key="ticket_type"></i></span>`;
        if (this.search_query) pills_html += `<span class="ct-filter-pill">Search: ${this.search_query} <i class="fa fa-times ct-filter-remove" data-key="search"></i></span>`;
        
        container.html(pills_html);
        
        // Remove filters
        let self = this;
        container.off("click", ".ct-filter-remove").on("click", ".ct-filter-remove", function() {
            let key = $(this).data("key");
            if (key === "technician") {
                self.tech_control.set_value("");
                return; // tech_control.set_value("") triggers onchange, which handles pagination reset and load_data
            }
            if (key === "ticket_type") {
                self.ticket_type_control.set_value("");
                return; // triggers onchange → reset_pagination + load_data
            }
            if (key === "search") {
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
        let options = this.enabled_status_names && this.enabled_status_names.length 
            ? this.enabled_status_names 
            : ["Open", "Working", "Pending", "Resolved"];
        let d = new frappe.ui.Dialog({
            title: __("Change Ticket Status"),
            fields: [
                { label: "New Status", fieldname: "status", fieldtype: "Select", options: options, default: current_status, reqd: 1 }
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
        d.onhide = () => {
            d.$wrapper.remove();
        };
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
        let container = this.wrapper.find("#ct-attendance-list-container");
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
            
            let accuracy_indicator = "";
            let acc = log.custom_accuracy || log.accuracy;
            if (acc) {
                if (acc > 100) {
                    accuracy_indicator = `<br><span class="badge" style="background: #fffbeb; color: #b45309; border: 1px solid #fef3c7; font-size: 10px; margin-top: 4px; display: inline-block;" title="Accuracy: ${acc} meters"><i class="fa fa-warning"></i> Low Accuracy GPS (±${Math.round(acc)}m)</span>`;
                } else {
                    accuracy_indicator = `<br><span style="color: #10b981; font-size: 11px; font-weight: 600; margin-top: 2px; display: inline-block;">±${Math.round(acc)}m accuracy</span>`;
                }
            }

            let lat = log.latitude !== null && log.latitude !== undefined ? parseFloat(log.latitude) : null;
            let lng = log.longitude !== null && log.longitude !== undefined ? parseFloat(log.longitude) : null;

            let location_str = (lat !== null && lng !== null && !isNaN(lat) && !isNaN(lng)) 
                ? `<a href="javascript:void(0)" class="ct-attendance-map-link" data-lat="${lat}" data-lng="${lng}" style="color: var(--ct-primary); font-weight: 600;"><i class="fa fa-map-marker"></i> ${lat.toFixed(5)}, ${lng.toFixed(5)}</a>`
                : "-";
            
            if (lat !== null && lng !== null && !isNaN(lat) && !isNaN(lng) && accuracy_indicator) {
                location_str += accuracy_indicator;
            }

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
        let container = this.wrapper.find("#ct-attendance-pagination");
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
        let self = this;
        let map_id = "ct-popup-map-" + Math.random().toString(36).substring(2, 9);

        let d = new frappe.ui.Dialog({
            title: __("Check-in Location"),
            fields: [{ fieldtype: "HTML", fieldname: "map_html" }]
        });

        d.onhide = () => { d.$wrapper.remove(); };
        d.get_field("map_html").$wrapper.html(`<div id="${map_id}" style="height:400px;width:100%;border-radius:8px;"></div>`);
        d.show();

        setTimeout(() => {
            if (self.map_provider === "osm") {
                self._load_leaflet(() => {
                    let el = document.getElementById(map_id);
                    if (!el) return;
                    try {
                        let popup_map = L.map(el, { preferCanvas: true }).setView([lat, lng], 15);

                        // Same primary/fallback tile strategy as the main Technician Map:
                        // standard OpenStreetMap tiles first, Wikimedia's OSM tiles (different
                        // host/CDN) as a fallback if that fails. Both are free, no API key.
                        let primaryTile = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                            maxZoom: 19,
                            subdomains: 'abc',
                            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                        });
                        let fallbackTile = L.tileLayer('https://maps.wikimedia.org/osm-intl/{z}/{x}/{y}.png', {
                            maxZoom: 19,
                            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                        });
                        let tileErrorHandled = false;
                        primaryTile.on('tileerror', function() {
                            if (!tileErrorHandled) {
                                tileErrorHandled = true;
                                try {
                                    popup_map.removeLayer(primaryTile);
                                    fallbackTile.addTo(popup_map);
                                } catch(e) {}
                            }
                        });
                        primaryTile.addTo(popup_map);

                        L.marker([lat, lng]).addTo(popup_map);
                        setTimeout(() => { try { popup_map.invalidateSize(); } catch(e){} }, 100);
                    } catch(e) {
                        console.error("Error initializing popup OSM map:", e);
                    }
                });
            } else {
                self._load_google_maps(() => {
                    let el = document.getElementById(map_id);
                    if (!el) return;
                    try {
                        let popup_map = new google.maps.Map(el, {
                            center: { lat: lat, lng: lng },
                            zoom: 15,
                            mapTypeControl: false,
                            streetViewControl: false,
                            fullscreenControl: false
                        });
                        new google.maps.Marker({
                            position: { lat: lat, lng: lng },
                            map: popup_map,
                            title: `${lat.toFixed(5)}, ${lng.toFixed(5)}`
                        });
                    } catch(e) {
                        console.error("Error initializing popup map:", e);
                    }
                });
            }
        }, 150);
    }

    open_google_map_popup(lat, lng) {
        let self = this;
        let map_id = "ct-popup-gmap-" + Math.random().toString(36).substring(2, 9);

        let d = new frappe.ui.Dialog({
            title: __("Location Preview (Google Maps)"),
            fields: [{ fieldtype: "HTML", fieldname: "map_html" }]
        });

        d.onhide = () => { d.$wrapper.remove(); };
        d.get_field("map_html").$wrapper.html(`<div id="${map_id}" style="height:400px;width:100%;border-radius:8px;"></div>`);
        d.show();

        setTimeout(() => {
            self._load_google_maps(() => {
                let el = document.getElementById(map_id);
                if (!el) return;
                try {
                    let popup_map = new google.maps.Map(el, {
                        center: { lat: lat, lng: lng },
                        zoom: 15,
                        mapTypeControl: true,
                        streetViewControl: true,
                        fullscreenControl: true
                    });
                    new google.maps.Marker({
                        position: { lat: lat, lng: lng },
                        map: popup_map,
                        title: `${lat.toFixed(5)}, ${lng.toFixed(5)}`
                    });
                } catch(e) {
                    console.error("Error initializing Google map popup:", e);
                }
            });
        }, 150);
    }

}