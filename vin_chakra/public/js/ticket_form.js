/**
 * TicketWidget – Sree Chakra Sewing Systems
 * Fixed: state/district cascade, Tamil Nadu default,
 *        "Other" free-text fallback, south-India states only.
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

  /* ─── Styles ─────────────────────────────────────────────────────── */
  const CSS = `
    :root {
      --primary:        #4f46e5;
      --primary-dark:   #3730a3;
      --primary-light:  rgba(79,70,229,0.10);
      --accent:         #f59e0b;
      --green:          #15803d;
      --green-bg:       #dcfce7;
      --green-border:   #86efac;
      --red:            #dc2626;
      --red-bg:         #fef2f2;
      --red-border:     #fca5a5;
      --text-main:      #0f172a;
      --text-muted:     #475569;
      --text-light:     #94a3b8;
      --border:         #e2e8f0;
      --input-bg:       #f8fafc;
      --surface:        #ffffff;
      --bg:             #f1f5f9;
      --radius:         20px;
      --radius-sm:      12px;
      --shadow-lg:      0 20px 40px rgba(0,0,0,.10), 0 8px 16px rgba(0,0,0,.06);
      --transition:     .2s cubic-bezier(.4,0,.2,1);
    }
    *, *::before, *::after { box-sizing: border-box; }

    #ticket-root {
      min-height: 100vh;
      background: var(--bg);
      background-image: radial-gradient(ellipse 80% 50% at 50% -10%, rgba(79,70,229,.12) 0%, transparent 70%);
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding: 40px 16px 72px;
      font-family: 'Inter','Segoe UI',system-ui,sans-serif;
      color: var(--text-main);
      -webkit-font-smoothing: antialiased;
    }

    /* Card */
    .tk-card {
      width: 100%; max-width: 860px;
      background: var(--surface);
      border-radius: var(--radius);
      box-shadow: var(--shadow-lg);
      border: 1px solid var(--border);
      overflow: hidden;
      animation: tk-rise .5s cubic-bezier(.22,.68,0,1.2) both;
    }
    @keyframes tk-rise {
      from { opacity:0; transform:translateY(28px) scale(.98); }
      to   { opacity:1; transform:translateY(0)    scale(1); }
    }

    /* Header */
    .tk-header {
      position: relative;
      background: linear-gradient(135deg, var(--primary) 0%, #6d28d9 100%);
      padding: 44px 44px 38px;
      text-align: center;
      overflow: hidden;
    }
    .tk-header::before {
      content:'';
      position:absolute; inset:0;
      background:
        radial-gradient(circle at 20% 50%, rgba(255,255,255,.08) 0%, transparent 55%),
        radial-gradient(circle at 80% 20%, rgba(245,158,11,.14) 0%, transparent 45%);
      pointer-events:none;
    }
    .tk-header-inner { position:relative; z-index:1; }
    .tk-logo-wrap {
      display:inline-flex; align-items:center; justify-content:center;
      background:rgba(255,255,255,.18); backdrop-filter:blur(8px);
      border:1px solid rgba(255,255,255,.25); border-radius:16px;
      width:64px; height:64px; margin-bottom:18px;
    }
    .tk-logo-wrap svg { width:32px; height:32px; fill:#fff; }
    .tk-badge {
      display:inline-flex; align-items:center; gap:6px;
      background:rgba(255,255,255,.15); border:1px solid rgba(255,255,255,.2);
      border-radius:99px; padding:4px 14px;
      font-size:12px; font-weight:600; color:rgba(255,255,255,.9);
      letter-spacing:.04em; text-transform:uppercase; margin-bottom:14px;
    }
    .tk-badge-dot {
      width:6px; height:6px; background:#4ade80;
      border-radius:50%; box-shadow:0 0 6px #4ade80;
      animation:tk-pulse 2s ease infinite;
    }
    @keyframes tk-pulse {
      0%,100%{opacity:1;transform:scale(1)}
      50%{opacity:.6;transform:scale(.85)}
    }
    .tk-header h1 {
      color:#fff; font-size:28px; font-weight:800;
      letter-spacing:-.6px; line-height:1.15; margin-bottom:8px;
    }
    .tk-header p { color:rgba(255,255,255,.7); font-size:14.5px; font-weight:500; }

    /* Step bar */
    .tk-steps {
      display:flex; align-items:center; justify-content:center;
      padding:0 44px;
      background:rgba(0,0,0,.12);
      position:relative; z-index:1;
    }
    .tk-step {
      display:flex; flex-direction:column; align-items:center;
      gap:6px; padding:14px 0; flex:1;
    }
    .tk-step-dot {
      width:28px; height:28px; border-radius:50%;
      background:rgba(255,255,255,.2); border:2px solid rgba(255,255,255,.35);
      display:flex; align-items:center; justify-content:center;
      font-size:11px; font-weight:700; color:rgba(255,255,255,.7);
      transition:var(--transition);
    }
    .tk-step.active .tk-step-dot {
      background:#fff; border-color:#fff; color:var(--primary);
      box-shadow:0 0 0 4px rgba(255,255,255,.25);
    }
    .tk-step.done .tk-step-dot { background:#4ade80; border-color:#4ade80; color:#fff; }
    .tk-step-label {
      font-size:10px; font-weight:600; color:rgba(255,255,255,.55);
      text-transform:uppercase; letter-spacing:.05em; white-space:nowrap;
    }
    .tk-step.active .tk-step-label { color:rgba(255,255,255,.9); }
    .tk-step-line {
      flex:1; height:1px; background:rgba(255,255,255,.2);
      margin-bottom:22px; align-self:flex-start; margin-top:28px;
    }

    /* Body */
    .tk-body { padding:40px 44px; }

    /* Alerts */
    .tk-alert {
      display:none; align-items:flex-start; gap:12px;
      padding:16px 18px; border-radius:var(--radius-sm);
      margin-bottom:28px; font-size:14.5px; font-weight:500;
      line-height:1.5; border:1px solid transparent;
      animation:tk-pop .28s cubic-bezier(.22,.68,0,1.2) both;
    }
    @keyframes tk-pop {
      from{opacity:0;transform:scale(.96) translateY(-4px)}
      to{opacity:1;transform:scale(1) translateY(0)}
    }
    .tk-alert.success { background:var(--green-bg); color:var(--green); border-color:var(--green-border); display:flex; }
    .tk-alert.error   { background:var(--red-bg);   color:var(--red);   border-color:var(--red-border);   display:flex; }
    .tk-alert svg { flex-shrink:0; width:20px; height:20px; margin-top:1px; }

    /* Info banner */
    .tk-info-banner {
      display:flex; align-items:center; gap:12px;
      padding:14px 18px; border-radius:var(--radius-sm);
      margin-bottom:32px; font-size:14px; font-weight:500;
      background:var(--primary-light); color:var(--primary-dark);
      border:1px solid rgba(79,70,229,.18);
    }
    .tk-info-banner svg { flex-shrink:0; width:18px; height:18px; }

    /* Section header */
    .tk-section-head {
      grid-column:1/-1;
      display:flex; align-items:center; gap:12px;
      margin:8px 0 20px;
    }
    .tk-section-num {
      width:28px; height:28px; border-radius:8px;
      background:var(--primary-light); color:var(--primary);
      font-size:12px; font-weight:800;
      display:flex; align-items:center; justify-content:center; flex-shrink:0;
    }
    .tk-section-title {
      font-size:13px; font-weight:700; color:var(--primary-dark);
      letter-spacing:.06em; text-transform:uppercase;
    }
    .tk-section-line {
      flex:1; height:1px;
      background:linear-gradient(to right, var(--border), transparent);
    }

    /* Grid */
    .tk-grid { display:grid; grid-template-columns:1fr 1fr; gap:0 28px; }

    /* Fields */
    .tk-field { margin-bottom:20px; }
    .tk-field.full { grid-column:1/-1; }

    .tk-label {
      display:flex; align-items:center; gap:6px;
      font-size:13px; font-weight:600; color:var(--text-muted);
      margin-bottom:7px; letter-spacing:.03em;
    }
    .tk-label-icon { width:14px; height:14px; opacity:.6; flex-shrink:0; }
    .req { color:var(--red); margin-left:1px; }

    /* Input prefix icon wrapper */
    .tk-input-wrap { position:relative; }
    .tk-input-prefix {
      position:absolute; left:14px; top:50%; transform:translateY(-50%);
      display:flex; align-items:center; pointer-events:none;
    }
    .tk-input-prefix svg { width:16px; height:16px; color:var(--text-light); }
    .tk-input-wrap .tk-control { padding-left:40px; }

    /* Controls */
    .tk-control {
      display:block; width:100%; padding:12px 16px;
      border:1.5px solid var(--border); border-radius:var(--radius-sm);
      background:var(--input-bg); font-size:14.5px;
      font-family:inherit; color:var(--text-main);
      transition:border-color var(--transition),box-shadow var(--transition),background var(--transition);
      outline:none; appearance:none; -webkit-appearance:none; line-height:1.5;
    }
    .tk-control::placeholder { color:var(--text-light); }
    .tk-control:hover:not(:disabled) { border-color:#c7d2fe; background:#fff; }
    .tk-control:focus {
      border-color:var(--primary); background:var(--surface);
      box-shadow:0 0 0 4px var(--primary-light);
    }
    textarea.tk-control { resize:vertical; min-height:110px; line-height:1.6; }
    .tk-control:disabled { background:#f1f5f9; color:var(--text-light); cursor:not-allowed; }

    select.tk-control {
      background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%236366f1' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
      background-repeat:no-repeat; background-position:right 14px center;
      padding-right:42px; cursor:pointer;
    }
    select.tk-control:disabled {
      background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
    }

    /* Validation */
    .tk-control.tk-invalid {
      border-color:var(--red) !important;
      box-shadow:0 0 0 3px rgba(220,38,38,.12) !important;
      animation:tk-shake .3s ease;
    }
    @keyframes tk-shake {
      0%,100%{transform:translateX(0)}
      20%,60%{transform:translateX(-4px)}
      40%,80%{transform:translateX(4px)}
    }
    .tk-field-error {
      display:none; align-items:center; gap:5px;
      color:var(--red); font-size:12px; font-weight:500; margin-top:6px;
    }
    .tk-field-error svg { width:12px; height:12px; flex-shrink:0; }

    /* "Other" free-text row */
    .tk-other-row {
      margin-top:8px;
      display:none;
    }
    .tk-other-row.visible { display:block; }
    .tk-other-row .tk-control { background:#fff; }

    /* Char counter */
    .tk-char-wrap { position:relative; }
    .tk-char-count {
      display:block; text-align:right;
      font-size:11px; color:var(--text-light); margin-top:5px;
    }
    .tk-char-count.warn { color:var(--accent); }

    /* Submit */
    .tk-submit-wrap { margin-top:16px; }
    .tk-submit {
      display:flex; align-items:center; justify-content:center; gap:10px;
      width:100%; padding:15px 24px; border:none;
      border-radius:var(--radius-sm);
      background:linear-gradient(135deg, var(--primary) 0%, #6d28d9 100%);
      color:#fff; font-size:15.5px; font-weight:700; font-family:inherit;
      cursor:pointer;
      transition:opacity var(--transition),transform var(--transition),box-shadow var(--transition);
      box-shadow:0 4px 14px rgba(79,70,229,.35);
      letter-spacing:.01em; position:relative; overflow:hidden;
    }
    .tk-submit:hover:not(:disabled) {
      transform:translateY(-2px);
      box-shadow:0 8px 22px rgba(79,70,229,.45);
    }
    .tk-submit:active:not(:disabled) {
      transform:translateY(0);
      box-shadow:0 3px 10px rgba(79,70,229,.3);
    }
    .tk-submit:disabled { opacity:.65; cursor:not-allowed; transform:none; }
    .tk-spinner {
      width:18px; height:18px;
      border:2.5px solid rgba(255,255,255,.35); border-top-color:#fff;
      border-radius:50%; animation:tk-spin .6s linear infinite; display:none;
    }
    @keyframes tk-spin { to{transform:rotate(360deg)} }

    /* Skeleton */
    .tk-skeleton-wrap { padding:40px 44px; }
    .tk-skel {
      background:linear-gradient(90deg,#f1f5f9 25%,#e2e8f0 50%,#f1f5f9 75%);
      background-size:200% 100%; border-radius:8px;
      animation:tk-shimmer 1.5s ease infinite;
    }
    @keyframes tk-shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
    .tk-skel-title { height:26px; width:52%; margin:0 auto 36px; border-radius:8px; }
    .tk-skel-grid  { display:grid; grid-template-columns:1fr 1fr; gap:0 28px; }
    .tk-skel-field { margin-bottom:20px; }
    .tk-skel-label { height:13px; width:38%; margin-bottom:9px; border-radius:6px; }
    .tk-skel-input { height:46px; border-radius:10px; }
    .tk-skel-full  { grid-column:1/-1; }
    .tk-skel-btn   { height:52px; border-radius:12px; margin-top:16px; }

    /* Footer */
    .tk-footer {
      text-align:center; font-size:12.5px; color:var(--text-light);
      padding:0 44px 32px;
      display:flex; align-items:center; justify-content:center; gap:6px;
    }
    .tk-footer svg { width:13px; height:13px; flex-shrink:0; }

    /* Mobile */
    @media (max-width:640px) {
      #ticket-root      { padding:0 0 48px; }
      .tk-card          { border-radius:0; box-shadow:none; }
      .tk-header        { padding:32px 20px 28px; }
      .tk-header h1     { font-size:22px; }
      .tk-steps         { padding:0 20px; }
      .tk-step-label    { display:none; }
      .tk-body          { padding:28px 20px; }
      .tk-skeleton-wrap { padding:28px 20px; }
      .tk-footer        { padding:0 20px 28px; }
      .tk-grid,
      .tk-skel-grid     { grid-template-columns:1fr; }
      .tk-field.full    { grid-column:1; }
      .tk-section-head  { grid-column:1; }
    }
    @media (prefers-reduced-motion:reduce) {
      *,*::before,*::after { animation-duration:.01ms !important; transition-duration:.01ms !important; }
    }
  `;

  /* ─── SVG icons ──────────────────────────────────────────────────── */
  const ICONS = {
    ticket:   `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M20 12a2 2 0 0 0 0-4V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v3a2 2 0 0 0 0 4v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3Z"/></svg>`,
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
      /* These refs are set during _buildLocationSection, used by _populateDistricts */
      this._stateSelect    = null;
      this._districtSelect = null;
      this._districtOtherRow = null;
      this._injectStyles();
      this._renderSkeleton();
      this._bootstrap();
    }

    _injectStyles() {
      if (document.getElementById('tk-styles')) return;
      const s = document.createElement('style');
      s.id = 'tk-styles';
      s.textContent = CSS;
      document.head.appendChild(s);
    }

    /* ── Skeleton ── */
    _renderSkeleton() {
      const fields = Array.from({ length: 8 }, (_, i) =>
        `<div class="tk-skel-field${i >= 6 ? ' tk-skel-full' : ''}">
           <div class="tk-skel tk-skel-label"></div>
           <div class="tk-skel tk-skel-input" style="height:${i >= 6 ? '106px' : '46px'}"></div>
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

      const grid = el('div', 'tk-grid');

      const fieldMap = {};
      this.schema.fields.forEach(f => { fieldMap[f.fieldname] = f; });

      const sections = [
        { label:'Customer Details', num:'01', keys:['custom_customer_name','custom_customer_mobile_number'] },
        { label:'Location',         num:'02', keys:['custom_state','custom_city__district_','custom_address'] },
        { label:'Machine Details',  num:'03', keys:['custom_date','custom_machine_name','custom_machine_problem','custom_purchased_at_sree_chakra_sewing_systems'] },
        { label:'Issue Details',    num:'04', keys:['subject','description'] },
      ];

      const usedKeys = new Set();

      sections.forEach(sec => {
        /* Section divider */
        const head = el('div', 'tk-section-head');
        head.innerHTML = `
          <div class="tk-section-num">${sec.num}</div>
          <span class="tk-section-title">${sec.label}</span>
          <div class="tk-section-line"></div>`;
        grid.appendChild(head);

        sec.keys.forEach(key => {
          const f = fieldMap[key];
          if (!f) return;
          usedKeys.add(key);

          if (key === 'custom_state') {
            grid.appendChild(this._buildStateField(f));
          } else if (key === 'custom_city__district_') {
            grid.appendChild(this._buildDistrictField(f));
          } else {
            grid.appendChild(this._buildField(f));
          }
        });
      });

      /* Unmapped fallback */
      this.schema.fields.forEach(f => {
        if (!usedKeys.has(f.fieldname)) grid.appendChild(this._buildField(f));
      });

      form.appendChild(grid);

      /* ── CRITICAL: populate districts AFTER both selects exist in DOM ── */
      this._populateDistricts('Tamil Nadu');

      /* Submit button */
      const submitWrap = el('div', 'tk-submit-wrap');
      const btn = el('button', 'tk-submit');
      btn.type = 'submit';
      btn.id   = 'tk-btn';

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

      btn.append(spin, btnTxt, sendIconWrap);
      submitWrap.appendChild(btn);
      form.appendChild(submitWrap);

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

    /* ── Header with step bar ── */
    _buildHeader() {
      const h = el('div', 'tk-header');
      const stepDefs = ['Customer','Location','Machine','Issue'];
      const stepHtml = stepDefs.map((label, i) => `
        <div class="tk-step${i === 0 ? ' active' : ''}" data-step="${i}">
          <div class="tk-step-dot">${i + 1}</div>
          <span class="tk-step-label">${label}</span>
        </div>
        ${i < stepDefs.length - 1 ? '<div class="tk-step-line"></div>' : ''}`
      ).join('');

      h.innerHTML = `
        <div class="tk-header-inner">
          <div class="tk-badge"><div class="tk-badge-dot"></div>Support</div>
          <div class="tk-logo-wrap">${ICONS.ticket}</div>
          <h1>${this.schema.title || 'Raise a Support Ticket'}</h1>
          <p>Sree Chakra Sewing Systems</p>
        </div>
        <div class="tk-steps">${stepHtml}</div>`;
      return h;
    }

    /* ─────────────────────────────────────────────────────────────────
       STATE FIELD
       Renders a <select> with all states. Stores ref in this._stateSelect.
       Does NOT call _populateDistricts here — district select doesn't
       exist yet. Population happens after both fields are in the DOM.
    ───────────────────────────────────────────────────────────────── */
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

    /* ─────────────────────────────────────────────────────────────────
       DISTRICT FIELD
       Renders a <select> + an "Other" free-text input below it.
       Stores refs in this._districtSelect and this._districtOtherRow.
    ───────────────────────────────────────────────────────────────── */
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

    /* ─────────────────────────────────────────────────────────────────
       POPULATE DISTRICTS
       Called after BOTH state & district selects are in the DOM.
       - If state has a known list → fill dropdown, add "Other" option
       - If state is "Other"       → show free-text immediately
    ───────────────────────────────────────────────────────────────── */
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

    /* ── Generic field builder ── */
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

    /* ── Clear a single field's error state ── */
    _clearError(ctrl, group) {
      ctrl.classList.remove('tk-invalid');
      const err = group.querySelector('.tk-field-error');
      if (err) err.style.display = 'none';
    }

    /* ── Submit ── */
    _onSubmit(e) {
      e.preventDefault();

      /* Reset all validation UI */
      this._form.querySelectorAll('.tk-invalid').forEach(c => c.classList.remove('tk-invalid'));
      this._form.querySelectorAll('.tk-field-error').forEach(c => c.style.display = 'none');

      let hasError = false;
      let firstError = null;

      /* Required check */
      this._form.querySelectorAll('[required]').forEach(ctrl => {
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

      /* Phone pattern */
      this._form.querySelectorAll('input[type="tel"]').forEach(ctrl => {
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
        this._showAlert('error', 'Please fix the highlighted fields before submitting.');
        if (firstError) {
          firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setTimeout(() => firstError.focus(), 380);
        }
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
            const masked = phoneNumber
              ? phoneNumber.slice(0, 2) + '****' + phoneNumber.slice(-4)
              : 'your registered number';
            this._showAlert('success',
              `Ticket <strong>${r.message.ticket_name}</strong> raised successfully! ` +
              `OTP sent to <strong>${masked}</strong>.`);
            this._form.reset();
            /* Restore date default */
            this._form.querySelectorAll('input[type="date"]')
              .forEach(i => i.valueAsDate = new Date());
            /* Restore state/district defaults */
            if (this._stateSelect) this._stateSelect.value = 'Tamil Nadu';
            this._populateDistricts('Tamil Nadu');
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