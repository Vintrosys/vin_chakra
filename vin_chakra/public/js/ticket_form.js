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
      'Ariyalur','Chengalpattu','Chennai','Coimbatore','Cuddalore',
      'Dharmapuri','Dindigul','Erode','Kallakurichi','Kanchipuram',
      'Kanyakumari','Karur','Krishnagiri','Madurai','Mayiladuthurai',
      'Nagapattinam','Namakkal','Nilgiris','Perambalur','Pudukkottai',
      'Ramanathapuram','Ranipet','Salem','Sivaganga','Tenkasi',
      'Thanjavur','Theni','Thoothukudi','Tiruchirappalli','Tirunelveli',
      'Tirupathur','Tiruppur','Tiruvallur','Tiruvannamalai','Tiruvarur',
      'Vellore','Viluppuram','Virudhunagar'
    ],
    'Kerala': [
      'Alappuzha','Ernakulam','Idukki','Kannur','Kasaragod','Kollam',
      'Kottayam','Kozhikode','Malappuram','Palakkad','Pathanamthitta',
      'Thiruvananthapuram','Thrissur','Wayanad'
    ],
    'Karnataka': [
      'Bagalkot','Ballari','Belagavi','Bengaluru Rural','Bengaluru Urban',
      'Bidar','Chamarajanagar','Chikkaballapur','Chikkamagaluru',
      'Chitradurga','Dakshina Kannada','Davanagere','Dharwad','Gadag',
      'Hassan','Haveri','Kalaburagi','Kodagu','Kolar','Koppal',
      'Mandya','Mysuru','Raichur','Ramanagara','Shivamogga','Tumakuru',
      'Udupi','Uttara Kannada','Vijayapura','Yadgir'
    ],
    'Andhra Pradesh': [
      'Alluri Sitharama Raju','Anakapalli','Ananthapuramu','Annamayya',
      'Bapatla','Chittoor','Dr. B.R. Ambedkar Konaseema','East Godavari',
      'Eluru','Guntur','Kakinada','Krishna','Kurnool','Nandyal',
      'NTR','Palnadu','Parvathipuram Manyam','Prakasam',
      'Sri Potti Sriramulu Nellore','Sri Sathya Sai','Srikakulam',
      'Tirupati','Visakhapatnam','Vizianagaram','West Godavari','YSR Kadapa'
    ],
    'Telangana': [
      'Adilabad','Bhadradri Kothagudem','Hanumakonda','Hyderabad',
      'Jagtial','Jangaon','Jayashankar Bhupalpally','Jogulamba Gadwal',
      'Kamareddy','Karimnagar','Khammam','Kumuram Bheem Asifabad',
      'Mahabubabad','Mahabubnagar','Mancherial','Medak','Medchal–Malkajgiri',
      'Mulugu','Nagarkurnool','Nalgonda','Narayanpet','Nirmal',
      'Nizamabad','Peddapalli','Rajanna Sircilla','Rangareddy','Sangareddy',
      'Siddipet','Suryapet','Vikarabad','Wanaparthy','Warangal',
      'Yadadri Bhuvanagiri'
    ],
    'Puducherry': ['Karaikal','Mahe','Puducherry','Yanam'],
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
    ticket:   `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="3.4" rx="1" fill="currentColor" stroke="none"/><rect x="5" y="17.6" width="14" height="3.4" rx="1" fill="currentColor" stroke="none"/><path d="M8 6.4c0 2.6 8 2.6 8 0M8 11.6c0 2.6 8 2.6 8 0M8 12.4c0 2.6 8 2.6 8 0M8 17.6c0-2.6 8-2.6 8 0"/></svg>`,
    ok:       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
    err:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    info:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
    lock:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
    user:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
    phone:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.28 2 2 0 0 1 3.6 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.59a16 16 0 0 0 6.05 6.05l.95-.95a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`,
    map:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3V6z"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/></svg>`,
    pin:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`,
    home:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
    wrench:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`,
    calendar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
    tag:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`,
    file:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
    errSmall: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    send:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`,
  };

  const FIELD_ICONS = {
    custom_customer_name: 'user',
    custom_customer_mobile_number: 'phone',
    custom_state: 'map',
    'custom_city__district_': 'pin',
    custom_address: 'home',
    custom_date: 'calendar',
    custom_machine_name: 'tag',
    custom_machine_problem: 'wrench',
    custom_purchased_at_sree_chakra_sewing_systems: 'tag',
    custom_purchase_year: 'calendar',
    subject: 'tag',
    description: 'file',
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
      this.root     = document.getElementById(rootId);
      this.schema   = null;
      this.currentStep = 0;
      /* These refs are set during _buildLocationSection, used by _populateDistricts */
      this._stateSelect    = null;
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

      const fieldMap = {};
      this.schema.fields.forEach(f => { fieldMap[f.fieldname] = f; });

      const sections = [
        { label:'Customer & Location Info', num:'01', keys:['custom_customer_name','custom_customer_mobile_number','custom_state','custom_city__district_','custom_address','custom_date'] },
        { label:'Machine & Issue Details',  num:'02', keys:['custom_machine_name','custom_machine_problem','custom_purchased_at_sree_chakra_sewing_systems','custom_purchase_year','subject'] },
      ];

      this.totalSteps = sections.length;

      const usedKeys = new Set();

      sections.forEach((sec, idx) => {
        const stepContent = el('div', 'tk-step-content');
        stepContent.dataset.step = idx;
        if (idx !== 0) {
          stepContent.style.display = 'none';
        }

        const stepGrid = el('div', 'tk-grid');

        /* Section divider */
        const head = el('div', 'tk-section-head');
        head.innerHTML = `
          <div class="tk-section-num">${sec.num}</div>
          <span class="tk-section-title">${sec.label}</span>
          <div class="tk-section-line"></div>`;
        stepGrid.appendChild(head);

        sec.keys.forEach(key => {
          const f = fieldMap[key];
          if (!f) return;
          usedKeys.add(key);

          if (key === 'custom_state') {
            stepGrid.appendChild(this._buildStateField(f));
          } else if (key === 'custom_city__district_') {
            stepGrid.appendChild(this._buildDistrictField(f));
          } else {
            stepGrid.appendChild(this._buildField(f));
          }
        });

        if (idx === sections.length - 1) {
          /* Append unmapped fields to final step */
          this.schema.fields.forEach(f => {
            if (!usedKeys.has(f.fieldname)) {
              stepGrid.appendChild(this._buildField(f));
            }
          });
        }

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
      const group = el('div', 'tk-field');
      group.innerHTML = `
        <label class="tk-label">
          <span class="tk-label-icon">${ICONS.map}</span>
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
      const group = el('div', 'tk-field');
      group.innerHTML = `
        <label class="tk-label">
          <span class="tk-label-icon">${ICONS.pin}</span>
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

      this._districtSelect    = select;
      this._districtOtherRow  = otherRow;
      this._districtOtherInput = otherInput;
      return group;
    }

    _populateDistricts(state) {
      const sel    = this._districtSelect;
      const other  = this._districtOtherRow;
      const oInput = this._districtOtherInput;
      if (!sel) return;

      /* Reset */
      sel.innerHTML = `<option value="" disabled selected>Select District</option>`;
      if (other)  { other.classList.remove('visible'); }
      if (oInput) { oInput.required = false; oInput.value = ''; }

      if (state === 'Other') {
        /* No dropdown needed — show free-text directly */
        sel.disabled = true;
        sel.required = false;
        if (other)  other.classList.add('visible');
        if (oInput) { oInput.required = true; setTimeout(() => oInput.focus(), 50); }
        return;
      }

      const districts = STATE_DISTRICTS[state] || [];

      if (districts.length === 0) {
        /* Unknown state — let them type */
        sel.disabled = true;
        sel.required = false;
        if (other)  other.classList.add('visible');
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
      const isLong = ['Text Editor','Small Text','Text'].includes(f.fieldtype);
      const group  = el('div', `tk-field${isLong ? ' full' : ''}`);
      const iconKey = FIELD_ICONS[f.fieldname];

      const lbl = el('label', 'tk-label');
      lbl.innerHTML = `
        ${iconKey ? `<span class="tk-label-icon">${ICONS[iconKey]}</span>` : ''}
        ${f.label}${f.reqd ? '<span class="req">*</span>' : ''}`;
      group.appendChild(lbl);

      let ctrl;

      if (['Select','Link'].includes(f.fieldtype)) {
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
        if (iconKey) wrap.innerHTML = `<span class="tk-input-prefix">${ICONS[iconKey]}</span>`;
        ctrl = el('input', 'tk-control');
        ctrl.type = 'text';
        ctrl.placeholder = `Enter ${f.label}`;
        wrap.appendChild(ctrl);
        group.appendChild(wrap);
      }

      ctrl.name = f.fieldname;
      if (f.reqd) ctrl.required = true;
      ctrl.addEventListener('input',  () => this._clearError(ctrl, group));
      ctrl.addEventListener('change', () => this._clearError(ctrl, group));

      const errMsg = el('div', 'tk-field-error');
      errMsg.innerHTML = `${ICONS.errSmall}<span>${f.label} is required</span>`;
      group.appendChild(errMsg);

      return group;
    }

    _clearError(ctrl, group) {
      ctrl.classList.remove('tk-invalid');
      const err = group.querySelector('.tk-field-error');
      if (err) err.style.display = 'none';
    }

    _onSubmit(e) {
      e.preventDefault();

      if (!this._validateStep(this.currentStep)) {
        return;
      }

      /* Build data — if district "Other" is active, use the typed value */
      const rawData = Object.fromEntries(new FormData(this._form).entries());
      if (this._districtOtherRow?.classList.contains('visible') && this._districtOtherInput?.value) {
        const districtFieldName = this._districtSelect?.name;
        if (districtFieldName) rawData[districtFieldName] = this._districtOtherInput.value.trim();
      }
      /* Remove the _other helper key so it's not sent to Frappe */
      Object.keys(rawData).forEach(k => { if (k.endsWith('_other')) delete rawData[k]; });

      const phoneInput  = this._form.querySelector('input[type="tel"]');
      const phoneNumber = phoneInput ? phoneInput.value.trim() : '';

      const btn        = document.getElementById('tk-btn');
      const spin       = document.getElementById('tk-spin');
      const txt        = document.getElementById('tk-btn-txt');
      const sendIcon   = document.getElementById('tk-send-icon');

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