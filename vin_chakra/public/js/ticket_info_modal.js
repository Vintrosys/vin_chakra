// Inject a "Ticket Info (Popup)" button on Helpdesk Ticket detail pages
// Allows viewing and editing all ticket info & custom fields in a modal popup.

(function () {
    let activeTicketId = null;

    function getTicketIdFromUrl() {
        const match = window.location.pathname.match(/\/helpdesk\/tickets\/([^/?#]+)/);
        return match ? match[1] : null;
    }

    function injectTicketInfoButton() {
        const ticketId = getTicketIdFromUrl();
        if (!ticketId) {
            removeExistingModal();
            return;
        }

        activeTicketId = ticketId;

        // Prevent duplicate buttons
        if (document.getElementById('ct-btn-open-ticket-info-modal')) {
            return;
        }

        const btn = document.createElement('button');
        btn.id = 'ct-btn-open-ticket-info-modal';
        btn.type = 'button';
        btn.innerHTML = '✏️ Edit Ticket Info (Popup)';

        // Styling for modern pill button
        Object.assign(btn.style, {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '5px 12px',
            backgroundColor: '#2563eb',
            color: '#ffffff',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontWeight: '600',
            fontSize: '12px',
            boxShadow: '0 2px 4px rgba(37, 99, 235, 0.25)',
            transition: 'all 0.2s ease-in-out',
            marginLeft: '8px',
            zIndex: '10'
        });

        btn.onmouseenter = () => { btn.style.backgroundColor = '#1d4ed8'; };
        btn.onmouseleave = () => { btn.style.backgroundColor = '#2563eb'; };

        btn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            openTicketInfoModal(activeTicketId);
        };

        // Search for Ticket Info section header
        let targetContainer = null;
        const allSpans = document.querySelectorAll('span, div, h3, h4');
        for (let el of allSpans) {
            if (el.children.length === 0 && el.textContent && el.textContent.trim() === "Ticket Info") {
                targetContainer = el.parentElement;
                break;
            }
        }

        if (targetContainer) {
            targetContainer.style.display = 'flex';
            targetContainer.style.alignItems = 'center';
            targetContainer.style.justifyContent = 'space-between';
            targetContainer.appendChild(btn);
        } else {
            // Header bar fallback
            let headerRight = document.querySelector('header .shrink-0') || document.querySelector('header .flex-1') || document.querySelector('header');
            if (headerRight) {
                btn.style.marginRight = '10px';
                headerRight.appendChild(btn);
            } else {
                // Fixed floating button fallback
                btn.style.position = 'fixed';
                btn.style.top = '14px';
                btn.style.right = '120px';
                btn.style.zIndex = '9999';
                document.body.appendChild(btn);
            }
        }
    }

    function removeExistingModal() {
        const existing = document.getElementById('ct-ticket-modal-overlay');
        if (existing) existing.remove();
    }

    function getCsrfToken() {
        return window.csrf_token || (window.boot && window.boot.csrf_token) || '';
    }

    async function openTicketInfoModal(ticketId) {
        removeExistingModal();

        // Create overlay
        const overlay = document.createElement('div');
        overlay.id = 'ct-ticket-modal-overlay';
        Object.assign(overlay.style, {
            position: 'fixed',
            top: '0',
            left: '0',
            width: '100vw',
            height: '100vh',
            backgroundColor: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(4px)',
            zIndex: '99999',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px'
        });

        // Create modal content container
        const modal = document.createElement('div');
        modal.id = 'ct-ticket-modal-box';
        Object.assign(modal.style, {
            backgroundColor: '#ffffff',
            borderRadius: '12px',
            width: '100%',
            maxWidth: '850px',
            maxHeight: '90vh',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            fontFamily: 'Inter, system-ui, -apple-system, sans-serif'
        });

        modal.innerHTML = `
            <div style="padding: 16px 20px; border-bottom: 1px solid #e2e8f0; display: flex; align-items: center; justify-content: space-between; background-color: #f8fafc;">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="font-size: 18px;">📋</span>
                    <h3 style="margin: 0; font-size: 16px; font-weight: 700; color: #0f172a;">Ticket Info #${ticketId}</h3>
                </div>
                <button id="ct-modal-close-btn" style="background: none; border: none; font-size: 20px; cursor: pointer; color: #64748b; line-height: 1;">&times;</button>
            </div>
            
            <div style="padding: 12px 20px; background-color: #ffffff; border-bottom: 1px solid #f1f5f9;">
                <input type="text" id="ct-modal-search-input" placeholder="🔍 Search ticket fields (e.g. Subject, Customer, Status, Machine)..." 
                    style="width: 100%; padding: 8px 12px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 13px; outline: none; box-sizing: border-box;">
            </div>

            <div id="ct-modal-body" style="padding: 20px; overflow-y: auto; flex: 1;">
                <div style="text-align: center; padding: 40px 0; color: #64748b;">
                    <div style="display: inline-block; width: 24px; height: 24px; border: 3px solid #cbd5e1; border-top-color: #2563eb; border-radius: 50%; animation: ct-spin 0.8s linear infinite;"></div>
                    <p style="margin-top: 12px; font-size: 13px;">Loading ticket details...</p>
                </div>
            </div>

            <div style="padding: 14px 20px; border-top: 1px solid #e2e8f0; display: flex; align-items: center; justify-content: flex-end; gap: 10px; background-color: #f8fafc;">
                <button id="ct-modal-cancel-btn" style="padding: 8px 16px; background-color: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; border-radius: 6px; font-weight: 600; font-size: 13px; cursor: pointer;">Cancel</button>
                <button id="ct-modal-save-btn" style="padding: 8px 18px; background-color: #2563eb; color: #ffffff; border: none; border-radius: 6px; font-weight: 600; font-size: 13px; cursor: pointer; display: flex; align-items: center; gap: 6px;">
                    💾 Save Changes
                </button>
            </div>
            
            <style>
                @keyframes ct-spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
            </style>
        `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        document.getElementById('ct-modal-close-btn').onclick = () => overlay.remove();
        document.getElementById('ct-modal-cancel-btn').onclick = () => overlay.remove();

        // Fetch data from backend
        try {
            const resp = await fetch(`/api/method/vin_chakra.api.get_ticket_info?ticket_name=${encodeURIComponent(ticketId)}`, {
                headers: {
                    'X-Frappe-CSRF-Token': getCsrfToken()
                }
            });

            const data = await resp.json();
            if (data.message && data.message.status === "success") {
                renderModalFields(data.message);
            } else {
                const err = (data.message && data.message.message) || data.exception || "Failed to load ticket data";
                document.getElementById('ct-modal-body').innerHTML = `
                    <div style="padding: 20px; color: #ef4444; background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; font-size: 13px;">
                        ⚠️ Error: ${err}
                    </div>
                `;
            }
        } catch (e) {
            document.getElementById('ct-modal-body').innerHTML = `
                <div style="padding: 20px; color: #ef4444; background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; font-size: 13px;">
                    ⚠️ Error loading ticket info: ${e.message}
                </div>
            `;
        }
    }

    function renderModalFields(ticketData) {
        const doc = ticketData.doc || {};
        const fields = ticketData.fields || [];
        const optionsMap = ticketData.options || {};
        const bodyEl = document.getElementById('ct-modal-body');

        const coreFieldnames = ticketData.core_fields || ["subject", "status", "priority", "ticket_type", "agent_group", "raised_by", "customer"];

        const coreGroup = [];
        const templateGroup = [];

        fields.forEach(f => {
            if (coreFieldnames.includes(f.fieldname)) {
                coreGroup.push(f);
            } else {
                templateGroup.push(f);
            }
        });

        function createFieldHtml(f) {
            const val = doc[f.fieldname] !== undefined && doc[f.fieldname] !== null ? doc[f.fieldname] : '';
            const opts = optionsMap[f.fieldname] || [];
            const isReadOnly = f.read_only ? 'disabled' : '';

            let controlHtml = '';

            if (f.fieldtype === 'Select' || f.fieldtype === 'Link') {
                let optionsListHtml = `<option value="">-- Select ${f.label} --</option>`;
                let matchedVal = false;
                opts.forEach(opt => {
                    const isSelected = String(opt) === String(val) ? 'selected' : '';
                    if (isSelected) matchedVal = true;
                    optionsListHtml += `<option value="${escapeHtml(opt)}" ${isSelected}>${escapeHtml(opt)}</option>`;
                });
                if (val && !matchedVal) {
                    optionsListHtml += `<option value="${escapeHtml(val)}" selected>${escapeHtml(val)}</option>`;
                }

                controlHtml = `<select data-fieldname="${f.fieldname}" ${isReadOnly} style="width: 100%; padding: 7px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 13px; background-color: ${f.read_only ? '#f8fafc' : '#ffffff'}; box-sizing: border-box;">
                    ${optionsListHtml}
                </select>`;
            } else if (f.fieldtype === 'Date') {
                controlHtml = `<input type="date" data-fieldname="${f.fieldname}" value="${escapeHtml(val)}" ${isReadOnly} style="width: 100%; padding: 7px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 13px; background-color: ${f.read_only ? '#f8fafc' : '#ffffff'}; box-sizing: border-box;">`;
            } else if (f.fieldtype === 'Small Text' || f.fieldtype === 'Text' || f.fieldtype === 'Long Text') {
                controlHtml = `<textarea data-fieldname="${f.fieldname}" rows="2" ${isReadOnly} style="width: 100%; padding: 7px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 13px; background-color: ${f.read_only ? '#f8fafc' : '#ffffff'}; box-sizing: border-box; resize: vertical;">${escapeHtml(val)}</textarea>`;
            } else if (f.fieldtype === 'Check') {
                const isChecked = val ? 'checked' : '';
                controlHtml = `<div style="display: flex; align-items: center; gap: 8px; height: 34px;">
                    <input type="checkbox" data-fieldname="${f.fieldname}" ${isChecked} ${isReadOnly} style="width: 16px; height: 16px; cursor: pointer;">
                    <span style="font-size: 12px; color: #475569;">Enable / Yes</span>
                </div>`;
            } else {
                controlHtml = `<input type="text" data-fieldname="${f.fieldname}" value="${escapeHtml(val)}" ${isReadOnly} style="width: 100%; padding: 7px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 13px; background-color: ${f.read_only ? '#f8fafc' : '#ffffff'}; box-sizing: border-box;">`;
            }

            return `
                <div class="ct-modal-field-item" data-search="${escapeHtml((f.label + ' ' + f.fieldname).toLowerCase())}" style="display: flex; flex-direction: column; gap: 4px;">
                    <label style="font-size: 12px; font-weight: 600; color: #334155;">
                        ${escapeHtml(f.label)} ${f.reqd ? '<span style="color: #ef4444;">*</span>' : ''}
                    </label>
                    ${controlHtml}
                </div>
            `;
        }

        function createSectionHtml(title, icon, fieldList) {
            if (!fieldList.length) return '';
            const fieldsHtml = fieldList.map(createFieldHtml).join('');
            return `
                <div class="ct-modal-section" style="margin-bottom: 20px;">
                    <h4 style="margin: 0 0 12px 0; font-size: 14px; font-weight: 700; color: #1e293b; display: flex; align-items: center; gap: 6px; border-bottom: 2px solid #e2e8f0; padding-bottom: 6px;">
                        <span>${icon}</span> ${title}
                    </h4>
                    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 14px;">
                        ${fieldsHtml}
                    </div>
                </div>
            `;
        }

        bodyEl.innerHTML = `
            ${createSectionHtml('Core Ticket Fields', '📌', coreGroup)}
            ${createSectionHtml('Ticket Information (Template: Default)', '🛠️', templateGroup)}
        `;

        // Search live filter
        const searchInput = document.getElementById('ct-modal-search-input');
        if (searchInput) {
            searchInput.oninput = (e) => {
                const query = e.target.value.toLowerCase().trim();
                const fieldItems = bodyEl.querySelectorAll('.ct-modal-field-item');
                fieldItems.forEach(item => {
                    const searchData = item.getAttribute('data-search') || '';
                    if (!query || searchData.includes(query)) {
                        item.style.display = 'flex';
                    } else {
                        item.style.display = 'none';
                    }
                });
            };
        }

        // Save button handler
        const saveBtn = document.getElementById('ct-modal-save-btn');
        saveBtn.onclick = async () => {
            saveBtn.disabled = true;
            saveBtn.innerHTML = `⏳ Saving...`;
            saveBtn.style.opacity = '0.7';

            const updatedValues = {};
            const inputs = bodyEl.querySelectorAll('[data-fieldname]');
            inputs.forEach(input => {
                const fn = input.getAttribute('data-fieldname');
                if (!input.disabled) {
                    if (input.type === 'checkbox') {
                        updatedValues[fn] = input.checked ? 1 : 0;
                    } else {
                        updatedValues[fn] = input.value;
                    }
                }
            });

            try {
                const resp = await fetch('/api/method/vin_chakra.api.update_ticket_info', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Frappe-CSRF-Token': getCsrfToken()
                    },
                    body: JSON.stringify({
                        ticket_name: ticketData.ticket_name,
                        values: updatedValues
                    })
                });

                const res = await resp.json();
                if (res.message && res.message.status === "success") {
                    saveBtn.innerHTML = `✅ Saved!`;
                    saveBtn.style.backgroundColor = '#16a34a';

                    showToast('Ticket Info updated successfully! Reloading...');

                    setTimeout(() => {
                        window.location.reload();
                    }, 600);
                } else {
                    const err = (res.message && res.message.message) || res.exception || "Failed to update ticket";
                    alert(`Error: ${err}`);
                    saveBtn.disabled = false;
                    saveBtn.innerHTML = `💾 Save Changes`;
                    saveBtn.style.opacity = '1';
                }
            } catch (err) {
                alert(`Error saving changes: ${err.message}`);
                saveBtn.disabled = false;
                saveBtn.innerHTML = `💾 Save Changes`;
                saveBtn.style.opacity = '1';
            }
        };
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function showToast(msg) {
        const toast = document.createElement('div');
        toast.innerText = msg;
        Object.assign(toast.style, {
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            backgroundColor: '#15803d',
            color: '#ffffff',
            padding: '12px 20px',
            borderRadius: '8px',
            fontWeight: '600',
            fontSize: '13px',
            zIndex: '100001',
            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)'
        });
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }

    document.addEventListener("DOMContentLoaded", () => {
        setInterval(injectTicketInfoButton, 1000);
    });
})();
