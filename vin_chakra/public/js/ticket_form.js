/**
 * TicketWidget – Sree Chakra Sewing Systems
 * Fixed: state/district cascade, Tamil Nadu default,
 *        "Other" free-text fallback, south-India states only.
 * Redesigned: thread/bobbin-inspired palette, fully fluid
 *        mobile-first responsive layout (360px → desktop).
 */

(function () {
  'use strict';

  const ROOT_ID = 'ticket-root';

  /* ─── State → Districts map (south India + UT only) ────────────── */
  const STATE_DISTRICTS = {
    'Tamil Nadu': [
      'Ariyalur', 'Chengalpattu', 'Chennai', 'Coimbatore', 'Cuddalore',
      'Dharmapuri', 'Dindigul', 'Erode', 'Kallakurichi', 'Kanchipuram',
      'Kanyakumari', 'Karur', 'Krishnagiri', 'Madurai', 'Mayiladuthurai',
      'Nagapattinam', 'Namakkal', 'Nilgiris', 'Perambalur', 'Pudukkottai',
      'Ramanathapuram', 'Ranipet', 'Salem', 'Sivaganga', 'Tenkasi',
      'Thanjavur', 'Theni', 'Thoothukudi', 'Tiruchirappalli', 'Tirunelveli',
      'Tirupathur', 'Tiruppur', 'Tiruvallur', 'Tiruvannamalai', 'Tiruvarur',
      'Vellore', 'Viluppuram', 'Virudhunagar'
    ],
    'Kerala': [
      'Alappuzha', 'Ernakulam', 'Idukki', 'Kannur', 'Kasaragod', 'Kollam',
      'Kottayam', 'Kozhikode', 'Malappuram', 'Palakkad', 'Pathanamthitta',
      'Thiruvananthapuram', 'Thrissur', 'Wayanad'
    ],
    'Karnataka': [
      'Bagalkot', 'Ballari', 'Belagavi', 'Bengaluru Rural', 'Bengaluru Urban',
      'Bidar', 'Chamarajanagar', 'Chikkaballapur', 'Chikkamagaluru',
      'Chitradurga', 'Dakshina Kannada', 'Davanagere', 'Dharwad', 'Gadag',
      'Hassan', 'Haveri', 'Kalaburagi', 'Kodagu', 'Kolar', 'Koppal',
      'Mandya', 'Mysuru', 'Raichur', 'Ramanagara', 'Shivamogga', 'Tumakuru',
      'Udupi', 'Uttara Kannada', 'Vijayapura', 'Yadgir'
    ],
    'Andhra Pradesh': [
      'Alluri Sitharama Raju', 'Anakapalli', 'Ananthapuramu', 'Annamayya',
      'Bapatla', 'Chittoor', 'Dr. B.R. Ambedkar Konaseema', 'East Godavari',
      'Eluru', 'Guntur', 'Kakinada', 'Krishna', 'Kurnool', 'Nandyal',
      'NTR', 'Palnadu', 'Parvathipuram Manyam', 'Prakasam',
      'Sri Potti Sriramulu Nellore', 'Sri Sathya Sai', 'Srikakulam',
      'Tirupati', 'Visakhapatnam', 'Vizianagaram', 'West Godavari', 'YSR Kadapa'
    ],
    'Telangana': [
      'Adilabad', 'Bhadradri Kothagudem', 'Hanumakonda', 'Hyderabad',
      'Jagtial', 'Jangaon', 'Jayashankar Bhupalpally', 'Jogulamba Gadwal',
      'Kamareddy', 'Karimnagar', 'Khammam', 'Kumuram Bheem Asifabad',
      'Mahabubabad', 'Mahabubnagar', 'Mancherial', 'Medak', 'Medchal–Malkajgiri',
      'Mulugu', 'Nagarkurnool', 'Nalgonda', 'Narayanpet', 'Nirmal',
      'Nizamabad', 'Peddapalli', 'Rajanna Sircilla', 'Rangareddy', 'Sangareddy',
      'Siddipet', 'Suryapet', 'Vikarabad', 'Wanaparthy', 'Warangal',
      'Yadadri Bhuvanagiri'
    ],
    'Puducherry': ['Karaikal', 'Mahe', 'Puducherry', 'Yanam'],
  };

  /* States in display order — Tamil Nadu always first */
  const ALL_STATES = [
    'Tamil Nadu',
    ...Object.keys(STATE_DISTRICTS)
      .filter(s => s !== 'Tamil Nadu')
      .sort((a, b) => a.localeCompare(b)),
    'Other'
  ];

  /* ─── Styles ─────────────────────────────────────────────────────────
     Palette – "workshop thread & brass" system, grounded in the
     subject (a sewing-machine service company): a dark charcoal/enamel
     header like a machine body, a brass accent like hardware trim,
     and thread-red / spool-green for error / success states.
     All layout below is fluid (clamp-based) so it scales smoothly
     from a 360px phone up to desktop instead of jumping at fixed
     breakpoints; a few structural breakpoints remain only where the
     layout must genuinely change shape (grid → single column).
  ──────────────────────────────────────────────────────────────────── */
  /* ─── SVG icons ──────────────────────────────────────────────────── */
  const ICONS = {
    /* thread spool / bobbin — the widget's signature mark */
    ticket: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="3.4" rx="1" fill="currentColor" stroke="none"/><rect x="5" y="17.6" width="14" height="3.4" rx="1" fill="currentColor" stroke="none"/><path d="M8 6.4c0 2.6 8 2.6 8 0M8 11.6c0 2.6 8 2.6 8 0M8 12.4c0 2.6 8 2.6 8 0M8 17.6c0-2.6 8-2.6 8 0"/></svg>`,
    ok: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
    err: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    info: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
    lock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
    user: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
    phone: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.28 2 2 0 0 1 3.6 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.59a16 16 0 0 0 6.05 6.05l.95-.95a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`,
    map: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3V6z"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/></svg>`,
    pin: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`,
    home: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
    wrench: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`,
    calendar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
    tag: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`,
    file: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
    errSmall: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    send: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`,
  };



  /* ─── Tiny element helper ────────────────────────────────────────── */
  const el = (tag, cls) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  };

  /* ─── Widget ─────────────────────────────────────────────────────── */
  class TicketWidget {
    constructor(rootId) {
      this.root = document.getElementById(rootId);
      this.schema = null;
      this.currentStep = 0;
      /* These refs are set during _buildLocationSection, used by _populateDistricts */
      this._stateSelect = null;
      this._districtSelect = null;
      this._districtOtherRow = null;
      this._renderSkeleton();
      this._bootstrap();
    }

    /* ── Skeleton ── */
    _renderSkeleton() {
      const fields = Array.from({ length: 8 }, (_, i) =>
        `<div class="tk-skel-field${i >= 6 ? ' tk-skel-full' : ''}">
           <div class="tk-skel tk-skel-label"></div>
           <div class="tk-skel tk-skel-input" style="height:${i >= 6 ? '106px' : '48px'}"></div>
         </div>`
      ).join('');
      this.root.innerHTML = `
        <div class="tk-card">
          <div class="tk-header">
            <div class="tk-header-inner">
              <div class="tk-logo-wrap">${ICONS.ticket}</div>
              <h1>Raise a Support Ticket</h1><p>Sree Chakra Sewing Systems</p>
            </div>
          </div>
          <div class="tk-skeleton-wrap">
            <div class="tk-skel tk-skel-title"></div>
            <div class="tk-skel-grid">${fields}</div>
            <div class="tk-skel tk-skel-btn"></div>
          </div>
        </div>`;
    }

    /* ── Bootstrap ── */
    async _bootstrap() {
      try {
        await this._fetchSchema();
        this._render();
        this._restoreDraftAndCreatedDoc();
      } catch (e) {
        this.root.innerHTML = `
          <div class="tk-card">
            <div class="tk-header"><div class="tk-header-inner">
              <div class="tk-logo-wrap">${ICONS.ticket}</div>
              <h1>Raise a Support Ticket</h1><p>Sree Chakra Sewing Systems</p>
            </div></div>
            <div class="tk-body">
              <div class="tk-alert error" style="display:flex">${ICONS.err}
                <span>Unable to load form. Please refresh or contact support.</span></div>
            </div>
          </div>`;
      }
    }

    _saveDraftToSession(pendingTarget = null) {
      if (!this._form) return;
      try {
        const draft = {
          currentStep: this.currentStep,
          mainFields: {},
          tableRows: [],
          pendingTarget: pendingTarget
        };

        // 1. Save main form fields
        const inputs = this._form.querySelectorAll('.tk-step-content input, .tk-step-content select, .tk-step-content textarea');
        inputs.forEach(inp => {
          if (inp.closest('.tk-table-widget')) return;
          if (inp.name) {
            draft.mainFields[inp.name] = {
              value: inp.value,
              datasetValue: inp.dataset.value || '',
              customerName: inp.dataset.customerName || ''
            };
          }
        });

        // 2. Save child table rows
        if (this._tableWidgetGroup) {
          const rows = this._tableWidgetGroup.querySelectorAll('tr.tk-table-row');
          rows.forEach(tr => {
            const rowData = {};
            const controls = tr.querySelectorAll('[data-cfname]');
            controls.forEach(ctrl => {
              const cfname = ctrl.dataset.cfname;
              if (cfname) {
                const inp = ctrl.tagName === 'INPUT' || ctrl.tagName === 'SELECT' ? ctrl : ctrl.querySelector('input, select');
                if (inp) {
                  rowData[cfname] = {
                    value: inp.value,
                    datasetValue: inp.dataset.value || '',
                    itemName: inp.dataset.itemName || '',
                    brand: inp.dataset.brand || '',
                    modelNo: inp.dataset.modelNo || '',
                    customerName: inp.dataset.customerName || ''
                  };
                }
              }
            });
            draft.tableRows.push(rowData);
          });
        }

        sessionStorage.setItem('tk_ticket_form_draft', JSON.stringify(draft));
      } catch (err) {
        console.warn('Failed to save draft:', err);
      }
    }

    _restoreDraftAndCreatedDoc() {
      if (!this._form) return;

      const draftJson = sessionStorage.getItem('tk_ticket_form_draft');
      const createdDocJson = sessionStorage.getItem('tk_created_doc');
      const legacyCustJson = sessionStorage.getItem('tk_selected_customer');

      let draft = null;
      let createdData = null;

      if (draftJson) {
        sessionStorage.removeItem('tk_ticket_form_draft');
        try { draft = JSON.parse(draftJson); } catch (e) { console.warn('Failed to parse draft:', e); }
      }

      if (createdDocJson) {
        sessionStorage.removeItem('tk_created_doc');
        try { createdData = JSON.parse(createdDocJson); } catch (e) { console.warn('Failed to parse created doc:', e); }
      }

      // 1. Restore main fields and table rows from draft
      if (draft) {
        if (draft.mainFields) {
          Object.entries(draft.mainFields).forEach(([key, fData]) => {
            const val = typeof fData === 'object' ? fData.value : fData;
            const input = this._form.querySelector(`[name="${key}"]`);
            if (input && val !== undefined && val !== null) {
              input.value = val;
              if (typeof fData === 'object') {
                if (fData.datasetValue) input.dataset.value = fData.datasetValue;
                if (fData.customerName) input.dataset.customerName = fData.customerName;
              }
              if (input.tagName === 'SELECT') {
                input.dispatchEvent(new Event('change'));
              }
            }
          });
        }

        if (draft.tableRows && draft.tableRows.length > 0 && this._tableWidgetGroup) {
          const tbody = this._tableWidgetGroup.querySelector('.tk-table-tbody');
          if (tbody && this._addRowToTable) {
            tbody.innerHTML = '';
            draft.tableRows.forEach(rowData => {
              this._addRowToTable(rowData);
            });
          }
        }
      }

      // 2. Process created document (Customer, Item, or Machine Problem)
      const target = (createdData && createdData.target) || (draft && draft.pendingTarget);

      if (createdData && createdData.doc) {
        const doc = createdData.doc;
        const doctype = createdData.doctype;

        if (doctype === 'Customer') {
          const custObj = {
            value: doc.name,
            label: doc.customer_name || doc.name,
            customer_name: doc.customer_name || doc.name,
            mobile_no: doc.mobile_no || doc.mobile_number || '',
            address_line1: doc.address_line1 || '',
            city: doc.city || '',
            state: doc.state || ''
          };
          const customerInput = this._form.querySelector('[name="customer"]');
          if (customerInput) {
            customerInput.value = custObj.label;
            customerInput.dataset.value = custObj.value;
            customerInput.dataset.customerName = custObj.customer_name;
            this._clearError(customerInput, customerInput.closest('.tk-field') || customerInput);

            const nameInput = this._form.querySelector('[name="custom_customer_name"]');
            if (nameInput && (!nameInput.value || nameInput.value.trim() === '')) {
              nameInput.value = custObj.customer_name;
              this._clearError(nameInput, nameInput.closest('.tk-field') || nameInput);
            }
            if (custObj.mobile_no) {
              const phoneInput = this._form.querySelector('[name="custom_customer_mobile_number"]');
              if (phoneInput && (!phoneInput.value || phoneInput.value.trim() === '')) {
                phoneInput.value = custObj.mobile_no.replace(/\D/g, '').slice(-10);
                this._clearError(phoneInput, phoneInput.closest('.tk-field') || phoneInput);
              }
            }
            if (custObj.address_line1) {
              const addrInput = this._form.querySelector('[name="custom_address"]');
              if (addrInput && (!addrInput.value || addrInput.value.trim() === '')) {
                addrInput.value = custObj.address_line1;
                this._clearError(addrInput, addrInput.closest('.tk-field') || addrInput);
              }
            }
            if (custObj.city) {
              const cityInput = this._form.querySelector('[name="custom_city__district_"]');
              if (cityInput && (!cityInput.value || cityInput.value.trim() === '')) {
                cityInput.value = custObj.city;
                this._clearError(cityInput, cityInput.closest('.tk-field') || cityInput);
              }
            }
            if (custObj.state && this._stateSelect) {
              this._stateSelect.value = custObj.state;
              this._stateSelect.dispatchEvent(new Event('change'));
            }
            this._renderCustomerDetailsCard(custObj, customerInput.closest('.tk-field') || customerInput.parentElement);
          }
        }
        else if (doctype === 'Item' || doctype === 'Machine Problem') {
          const itemObj = doctype === 'Item' ? {
            value: doc.name,
            label: doc.item_name || doc.name,
            itemName: doc.item_name || doc.name,
            brand: doc.brand || '',
            modelNo: doc.custom_model_no || doc.model_no || ''
          } : {
            value: doc.name,
            label: doc.machine_problem || doc.problem_name || doc.name,
            itemName: doc.machine_problem || doc.problem_name || doc.name,
            problem_name: doc.machine_problem || doc.problem_name || doc.name
          };

          if (this._tableWidgetGroup) {
            const tbody = this._tableWidgetGroup.querySelector('.tk-table-tbody');
            const rows = tbody ? tbody.querySelectorAll('tr.tk-table-row') : [];
            let targetRow = null;
            if (target && target.rowIndex !== null && target.rowIndex !== undefined && rows[target.rowIndex]) {
              targetRow = rows[target.rowIndex];
            } else if (rows.length > 0) {
              targetRow = rows[rows.length - 1];
            }

            if (targetRow) {
              const targetFieldname = (target && target.fieldname) || (doctype === 'Item' ? 'machine_type' : 'machine_problem');
              const comboWrap = targetRow.querySelector(`[data-cfname="${targetFieldname}"]`)?.closest('.tk-combo');
              if (comboWrap && comboWrap._selectOpt) {
                comboWrap._selectOpt(itemObj);
              } else {
                const inp = targetRow.querySelector(`[data-cfname="${targetFieldname}"]`);
                if (inp) {
                  inp.value = itemObj.label;
                  inp.dataset.value = itemObj.value;
                  inp.dataset.itemName = itemObj.itemName;
                  if (itemObj.brand) inp.dataset.brand = itemObj.brand;
                  if (itemObj.modelNo) inp.dataset.modelNo = itemObj.modelNo;
                }
              }
            }
          }
        }
      } else if (legacyCustJson) {
        sessionStorage.removeItem('tk_selected_customer');
        try {
          const cust = JSON.parse(legacyCustJson);
          const customerInput = this._form.querySelector('[name="customer"]');
          if (customerInput && cust.name) {
            customerInput.value = cust.customer_name || cust.name;
            customerInput.dataset.value = cust.name;
            customerInput.dataset.customerName = cust.customer_name || cust.name;
            this._renderCustomerDetailsCard(cust, customerInput.closest('.tk-field') || customerInput.parentElement);
          }
        } catch (e) {}
      }

      // Restore active step
      if (draft && draft.currentStep !== undefined && draft.currentStep !== null) {
        this._goToStep(draft.currentStep);
      }
    }

    _escape(str) {
      if (!str) return '';
      return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    _renderCustomerDetailsCard(customerData, parentWrap) {
      if (!parentWrap && this._form) {
        const custInp = this._form.querySelector('[name="customer"]');
        if (custInp) {
          parentWrap = custInp.closest('.tk-field') || custInp.parentElement;
        }
      }
      if (!parentWrap) return;

      let card = parentWrap.querySelector('.tk-customer-card');
      if (!customerData) {
        if (card) card.remove();
        return;
      }

      const customerId = typeof customerData === 'object' ? (customerData.value || customerData.name) : customerData;
      if (!customerId) {
        if (card) card.remove();
        return;
      }

      if (!card) {
        card = document.createElement('div');
        card.className = 'tk-customer-card';
        parentWrap.appendChild(card);
      }

      const initialName = typeof customerData === 'object' ? (customerData.customer_name || customerData.label || customerId) : customerId;
      const initialMobile = typeof customerData === 'object' ? (customerData.mobile_no || '') : '';
      const initialSecMobile = typeof customerData === 'object' ? (customerData.secondary_phone || customerData.custom_secondary_phone || '') : '';
      const initialAddr = typeof customerData === 'object' ? ([customerData.address_line1, customerData.city, customerData.state].filter(Boolean).join(', ')) : '';

      card.innerHTML = `
        <div class="tk-customer-card-header">
          <div class="tk-customer-card-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
              <circle cx="12" cy="7" r="4"></circle>
            </svg>
            <span>Customer Details</span>
          </div>
          <button type="button" class="tk-btn-edit-customer" title="Edit Customer in Desk">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
            <span>Edit Customer</span>
          </button>
        </div>
        <div class="tk-customer-card-body">
          <div class="tk-cust-info-grid">
            <div class="tk-cust-info-item"><strong>Name:</strong> <span class="cust-val-name">${this._escape(initialName)}</span></div>
            <div class="tk-cust-info-item"><strong>ID:</strong> <span class="cust-val-id">${this._escape(customerId)}</span></div>
            <div class="tk-cust-info-item cust-mobile-item" style="${initialMobile ? '' : 'display:none;'}"><strong>Mobile:</strong> <span class="cust-val-mobile">${this._escape(initialMobile)}</span></div>
            <div class="tk-cust-info-item cust-sec-mobile-item" style="${initialSecMobile ? '' : 'display:none;'}"><strong>Sec. Mobile:</strong> <span class="cust-val-sec-mobile">${this._escape(initialSecMobile)}</span></div>
            <div class="tk-cust-info-item cust-address-item" style="${initialAddr ? '' : 'display:none;'}"><strong>Address:</strong> <span class="cust-val-address">${this._escape(initialAddr)}</span></div>
          </div>
        </div>
      `;

      const editBtn = card.querySelector('.tk-btn-edit-customer');
      if (editBtn) {
        editBtn.addEventListener('click', (e) => {
          e.preventDefault();
          if (this._saveDraftToSession) {
            this._saveDraftToSession();
          }
          sessionStorage.setItem('tk_return_to_ticket_support', '1');
          sessionStorage.removeItem('tk_quick_entry_target');
          sessionStorage.removeItem('tk_is_quick_entry');
          window.location.assign(`/app/customer/${encodeURIComponent(customerId)}`);
        });
      }

      fetch(`/api/method/vin_chakra.api.get_customer_details?customer=${encodeURIComponent(customerId)}`)
        .then(r => r.json())
        .then(res => {
          if (res && res.message && res.message.status === 'success' && res.message.customer) {
            const cust = res.message.customer;
            const nameEl = card.querySelector('.cust-val-name');
            const mobileEl = card.querySelector('.cust-val-mobile');
            const mobileWrap = card.querySelector('.cust-mobile-item');
            const secMobileEl = card.querySelector('.cust-val-sec-mobile');
            const secMobileWrap = card.querySelector('.cust-sec-mobile-item');
            const addrEl = card.querySelector('.cust-val-address');
            const addrWrap = card.querySelector('.cust-address-item');

            if (nameEl && cust.customer_name) nameEl.textContent = cust.customer_name;
            if (cust.mobile_no) {
              if (mobileEl) mobileEl.textContent = cust.mobile_no;
              if (mobileWrap) mobileWrap.style.display = '';
            }
            if (cust.secondary_phone) {
              if (secMobileEl) secMobileEl.textContent = cust.secondary_phone;
              if (secMobileWrap) secMobileWrap.style.display = '';
            }
            const fullAddr = [cust.address_line1, cust.city, cust.state].filter(Boolean).join(', ');
            if (fullAddr) {
              if (addrEl) addrEl.textContent = fullAddr;
              if (addrWrap) addrWrap.style.display = '';
            }
          }
        })
        .catch(err => console.warn('Could not fetch customer details:', err));
    }


    _fetchSchema() {
      return new Promise((resolve, reject) => {
        frappe.call({
          method: 'vin_chakra.api.get_form_schema',
          async: true,
          callback: r => {
            if (r?.message) { this.schema = r.message; resolve(); }
            else reject(new Error('Invalid schema'));
          },
          error: err => reject(err)
        });
      });
    }

    /* ── Main render ── */
    _render() {
      this.currentStep = 0;
      const card = el('div', 'tk-card');
      card.appendChild(this._buildHeader());

      const body = el('div', 'tk-body');

      /* Info banner */
      const info = el('div', 'tk-info-banner');
      info.innerHTML = `${ICONS.info}<span>Provide accurate details so we can resolve your issue quickly.</span>`;
      body.appendChild(info);

      /* Alert placeholder */
      this._alertEl = el('div', 'tk-alert');
      body.appendChild(this._alertEl);

      /* Form */
      const form = el('form');
      form.noValidate = true;
      form.addEventListener('submit', e => this._onSubmit(e));

      const steps = this.schema.steps || [];
      this.totalSteps = steps.length;

      steps.forEach((stepObj, idx) => {
        const stepContent = el('div', 'tk-step-content');
        stepContent.dataset.step = idx;
        if (idx !== 0) {
          stepContent.style.display = 'none';
        }

        const stepGrid = el('div', 'tk-grid');

        (stepObj.sections || []).forEach((sec) => {
          /* Section divider */
          const numStr = String(idx + 1).padStart(2, '0');
          const head = el('div', 'tk-section-head');
          head.innerHTML = `
            <div class="tk-section-num">${numStr}</div>
            <span class="tk-section-title">${sec.label || 'Section'}</span>
            <div class="tk-section-line"></div>`;
          stepGrid.appendChild(head);

          (sec.fields || []).forEach(f => {
            /*
             * SPECIAL CASE: State & District fields
             * We keep _buildStateField / _buildDistrictField and the state->district
             * cascade logic keyed off fieldname === 'custom_state' / 'custom_city__district_'
             * specifically — that cascade is bespoke UI behavior (South Indian states/districts + 'Other'),
             * not something a generic field definition can express, so it stays as a special case even after this refactor.
             */
            if (f.fieldname === 'custom_state') {
              stepGrid.appendChild(this._buildStateField(f));
            } else if (f.fieldname === 'custom_city__district_') {
              stepGrid.appendChild(this._buildDistrictField(f));
            } else if (f.fieldtype === 'Table' || f.fieldname === 'custom_machine_type_list') {
              stepGrid.appendChild(this._buildTableField(f));
            } else {
              stepGrid.appendChild(this._buildField(f));
            }
          });
        });

        stepContent.appendChild(stepGrid);
        form.appendChild(stepContent);
      });

      /* ── CRITICAL: populate districts AFTER both selects exist in DOM ── */
      this._populateDistricts('Tamil Nadu');

      /* Wizard Navigation Buttons */
      const navButtons = el('div', 'tk-nav-buttons');

      const backBtn = el('button', 'tk-nav-btn tk-back-btn');
      backBtn.type = 'button';
      backBtn.id = 'tk-btn-back';
      backBtn.style.display = 'none';
      backBtn.innerHTML = `<i class="fa fa-arrow-left"></i> Back`;

      const nextBtn = el('button', 'tk-nav-btn tk-next-btn');
      nextBtn.type = 'button';
      nextBtn.id = 'tk-btn-next';
      nextBtn.innerHTML = `Next <i class="fa fa-arrow-right"></i>`;

      const submitBtn = el('button', 'tk-nav-btn tk-submit-btn');
      submitBtn.type = 'submit';
      submitBtn.id = 'tk-btn';
      submitBtn.style.display = 'none';

      const spin = el('div', 'tk-spinner');
      spin.id = 'tk-spin';

      const btnTxt = el('span');
      btnTxt.id = 'tk-btn-txt';
      btnTxt.textContent = 'Submit Ticket';

      const sendIconWrap = el('span');
      sendIconWrap.id = 'tk-send-icon';
      sendIconWrap.style.cssText = 'display:flex;align-items:center;';
      sendIconWrap.innerHTML = ICONS.send;
      sendIconWrap.querySelector('svg').style.cssText = 'width:16px;height:16px;';

      submitBtn.append(spin, btnTxt, sendIconWrap);

      navButtons.append(backBtn, nextBtn, submitBtn);
      form.appendChild(navButtons);

      backBtn.addEventListener('click', () => {
        if (this.currentStep > 0) {
          this._goToStep(this.currentStep - 1);
        }
      });

      nextBtn.addEventListener('click', () => {
        if (this._validateStep(this.currentStep)) {
          if (this.currentStep < this.totalSteps - 1) {
            this._goToStep(this.currentStep + 1);
          }
        }
      });

      body.appendChild(form);
      card.appendChild(body);

      /* Footer */
      const footer = el('div', 'tk-footer');
      footer.innerHTML = `${ICONS.lock} Your information is private and securely submitted`;
      card.appendChild(footer);

      this.root.innerHTML = '';
      this.root.appendChild(card);
      this._form = form;
    }


    /* Search-style combo for linked fields.
     Renders a search input + filtered list, with a
     "+ Add New <label>" row that opens the linked doctype's quick-entry form. */
    _buildComboField(cf, opts = {}) {
      const wrap = el('div', 'tk-combo');
      const input = el('input', 'tk-control tk-combo-input');
      input.type = 'text';
      input.autocomplete = 'off';
      input.placeholder = `Search ${cf.label}…`;
      input.dataset.cfname = cf.fieldname;
      if (cf.reqd) input.required = true;
      wrap.appendChild(input);

      /* Dropdown is appended to <body> (not inside the table cell) so it
         isn't clipped by the scrollable table wrapper — positioned via
         getBoundingClientRect so it floats like the working example. */
      const list = el('div', 'tk-combo-list');
      document.body.appendChild(list);

      const positionList = () => {
        const r = input.getBoundingClientRect();
        const MIN_WIDTH = 320;                       // wider than the narrow input box
        const desiredWidth = Math.max(r.width, MIN_WIDTH);

        let left = r.left;

        if (left + desiredWidth > window.innerWidth - 8) {
          left = window.innerWidth - desiredWidth - 8;
        }
        if (left < 8) left = 8;

        list.style.position = 'fixed';
        list.style.left = left + 'px';
        list.style.top = (r.bottom + 4) + 'px';
        list.style.width = desiredWidth + 'px';
      };
      const openList = () => { positionList(); list.classList.add('open'); };
      const closeList = () => { list.classList.remove('open'); };

      const options = (cf.options || []).map(o => typeof o === 'object'
        ? {
          value: o.value, label: o.label, itemName: o.item_name || o.itemName || o.label,
          brand: o.brand, modelNo: o.model_no || o.modelNo || o.custom_model_no, customer_name: o.customer_name, mobile_no: o.mobile_no, problem_name: o.problem_name || o.problemName
        }
        : { value: o, label: o, itemName: o, brand: null, modelNo: null, customer_name: o, mobile_no: null, problem_name: o });

      const selectOpt = (o) => {
        if (o && o.value && !options.some(existing => existing.value === o.value)) {
          options.push({
            value: o.value,
            label: o.label || o.value,
            itemName: o.itemName || o.label || o.value,
            brand: o.brand || null,
            modelNo: o.modelNo || null,
            customer_name: o.customer_name || null,
            mobile_no: o.mobile_no || null,
            problem_name: o.problem_name || null
          });
        }
        input.value = o.label;
        input.dataset.value = o.value;
        input.dataset.itemName = o.itemName || o.label || '';
        if (o.brand) input.dataset.brand = o.brand; else delete input.dataset.brand;
        if (o.modelNo) input.dataset.modelNo = o.modelNo; else delete input.dataset.modelNo;
        if (o.customer_name) input.dataset.customerName = o.customer_name;
        closeList();
        this._clearError(input, wrap.closest('.tk-field') || wrap);
        if (opts.onSelect) opts.onSelect(o, wrap);
      };

      wrap._options = options;
      wrap._selectOpt = selectOpt;

      const renderList = (query) => {
        const q = (query || '').trim().toLowerCase();
        list.innerHTML = '';
        const matches = options.filter(o => {
          if (!q) return true;
          const lbl = (o.label || '').toLowerCase();
          const val = (o.value || '').toLowerCase();
          const model = (o.modelNo || '').toLowerCase();
          const brand = (o.brand || '').toLowerCase();
          const custName = (o.customer_name || '').toLowerCase();
          const mobile = (o.mobile_no || '').toLowerCase();
          const prob = (o.problem_name || '').toLowerCase();

          return (
            lbl.includes(q) ||
            val.includes(q) ||
            model.includes(q) ||
            brand.includes(q) ||
            custName.includes(q) ||
            mobile.includes(q) ||
            prob.includes(q)
          );
        });

        matches.forEach(o => {
          const item = el('div', 'tk-combo-item');
          const extraDetails = [];
          if (o.modelNo && !o.label.toLowerCase().includes(o.modelNo.toLowerCase())) {
            extraDetails.push(`Model: ${o.modelNo}`);
          }
          if (o.brand && !o.label.toLowerCase().includes(o.brand.toLowerCase())) {
            extraDetails.push(`Brand: ${o.brand}`);
          }

          if (extraDetails.length > 0) {
            item.innerHTML = `${this._escape(o.label)} <span style="font-size:11px; opacity:0.75; margin-left:6px; font-weight:normal;">(${this._escape(extraDetails.join(' | '))})</span>`;
          } else {
            item.textContent = o.label;
          }

          item.addEventListener('mousedown', e => { e.preventDefault(); selectOpt(o); });
          list.appendChild(item);
        });

        const shouldShowCreate = !opts.showCreateWhenNoMatchOnly || matches.length === 0;
        if (!shouldShowCreate) return;

        const addItem = el('div', 'tk-combo-item tk-combo-add');
        addItem.textContent = `+ Create ${opts.doctype || cf.label}`;

        addItem.addEventListener('mousedown', e => { e.preventDefault(); });

        addItem.addEventListener('click', e => {
          e.preventDefault();
          closeList();
          const doctype = opts.doctype || 'Item';

          const row = wrap.closest('tr.tk-table-row');
          const rowIndex = row ? Array.from(row.parentNode.children).indexOf(row) : null;

          const pendingTarget = {
            doctype: doctype,
            fieldname: cf.fieldname,
            rowIndex: rowIndex
          };

          if (this._saveDraftToSession) {
            this._saveDraftToSession(pendingTarget);
          }

          sessionStorage.setItem('tk_return_to_ticket_support', '1');
          sessionStorage.setItem('tk_quick_entry_target', JSON.stringify(pendingTarget));
          sessionStorage.setItem('tk_is_quick_entry', '1');

          input.blur();
          window.__tkPendingCombo = { doctype, selectOpt, wrap };

          const route = doctype.toLowerCase().replace(/\s+/g, '-');
          window.location.assign(`/app/${route}?quick_entry=${encodeURIComponent(doctype)}`);
        });
        list.appendChild(addItem);
      };

      input.addEventListener('focus', () => { renderList(input.value); openList(); });
      input.addEventListener('input', () => {
        delete input.dataset.value; delete input.dataset.itemName; delete input.dataset.brand;
        renderList(input.value);
        openList();
      });
      input.addEventListener('blur', () => setTimeout(() => {
        closeList();
        if (!input.dataset.value) input.value = '';
      }, 150));

      /* Keep it aligned if the table/page scrolls or resizes */
      const reposition = () => { if (list.classList.contains('open')) positionList(); };
      window.addEventListener('scroll', reposition, true);
      window.addEventListener('resize', reposition);

      /* Clean up the portal element once this row is removed from the DOM */
      const observer = new MutationObserver(() => {
        if (!document.body.contains(wrap)) {
          list.remove();
          window.removeEventListener('scroll', reposition, true);
          window.removeEventListener('resize', reposition);
          observer.disconnect();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });

      return wrap;
    }
    /* ── Header ── */
    _buildHeader() {
      const h = el('div', 'tk-header');
      h.innerHTML = `
        <div class="tk-header-inner">
          <div class="tk-badge"><div class="tk-badge-dot"></div>Support</div>
          <div class="tk-logo-wrap">${ICONS.ticket}</div>
          <h1>${this.schema.title || 'Raise a Support Ticket'}</h1>
          <p>Sree Chakra Sewing Systems</p>
        </div>`;
      return h;
    }

    _buildStateField(f) {
      const iconKey = f.icon || 'map';
      const iconSvg = ICONS[iconKey] || ICONS.map;
      const group = el('div', 'tk-field');
      group.innerHTML = `
        <label class="tk-label">
          <span class="tk-label-icon">${iconSvg}</span>
          ${f.label}${f.reqd ? '<span class="req">*</span>' : ''}
        </label>`;

      const select = el('select', 'tk-control');
      select.name = f.fieldname;
      if (f.reqd) select.required = true;

      /* Placeholder */
      const placeholder = document.createElement('option');
      placeholder.value = ''; placeholder.disabled = true;
      placeholder.textContent = 'Select State';
      select.appendChild(placeholder);

      /* State options — Tamil Nadu first, then alphabetical */
      ALL_STATES.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s; opt.textContent = s;
        select.appendChild(opt);
      });

      /* Pre-select Tamil Nadu */
      select.value = 'Tamil Nadu';

      group.appendChild(select);

      const errMsg = el('div', 'tk-field-error');
      errMsg.innerHTML = `${ICONS.errSmall}<span>${f.label} is required</span>`;
      group.appendChild(errMsg);

      /* State change → repopulate districts */
      select.addEventListener('change', () => {
        this._clearError(select, group);
        this._populateDistricts(select.value);
      });

      this._stateSelect = select;   /* save ref */
      return group;
    }

    _buildDistrictField(f) {
      const iconKey = f.icon || 'pin';
      const iconSvg = ICONS[iconKey] || ICONS.pin;
      const group = el('div', 'tk-field');
      group.innerHTML = `
        <label class="tk-label">
          <span class="tk-label-icon">${iconSvg}</span>
          ${f.label}${f.reqd ? '<span class="req">*</span>' : ''}
        </label>`;

      /* Dropdown */
      const select = el('select', 'tk-control');
      select.name = f.fieldname;
      if (f.reqd) select.required = true;
      select.innerHTML = `<option value="" disabled selected>Select District</option>`;
      group.appendChild(select);

      /* "Other – type your district" free-text row */
      const otherRow = el('div', 'tk-other-row');
      const otherInput = el('input', 'tk-control');
      otherInput.type = 'text';
      otherInput.placeholder = 'Type your district / city';
      otherInput.name = f.fieldname + '_other';
      otherRow.appendChild(otherInput);
      group.appendChild(otherRow);

      /* Error message */
      const errMsg = el('div', 'tk-field-error');
      errMsg.innerHTML = `${ICONS.errSmall}<span>${f.label} is required</span>`;
      group.appendChild(errMsg);

      /* When user picks "Other" show free-text; swap the form field name */
      select.addEventListener('change', () => {
        this._clearError(select, group);
        if (select.value === '__other__') {
          otherRow.classList.add('visible');
          otherInput.required = true;
          select.required = false;     /* dropdown itself no longer required */
          otherInput.focus();
        } else {
          otherRow.classList.remove('visible');
          otherInput.required = false;
          otherInput.value = '';
          select.required = !!f.reqd;
        }
      });
      otherInput.addEventListener('input', () => this._clearError(otherInput, group));

      this._districtSelect = select;
      this._districtOtherRow = otherRow;
      this._districtOtherInput = otherInput;
      return group;
    }

    _populateDistricts(state) {
      const sel = this._districtSelect;
      const other = this._districtOtherRow;
      const oInput = this._districtOtherInput;
      if (!sel) return;

      /* Reset */
      sel.innerHTML = `<option value="" disabled selected>Select District</option>`;
      if (other) { other.classList.remove('visible'); }
      if (oInput) { oInput.required = false; oInput.value = ''; }

      if (state === 'Other') {
        /* No dropdown needed — show free-text directly */
        sel.disabled = true;
        sel.required = false;
        if (other) other.classList.add('visible');
        if (oInput) { oInput.required = true; setTimeout(() => oInput.focus(), 50); }
        return;
      }

      const districts = STATE_DISTRICTS[state] || [];

      if (districts.length === 0) {
        /* Unknown state — let them type */
        sel.disabled = true;
        sel.required = false;
        if (other) other.classList.add('visible');
        if (oInput) oInput.required = true;
        return;
      }

      /* Fill districts */
      districts.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d; opt.textContent = d;
        sel.appendChild(opt);
      });

      /* Always append "Other" at the bottom */
      const otherOpt = document.createElement('option');
      otherOpt.value = '__other__'; otherOpt.textContent = '— Other / Not listed —';
      sel.appendChild(otherOpt);

      sel.disabled = false;
      sel.required = true;
      sel.value = '';    /* force user to pick */
    }

    _buildField(f) {
      const isLong = ['Text Editor', 'Small Text', 'Text'].includes(f.fieldtype);
      const group = el('div', `tk-field${isLong ? ' full' : ''}`);
      const iconKey = f.icon || 'tag';
      const iconSvg = ICONS[iconKey] || ICONS.tag;

      const lbl = el('label', 'tk-label');
      lbl.innerHTML = `
        ${iconSvg ? `<span class="tk-label-icon">${iconSvg}</span>` : ''}
        ${f.label}${f.reqd ? '<span class="req">*</span>' : ''}`;
      group.appendChild(lbl);

      let ctrl;

      if (f.fieldname === 'customer') {
        const combo = this._buildComboField(f, {
          doctype: 'Customer',
          showCreateWhenNoMatchOnly: false,
          returnToTicketSupport: true,
          onSelect: (o, wrap) => {
            const nameInput = this._form ? this._form.querySelector('[name="custom_customer_name"]') : null;
            if (nameInput && (!nameInput.value || nameInput.value.trim() === '') && (o.customer_name || o.label)) {
              nameInput.value = o.customer_name || o.label;
              this._clearError(nameInput, nameInput.closest('.tk-field') || nameInput);
            }
            if (o.mobile_no) {
              const phoneInput = this._form ? this._form.querySelector('[name="custom_customer_mobile_number"]') : null;
              if (phoneInput && (!phoneInput.value || phoneInput.value.trim() === '')) {
                phoneInput.value = o.mobile_no.replace(/\D/g, '').slice(-10);
                this._clearError(phoneInput, phoneInput.closest('.tk-field') || phoneInput);
              }
            }
            this._renderCustomerDetailsCard(o, group);
          }
        });
        ctrl = combo.querySelector('input');
        ctrl.addEventListener('input', () => {
          if (!ctrl.value || !ctrl.dataset.value) {
            this._renderCustomerDetailsCard(null, group);
          }
        });
        group.appendChild(combo);


      } else if (['Select', 'Link'].includes(f.fieldtype)) {
        ctrl = el('select', 'tk-control');
        ctrl.innerHTML = `<option value="" disabled selected>Select ${f.label}</option>`;
        (f.options || []).forEach(o => {
          const opt = document.createElement('option');
          opt.value = o; opt.textContent = o;
          ctrl.appendChild(opt);
        });
        group.appendChild(ctrl);

      } else if (isLong) {
        const wrap = el('div', 'tk-char-wrap');
        ctrl = el('textarea', 'tk-control');
        ctrl.rows = f.fieldtype === 'Text Editor' ? 5 : 3;
        ctrl.placeholder = `Describe ${f.label.toLowerCase()}…`;
        const MAX = f.fieldname === 'description' ? 800 : 300;
        const counter = el('span', 'tk-char-count');
        counter.textContent = `0 / ${MAX}`;
        ctrl.addEventListener('input', () => {
          const len = ctrl.value.length;
          counter.textContent = `${len} / ${MAX}`;
          counter.classList.toggle('warn', len > MAX * 0.85);
          if (len > MAX) ctrl.value = ctrl.value.slice(0, MAX);
        });
        wrap.appendChild(ctrl);
        wrap.appendChild(counter);
        group.appendChild(wrap);

      } else if (f.fieldtype === 'Date') {
        ctrl = el('input', 'tk-control');
        ctrl.type = 'date';
        ctrl.valueAsDate = new Date();
        group.appendChild(ctrl);

      } else if (f.fieldtype === 'Phone') {
        const wrap = el('div', 'tk-input-wrap');
        wrap.innerHTML = `<span class="tk-input-prefix">${ICONS.phone}</span>`;
        ctrl = el('input', 'tk-control');
        ctrl.type = 'tel';
        ctrl.placeholder = 'e.g. 9876543210';
        ctrl.maxLength = 10;
        ctrl.addEventListener('input', () => {
          ctrl.value = ctrl.value.replace(/\D/g, '').slice(0, 10);
        });
        wrap.appendChild(ctrl);
        group.appendChild(wrap);

      } else {
        const wrap = el('div', 'tk-input-wrap');
        if (iconSvg) wrap.innerHTML = `<span class="tk-input-prefix">${iconSvg}</span>`;
        ctrl = el('input', 'tk-control');
        ctrl.type = 'text';
        ctrl.placeholder = `Enter ${f.label}`;
        wrap.appendChild(ctrl);
        group.appendChild(wrap);
      }

      ctrl.name = f.fieldname;
      if (f.reqd) ctrl.required = true;
      ctrl.addEventListener('input', () => this._clearError(ctrl, group));
      ctrl.addEventListener('change', () => this._clearError(ctrl, group));

      const errMsg = el('div', 'tk-field-error');
      errMsg.innerHTML = `${ICONS.errSmall}<span>${f.label} is required</span>`;
      group.appendChild(errMsg);

      return group;
    }

    _buildTableField(f) {
      const group = el('div', 'tk-field full');
      const iconKey = f.icon || 'wrench';
      const iconSvg = ICONS[iconKey] || ICONS.wrench;

      group.innerHTML = `
        <label class="tk-label">
          <span class="tk-label-icon">${iconSvg}</span>
          ${f.label}${f.reqd ? '<span class="req">*</span>' : ''}
        </label>`;

      const widget = el('div', 'tk-table-widget');
      widget.dataset.fieldname = f.fieldname;

      const headBar = el('div', 'tk-table-head-bar');
      headBar.innerHTML = `
        <div class="tk-table-title">${ICONS.wrench} Machine Type List</div>`;

      const addBtn = el('button', 'tk-add-row-btn');
      addBtn.type = 'button';
      addBtn.innerHTML = `<i class="fa fa-plus"></i> + Add Row`;
      headBar.appendChild(addBtn);

      widget.appendChild(headBar);

      const tableWrapper = el('div', 'tk-table-wrapper');
      const table = el('table', 'tk-grid-table');

      const childFields = (f.child_fields || []).filter(cf => cf.fieldname !== 'machine_name');

      // Table Header <thead>
      const thead = el('thead');
      const headerTr = el('tr');

      const numTh = el('th');
      numTh.style.width = '45px';
      numTh.style.textAlign = 'center';
      numTh.textContent = '#';
      headerTr.appendChild(numTh);

      childFields.forEach(cf => {
        const th = el('th');
        th.innerHTML = `${cf.label}${cf.reqd ? ' <span class="req">*</span>' : ''}`;
        headerTr.appendChild(th);
      });

      const actionTh = el('th');
      actionTh.style.width = '60px';
      actionTh.style.textAlign = 'center';
      actionTh.textContent = 'Action';
      headerTr.appendChild(actionTh);

      thead.appendChild(headerTr);
      table.appendChild(thead);

      // Table Body <tbody>
      const tbody = el('tbody', 'tk-table-tbody');
      table.appendChild(tbody);
      tableWrapper.appendChild(table);
      widget.appendChild(tableWrapper);

      const errMsg = el('div', 'tk-field-error');
      errMsg.innerHTML = `${ICONS.errSmall}<span>At least one machine entry is required with all details filled</span>`;
      widget.appendChild(errMsg);

      group.appendChild(widget);

      const addRow = (initialValues = {}) => {
        const rowIndex = tbody.querySelectorAll('tr.tk-table-row').length + 1;
        const tr = el('tr', 'tk-table-row');
        tr.dataset.rowIndex = rowIndex;

        // Cell 1: Index
        const tdIdx = el('td', 'tk-row-idx');
        tdIdx.textContent = rowIndex;
        tr.appendChild(tdIdx);

        // Cells for child fields
        childFields.forEach(cf => {
          const td = el('td');
          let ctrl;

          if (cf.fieldname === 'machine_type') {
            ctrl = this._buildComboField(cf, {
              doctype: 'Item',
              onSelect: (o, wrap) => {
                const row = wrap.closest('tr');
                if (row) {
                  const brandCtrl = row.querySelector('[data-cfname="machine_brand"]');
                  if (brandCtrl && o.brand) brandCtrl.value = o.brand;

                  const modelCtrl = row.querySelector('[data-cfname="model_no"]');
                  if (modelCtrl && o.modelNo) modelCtrl.value = o.modelNo;
                }
              }
            });
            const inp = ctrl.querySelector('input');
            const initVal = initialValues.machine_type;
            if (initVal) {
              if (typeof initVal === 'object') {
                inp.value = initVal.value || initVal.itemName || '';
                inp.dataset.value = initVal.datasetValue || initVal.value || '';
                inp.dataset.itemName = initVal.itemName || '';
                if (initVal.brand) inp.dataset.brand = initVal.brand;
                if (initVal.modelNo) inp.dataset.modelNo = initVal.modelNo;
              } else {
                inp.value = initVal;
              }
            }
          }
          else if (cf.fieldname === 'machine_problem') {
            ctrl = this._buildComboField(cf, { doctype: 'Machine Problem' });
            const inp = ctrl.querySelector('input');
            const initVal = initialValues.machine_problem;
            if (initVal) {
              if (typeof initVal === 'object') {
                inp.value = initVal.value || initVal.itemName || '';
                inp.dataset.value = initVal.datasetValue || initVal.value || '';
              } else {
                inp.value = initVal;
              }
            }

          } else if (cf.fieldtype === 'Select' || cf.fieldtype === 'Link' || cf.fieldname === 'machine_brand') {
            ctrl = el('select', 'tk-control');
            ctrl.dataset.cfname = cf.fieldname;
            ctrl.innerHTML = `<option value="" disabled selected>Select ${cf.label}</option>`;
            (cf.options || []).forEach(o => {
              const opt = document.createElement('option');
              const val = typeof o === 'object' ? (o.value || o.name) : o;
              const lbl = typeof o === 'object' ? (o.label || o.name || o.value) : o;
              opt.value = val;
              opt.textContent = lbl;
              ctrl.appendChild(opt);
            });
            const initVal = initialValues[cf.fieldname];
            const rawVal = typeof initVal === 'object' ? initVal.value : initVal;
            if (rawVal) ctrl.value = rawVal;

          } else if (cf.fieldtype === 'Int' || cf.fieldname === 'machine_quantity') {
            ctrl = el('input', 'tk-control');
            ctrl.type = 'number';
            ctrl.min = '1';
            const initVal = initialValues.machine_quantity;
            const rawVal = typeof initVal === 'object' ? initVal.value : initVal;
            ctrl.value = rawVal || '1';
            ctrl.style.width = '75px';
            ctrl.dataset.cfname = cf.fieldname;

          } else {
            ctrl = el('input', 'tk-control');
            ctrl.type = 'text';
            ctrl.dataset.cfname = cf.fieldname;
            const initVal = initialValues[cf.fieldname];
            const rawVal = typeof initVal === 'object' ? initVal.value : initVal;
            if (rawVal) ctrl.value = rawVal;
          }

          if (cf.reqd) ctrl.required = true;

          ctrl.addEventListener('input', () => this._clearError(ctrl, group));
          ctrl.addEventListener('change', () => this._clearError(ctrl, group));

          td.appendChild(ctrl);
          tr.appendChild(td);
        });

        // Delete button cell
        const tdAction = el('td');
        tdAction.style.textAlign = 'center';
        const delBtn = el('button', 'tk-row-del-btn');
        delBtn.type = 'button';
        delBtn.title = 'Remove row';
        delBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
        tdAction.appendChild(delBtn);
        tr.appendChild(tdAction);

        tbody.appendChild(tr);

        delBtn.addEventListener('click', () => {
          tr.remove();
          this._updateTableIndices(tbody);
          this._clearError(null, group);
        });

        this._updateTableIndices(tbody);
      };

      this._addRowToTable = addRow;

      addBtn.addEventListener('click', () => {
        addRow();
        this._clearError(null, group);
      });

      // Add initial row automatically
      addRow();

      this._tableWidgetGroup = group;
      return group;
    }

    _updateTableIndices(tbody) {
      const rows = tbody.querySelectorAll('tr.tk-table-row');
      rows.forEach((tr, idx) => {
        const idxTd = tr.querySelector('.tk-row-idx');
        if (idxTd) idxTd.textContent = idx + 1;
      });
    }

    _clearError(ctrl, group) {
      if (ctrl) ctrl.classList.remove('tk-invalid');
      if (group) {
        const err = group.querySelector('.tk-field-error');
        if (err) err.style.display = 'none';
      }
    }

    _onSubmit(e) {
      e.preventDefault();

      if (!this._validateStep(this.currentStep)) {
        return;
      }

      /* Build data — if district "Other" is active, use the typed value */
      const rawData = Object.fromEntries(new FormData(this._form).entries());
      const customerInput = this._form.querySelector('[name="customer"]');
      if (customerInput?.dataset.value) {
        // The combo displays the customer name, but HD Ticket.customer must
        // receive the canonical Customer document name.
        rawData.customer = customerInput.dataset.value;
      }
      if (this._districtOtherRow?.classList.contains('visible') && this._districtOtherInput?.value) {
        const districtFieldName = this._districtSelect?.name;
        if (districtFieldName) rawData[districtFieldName] = this._districtOtherInput.value.trim();
      }
      /* Remove the _other helper key so it's not sent to Frappe */
      Object.keys(rawData).forEach(k => { if (k.endsWith('_other')) delete rawData[k]; });

      /* Gather Child Table rows if table widget exists */
      if (this._tableWidgetGroup) {
        const rows = this._tableWidgetGroup.querySelectorAll('tr.tk-table-row');
        const rowsData = [];
        rows.forEach(tr => {
          const rowObj = {};
          const inputs = tr.querySelectorAll('[data-cfname]');
          inputs.forEach(input => {
            const key = input.dataset.cfname;
            if (!key) return;
            const rawVal = input.dataset.value !== undefined ? input.dataset.value : input.value;
            rowObj[key] = rawVal ? String(rawVal).trim() : '';
            if (key === 'machine_type') {
              rowObj['machine_name'] = input.dataset.itemName || rowObj[key];
            }
          });
          if (rowObj.machine_quantity) {
            rowObj.machine_quantity = parseInt(rowObj.machine_quantity, 10) || 1;
          }
          if (Object.keys(rowObj).length > 0) {
            rowsData.push(rowObj);
          }
        });
        rawData.custom_machine_type_list = rowsData;
      }

      const phoneInput = this._form.querySelector('input[type="tel"]');
      const phoneNumber = phoneInput ? phoneInput.value.trim() : '';

      const btn = document.getElementById('tk-btn');
      const spin = document.getElementById('tk-spin');
      const txt = document.getElementById('tk-btn-txt');
      const sendIcon = document.getElementById('tk-send-icon');

      btn.disabled = true;
      spin.style.display = 'block';
      if (sendIcon) sendIcon.style.display = 'none';
      txt.textContent = 'Submitting…';
      this._alertEl.style.display = 'none';

      frappe.call({
        method: 'vin_chakra.api.submit_ticket',
        args: { data: rawData },
        async: true,
        callback: r => {
          btn.disabled = false;
          spin.style.display = 'none';
          if (sendIcon) sendIcon.style.display = 'flex';
          txt.textContent = 'Submit Ticket';

          if (r.message?.status === 'success') {
            this._showAlert('success',
              `Ticket <strong>${r.message.ticket_name}</strong> raised successfully! Our support team will contact you shortly.`);
            this._form.reset();
            /* Restore date default */
            this._form.querySelectorAll('input[type="date"]')
              .forEach(i => i.valueAsDate = new Date());
            /* Restore state/district defaults */
            if (this._stateSelect) this._stateSelect.value = 'Tamil Nadu';
            this._populateDistricts('Tamil Nadu');

            /* Reset Table Widget */
            if (this._tableWidgetGroup) {
              const tbody = this._tableWidgetGroup.querySelector('.tk-table-tbody');
              if (tbody) {
                tbody.innerHTML = '';
                const addBtn = this._tableWidgetGroup.querySelector('.tk-add-row-btn');
                if (addBtn) addBtn.click();
              }
            }

            this._goToStep(0);
            this._alertEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          } else {
            this._showAlert('error', r.message?.message || 'Something went wrong. Please try again.');
          }
        },
        error: () => {
          btn.disabled = false;
          spin.style.display = 'none';
          if (sendIcon) sendIcon.style.display = 'flex';
          txt.textContent = 'Submit Ticket';
          this._showAlert('error', 'Server error. Please try again later.');
        }
      });
    }

    _validateStep(stepIndex) {
      const stepContent = this.root.querySelector(`.tk-step-content[data-step="${stepIndex}"]`);
      if (!stepContent) return true;

      let hasError = false;
      let firstError = null;

      /* Clear previous errors inside this step */
      stepContent.querySelectorAll('.tk-invalid').forEach(c => c.classList.remove('tk-invalid'));
      stepContent.querySelectorAll('.tk-field-error').forEach(c => c.style.display = 'none');

      /* Required check */
      stepContent.querySelectorAll('[required]').forEach(ctrl => {
        const val = ctrl.value ? ctrl.value.trim() : '';
        if (!val) {
          ctrl.classList.add('tk-invalid');
          const group = ctrl.closest('.tk-field');
          if (group) {
            const err = group.querySelector('.tk-field-error');
            if (err) err.style.display = 'flex';
          }
          if (!firstError) firstError = ctrl;
          hasError = true;
        }
      });

      /* Table Widget Check */
      const tableWidget = stepContent.querySelector('.tk-table-widget');
      if (tableWidget) {
        const rows = tableWidget.querySelectorAll('tr.tk-table-row');
        const widgetErr = tableWidget.querySelector('.tk-field-error');

        if (rows.length === 0) {
          if (widgetErr) {
            widgetErr.querySelector('span').textContent = 'At least one machine entry is required';
            widgetErr.style.display = 'flex';
          }
          if (!firstError) firstError = tableWidget;
          hasError = true;
        } else {
          rows.forEach(tr => {
            tr.querySelectorAll('[required]').forEach(ctrl => {
              const val = ctrl.value ? ctrl.value.trim() : '';
              if (!val) {
                ctrl.classList.add('tk-invalid');
                if (widgetErr) {
                  widgetErr.querySelector('span').textContent = 'Please fill in all required machine details';
                  widgetErr.style.display = 'flex';
                }
                if (!firstError) firstError = ctrl;
                hasError = true;
              }
            });
          });
        }
      }

      /* Phone pattern check */
      stepContent.querySelectorAll('input[type="tel"]').forEach(ctrl => {
        if (ctrl.value && !/^[0-9]{10}$/.test(ctrl.value.trim())) {
          ctrl.classList.add('tk-invalid');
          const group = ctrl.closest('.tk-field');
          if (group) {
            const err = group.querySelector('.tk-field-error');
            if (err) {
              err.querySelector('span').textContent = 'Enter a valid 10-digit mobile number';
              err.style.display = 'flex';
            }
          }
          if (!firstError) firstError = ctrl;
          hasError = true;
        }
      });

      if (hasError) {
        this._showAlert('error', 'Please fill in all required fields before proceeding.');
        if (firstError) {
          firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setTimeout(() => firstError.focus(), 380);
        }
        return false;
      }

      this._alertEl.style.display = 'none';
      return true;
    }

    _goToStep(stepIndex) {
      // Hide current step content, show new step content
      const stepContents = this.root.querySelectorAll('.tk-step-content');
      stepContents.forEach(content => {
        const step = parseInt(content.dataset.step, 10);
        content.style.display = (step === stepIndex) ? 'block' : 'none';
      });

      // Update step indicator classes
      const steps = this.root.querySelectorAll('.tk-step');
      steps.forEach(stepEl => {
        const step = parseInt(stepEl.dataset.step, 10);
        stepEl.classList.remove('active', 'done');
        if (step === stepIndex) {
          stepEl.classList.add('active');
        } else if (step < stepIndex) {
          stepEl.classList.add('done');
        }
      });

      // Update step lines
      const stepLines = this.root.querySelectorAll('.tk-step-line');
      stepLines.forEach((lineEl, idx) => {
        lineEl.classList.remove('done');
        if (idx < stepIndex) {
          lineEl.classList.add('done');
        }
      });

      // Update navigation button visibility
      const backBtn = this.root.querySelector('#tk-btn-back');
      const nextBtn = this.root.querySelector('#tk-btn-next');
      const submitBtn = this.root.querySelector('#tk-btn');

      if (backBtn) backBtn.style.display = (stepIndex === 0) ? 'none' : 'block';
      if (nextBtn) nextBtn.style.display = (stepIndex === this.totalSteps - 1) ? 'none' : 'block';
      if (submitBtn) submitBtn.style.display = (stepIndex === this.totalSteps - 1) ? 'block' : 'none';

      this.currentStep = stepIndex;

      // Scroll to top of card for better UX on mobile
      const card = this.root.querySelector('.tk-card');
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }

    _showAlert(type, html) {
      this._alertEl.className = `tk-alert ${type}`;
      this._alertEl.innerHTML = (type === 'success' ? ICONS.ok : ICONS.err) + `<span>${html}</span>`;
      this._alertEl.style.display = 'flex';
      if (type === 'success') {
        setTimeout(() => {
          this._alertEl.style.transition = 'opacity .4s';
          this._alertEl.style.opacity = '0';
          setTimeout(() => {
            this._alertEl.style.display = 'none';
            this._alertEl.style.opacity = '';
          }, 400);
        }, 8000);
      }
    }
  }

  /* ─── Boot ───────────────────────────────────────────────────────── */
  function boot() {
    if (document.getElementById(ROOT_ID)) new TicketWidget(ROOT_ID);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

window.addEventListener('storage', (e) => {
  if (e.key !== 'tk_new_doc_created' || !e.newValue) return;
  const pending = window.__tkPendingCombo;
  if (!pending) return;

  let payload;
  try { payload = JSON.parse(e.newValue); } catch (_) { return; }
  if (payload.doctype !== pending.doctype) return;

  const o = {
    value: payload.name,
    label: payload.item_name || payload.customer_name || payload.problem_name || payload.name,
    itemName: payload.item_name || payload.customer_name || payload.problem_name || payload.name,
    brand: payload.brand,
    modelNo: payload.custom_model_no || payload.model_no
  };
  pending.selectOpt(o);
  window.__tkPendingCombo = null;
});
