/**
 * TicketWidget – Sree Chakra Sewing Systems
 * Fully dynamic, mobile-first, dependency-free JS widget.
 * Reads fields from the Frappe Web Form "raise-a-ticket" and
 * submits directly to the HD Ticket doctype.
 */

(function () {
  'use strict';

  const BASE_URL = window.location.origin;
  const ROOT_ID  = 'ticket-root';

  /* ─── Styles ────────────────────────────────────────────────────── */
  const CSS = `
    :root {
      --primary:       #6366f1;
      --primary-dark:  #4f46e5;
      --primary-light: rgba(99, 102, 241, 0.08);
      --green:         #15803d;
      --green-bg:      #dcfce7;
      --red:           #b91c1c;
      --red-bg:        #fee2e2;
      --text-main:     #0f172a;
      --text-muted:    #475569;
      --text-light:    #94a3b8;
      --border:        #f1f5f9;
      --input-bg:      #f8fafc;
      --white:         #ffffff;
      --radius:        16px;
      --radius-sm:     12px;
      --shadow-sm:     0 1px 2px 0 rgb(0 0 0 / 0.05);
      --shadow:        0 4px 6px -1px rgb(0 0 0 / 0.1);
      --shadow-lg:     0 20px 25px -5px rgb(0 0 0 / 0.1);
      --transition:    .22s cubic-bezier(.4,0,.2,1);
    }

    #ticket-root {
      min-height: 100vh;
      background-color: var(--input-bg);
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding: 48px 16px 64px;
      font-family: 'Inter', system-ui, sans-serif;
      color: var(--text-main);
    }

    /* ── Card ── */
    .tk-card {
      width: 100%;
      max-width: 820px;
      background: var(--white);
      border-radius: var(--radius);
      box-shadow: var(--shadow-lg);
      border: 1px solid var(--border);
      overflow: hidden;
      animation: tk-rise .45s var(--transition) both;
    }
    @keyframes tk-rise {
      from { opacity: 0; transform: translateY(20px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    /* ── Header ── */
    .tk-header {
      background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%);
      padding: 40px 40px 36px;
      text-align: center;
    }
    .tk-logo-wrap {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: rgba(255,255,255,.18);
      border-radius: 50%;
      width: 64px;
      height: 64px;
      margin-bottom: 18px;
    }
    .tk-logo-wrap svg { width: 32px; height: 32px; fill: #fff; }
    .tk-header h1 {
      color: #fff;
      font-size: 26px;
      font-weight: 800;
      letter-spacing: -.5px;
      margin-bottom: 8px;
    }
    .tk-header p {
      color: rgba(255,255,255,.75);
      font-size: 15px;
      font-weight: 500;
    }

    /* ── Body ── */
    .tk-body { padding: 40px; }

    /* ── Alerts ── */
    .tk-alert {
      display: none;
      align-items: flex-start;
      gap: 12px;
      padding: 16px 18px;
      border-radius: var(--radius-sm);
      margin-bottom: 28px;
      font-size: 15px;
      font-weight: 600;
      animation: tk-pop .3s ease both;
    }
    @keyframes tk-pop {
      from { opacity: 0; transform: scale(.97); }
      to   { opacity: 1; transform: scale(1); }
    }
    .tk-alert.success { background: var(--green-bg); color: var(--green); display: flex; }
    .tk-alert.error   { background: var(--red-bg);   color: var(--red);   display: flex; }
    .tk-alert svg { flex-shrink: 0; width: 20px; height: 20px; margin-top: 1px; }

    /* ── Grid ── */
    .tk-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0 24px;
    }

    /* ── Field ── */
    .tk-field { margin-bottom: 22px; }
    .tk-field.full { grid-column: 1 / -1; }

    .tk-label {
      display: block;
      font-size: 13.5px;
      font-weight: 600;
      color: var(--text-muted);
      margin-bottom: 8px;
      letter-spacing: .02em;
      text-transform: uppercase;
    }
    .tk-label .req { color: var(--red); margin-left: 3px; }

    .tk-control {
      display: block;
      width: 100%;
      padding: 13px 16px;
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      background: var(--input-bg);
      font-size: 15px;
      font-family: inherit;
      color: var(--text-main);
      transition: border-color var(--transition), box-shadow var(--transition), background var(--transition);
      outline: none;
      appearance: none;
      box-shadow: var(--shadow-sm);
    }
    .tk-control::placeholder { color: var(--text-light); }
    .tk-control:hover  { border-color: #cbd5e1; background: #ffffff; }
    .tk-control:focus  {
      border-color: var(--primary);
      background: var(--white);
      box-shadow: 0 0 0 4px var(--primary-light);
    }
    textarea.tk-control { resize: vertical; min-height: 108px; line-height: 1.6; }

    /* select arrow */
    select.tk-control {
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2394A3B8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 14px center;
      padding-right: 40px;
      cursor: pointer;
    }

    /* ── Section divider ── */
    .tk-divider {
      grid-column: 1 / -1;
      display: flex;
      align-items: center;
      gap: 14px;
      margin: 4px 0 20px;
    }
    .tk-divider-line { flex: 1; height: 1px; background: var(--border); }
    .tk-divider-label {
      font-size: 12px;
      font-weight: 700;
      letter-spacing: .08em;
      text-transform: uppercase;
      color: var(--text-light);
    }

    /* ── Submit ── */
    .tk-submit {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      width: 100%;
      padding: 15px 24px;
      margin-top: 12px;
      border: none;
      border-radius: var(--radius-sm);
      background: var(--primary);
      color: #fff;
      font-size: 16px;
      font-weight: 700;
      font-family: inherit;
      cursor: pointer;
      transition: opacity var(--transition), transform var(--transition), box-shadow var(--transition);
      box-shadow: var(--shadow-sm);
    }
    .tk-submit:hover:not(:disabled) {
      background: var(--primary-dark);
      transform: translateY(-2px);
      box-shadow: var(--shadow);
    }
    .tk-submit:active:not(:disabled) { transform: translateY(0); }
    .tk-submit:disabled { opacity: .65; cursor: not-allowed; }

    .tk-spinner {
      width: 20px; height: 20px;
      border: 3px solid rgba(255,255,255,.3);
      border-top-color: #fff;
      border-radius: 50%;
      animation: tk-spin .7s linear infinite;
      display: none;
    }
    @keyframes tk-spin { to { transform: rotate(360deg); } }

    /* ── Skeleton loader ── */
    .tk-skeleton-wrap { padding: 40px; }
    .tk-skel {
      background: linear-gradient(90deg, #F1F5F9 25%, #E2E8F0 50%, #F1F5F9 75%);
      background-size: 200% 100%;
      border-radius: 8px;
      animation: tk-shimmer 1.4s ease infinite;
    }
    @keyframes tk-shimmer {
      0%   { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }
    .tk-skel-title { height: 28px; width: 55%; margin: 0 auto 32px; border-radius: 8px; }
    .tk-skel-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 24px; }
    .tk-skel-field { margin-bottom: 22px; }
    .tk-skel-label { height: 13px; width: 40%; margin-bottom: 10px; border-radius: 6px; }
    .tk-skel-input { height: 48px; border-radius: 10px; }
    .tk-skel-full { grid-column: 1 / -1; }
    .tk-skel-btn   { height: 52px; border-radius: 10px; margin-top: 12px; }

    /* ── Footer ── */
    .tk-footer {
      text-align: center;
      font-size: 13px;
      color: var(--text-light);
      margin-top: 24px;
      padding: 0 40px 28px;
    }

    /* ── Mobile ── */
    @media (max-width: 640px) {
      #ticket-root   { padding: 0 0 40px; align-items: flex-start; }
      .tk-card       { border-radius: 0; }
      .tk-header     { padding: 32px 24px 28px; }
      .tk-header h1  { font-size: 22px; }
      .tk-body       { padding: 28px 20px; }
      .tk-footer     { padding: 0 20px 24px; }
      .tk-grid,
      .tk-skel-grid  { grid-template-columns: 1fr; }
      .tk-field.full { grid-column: 1; }
      .tk-divider    { grid-column: 1; }
    }
  `;

  /* ─── SVG icons ─────────────────────────────────────────────────── */
  const ICON_TICKET = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M20 12a2 2 0 0 0 0-4V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v3a2 2 0 0 0 0 4v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3Z"/></svg>`;
  const ICON_OK     = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`;
  const ICON_ERR    = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;

  /* ─── Helpers ────────────────────────────────────────────────────── */
  const el  = (tag, cls, attrs = {}) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'html') e.innerHTML = v;
      else e[k] = v;
    });
    return e;
  };

  /* ─── Widget class ───────────────────────────────────────────────── */
  class TicketWidget {
    constructor(rootId) {
      this.root   = document.getElementById(rootId);
      this.schema = null;
      this._injectStyles();
      this._renderSkeleton();
      this._bootstrap();
    }

    _injectStyles() {
      const s = document.createElement('style');
      s.textContent = CSS;
      document.head.appendChild(s);
    }

    /* ── Skeleton ── */
    _renderSkeleton() {
      const skFields = Array.from({length: 8}, (_, i) =>
        `<div class="tk-skel-field${i >= 6 ? ' tk-skel-full' : ''}">
          <div class="tk-skel tk-skel-label"></div>
          <div class="tk-skel tk-skel-input" style="height:${i >= 6 ? '100px' : '48px'}"></div>
        </div>`
      ).join('');

      this.root.innerHTML = `
        <div class="tk-card">
          <div class="tk-header">
            <div class="tk-logo-wrap">${ICON_TICKET}</div>
            <h1>Raise a Support Ticket</h1>
            <p>Fill the form below – no login required</p>
          </div>
          <div class="tk-skeleton-wrap">
            <div class="tk-skel tk-skel-title"></div>
            <div class="tk-skel-grid">${skFields}</div>
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
            <div class="tk-header"><div class="tk-logo-wrap">${ICON_TICKET}</div>
              <h1>Raise a Support Ticket</h1><p>Sree Chakra Sewing Systems</p></div>
            <div class="tk-body">
              <div class="tk-alert error" style="display:flex">${ICON_ERR}
                <span>Unable to load the form. Please refresh the page or contact support.</span></div>
            </div>
          </div>`;
      }
    }

    /* ── Fetch schema ── */
    async _fetchSchema() {
      return new Promise((resolve, reject) => {
        frappe.call({
          method: 'vin_chakra.api.get_form_schema',
          async: true,
          callback: (r) => {
            if (r && r.message) {
              this.schema = r.message;
              resolve();
            } else {
              reject(new Error('Invalid schema'));
            }
          },
          error: (err) => reject(err)
        });
      });
    }

    /* ── Render ── */
    _render() {
      const card    = el('div', 'tk-card');
      const header  = this._buildHeader();
      const body    = el('div', 'tk-body');
      const footer  = el('div', 'tk-footer', { html: '🔒 Your information is private and securely submitted.' });

      /* alert boxes */
      this._alertEl = el('div', 'tk-alert');
      body.appendChild(this._alertEl);

      /* form */
      const form = el('form');
      form.noValidate = false;
      form.onsubmit   = (e) => this._onSubmit(e);

      const grid = el('div', 'tk-grid');

      /* group fields by sections */
      const customerFields  = ['custom_customer_name','custom_customer_mobile_number'];
      const locationFields  = ['custom_state','custom_city__district_','custom_address'];
      const machineFields   = ['custom_date','custom_machine_name','custom_machine_problem','custom_purchased_at_sree_chakra_sewing_systems'];
      const issueFields     = ['subject','description'];

      const sections = [
        { label: 'Customer Details',  keys: customerFields },
        { label: 'Location',          keys: locationFields },
        { label: 'Machine Details',   keys: machineFields },
        { label: 'Issue Description', keys: issueFields },
      ];

      const fieldMap = {};
      this.schema.fields.forEach(f => { fieldMap[f.fieldname] = f; });

      sections.forEach(sec => {
        /* divider */
        const div = el('div', 'tk-divider');
        div.innerHTML = `<div class="tk-divider-line"></div>
          <span class="tk-divider-label">${sec.label}</span>
          <div class="tk-divider-line"></div>`;
        grid.appendChild(div);

        sec.keys.forEach(key => {
          const f = fieldMap[key];
          if (!f) return;
          grid.appendChild(this._buildField(f));
        });
      });

      /* any remaining fields not mapped */
      this.schema.fields.forEach(f => {
        if (sections.every(s => !s.keys.includes(f.fieldname))) {
          grid.appendChild(this._buildField(f));
        }
      });

      form.appendChild(grid);

      /* submit */
      const btn  = el('button', 'tk-submit');
      btn.type   = 'submit';
      btn.id     = 'tk-btn';
      const spin = el('div',  'tk-spinner');
      spin.id    = 'tk-spin';
      const txt  = el('span', null, { textContent: 'Submit Ticket' });
      txt.id     = 'tk-btn-txt';
      btn.appendChild(spin);
      btn.appendChild(txt);
      form.appendChild(btn);

      body.appendChild(form);
      card.appendChild(header);
      card.appendChild(body);
      card.appendChild(footer);

      this.root.innerHTML = '';
      this.root.appendChild(card);
      this._form = form;
    }

    _buildHeader() {
      const h = el('div', 'tk-header');
      h.innerHTML = `
        <div class="tk-logo-wrap">${ICON_TICKET}</div>
        <h1>${this.schema.title || 'Raise a Support Ticket'}</h1>
        <p>Sree Chakra Sewing Systems – No login required</p>`;
      return h;
    }

    _buildField(f) {
      const isLong = ['Text Editor','Small Text','Text'].includes(f.fieldtype);
      const group  = el('div', 'tk-field' + (isLong ? ' full' : ''));

      const lbl = el('label', 'tk-label');
      lbl.innerHTML = `${f.label}${f.reqd ? '<span class="req">*</span>' : ''}`;
      group.appendChild(lbl);

      let ctrl;
      if (['Select','Link'].includes(f.fieldtype)) {
        ctrl = el('select', 'tk-control');
        ctrl.innerHTML = `<option value="" disabled selected>Select ${f.label}</option>`;
        f.options.forEach(o => {
          const opt = document.createElement('option');
          opt.value = o; opt.textContent = o;
          ctrl.appendChild(opt);
        });
      } else if (isLong) {
        ctrl = el('textarea', 'tk-control');
        ctrl.rows = f.fieldtype === 'Text Editor' ? 5 : 3;
        ctrl.placeholder = `Describe ${f.label.toLowerCase()}…`;
      } else if (f.fieldtype === 'Date') {
        ctrl = el('input',  'tk-control', { type: 'date' });
        ctrl.valueAsDate = new Date();
      } else if (f.fieldtype === 'Phone') {
        ctrl = el('input', 'tk-control', { type: 'tel', placeholder: `e.g. 9876543210` });
        ctrl.pattern = '[0-9]{10}';
        ctrl.maxLength = 10;
        ctrl.title = 'Enter 10-digit mobile number';
      } else {
        ctrl = el('input', 'tk-control', { type: 'text', placeholder: `Enter ${f.label}` });
      }

      ctrl.name = f.fieldname;
      if (f.reqd) ctrl.required = true;
      group.appendChild(ctrl);
      return group;
    }

    /* ── Submit ── */
    _onSubmit(e) {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(this._form).entries());

      const btn  = document.getElementById('tk-btn');
      const spin = document.getElementById('tk-spin');
      const txt  = document.getElementById('tk-btn-txt');

      btn.disabled         = true;
      spin.style.display   = 'block';
      txt.textContent      = 'Submitting…';
      this._alertEl.className = 'tk-alert';
      this._alertEl.style.display = 'none';

      frappe.call({
        method: 'vin_chakra.api.submit_ticket',
        args: { data: data },
        async: true,
        callback: (r) => {
          btn.disabled       = false;
          spin.style.display = 'none';
          txt.textContent    = 'Submit Ticket';

          if (r.message?.status === 'success') {
            this._showAlert('success',
              `Your ticket <strong>${r.message.ticket_name}</strong> has been raised successfully! We'll reach out to you soon.`);
            this._form.reset();
            this._form.querySelectorAll('input[type="date"]')
              .forEach(i => i.valueAsDate = new Date());
            this._alertEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          } else {
            this._showAlert('error', r.message?.message || 'Something went wrong. Please try again.');
          }
        },
        error: (err) => {
          btn.disabled       = false;
          spin.style.display = 'none';
          txt.textContent    = 'Submit Ticket';
          this._showAlert('error', 'Server error. Please try again later.');
        }
      });
    }

    _showAlert(type, html) {
      this._alertEl.className = `tk-alert ${type}`;
      this._alertEl.innerHTML = (type === 'success' ? ICON_OK : ICON_ERR) + `<span>${html}</span>`;
      this._alertEl.style.display = 'flex';
      if (type === 'success') {
        setTimeout(() => { this._alertEl.style.display = 'none'; }, 8000);
      }
    }
  }

  /* ─── Boot ─────────────────────────────────────────────────────── */
  function boot() {
    if (document.getElementById(ROOT_ID)) {
      new TicketWidget(ROOT_ID);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
