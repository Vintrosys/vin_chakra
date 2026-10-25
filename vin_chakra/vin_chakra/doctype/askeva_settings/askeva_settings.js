frappe.ui.form.on('AskEva Settings', {
	refresh: function(frm) {
		frm.trigger('toggle_mode_fields');

		frm.add_custom_button(__('Sync Templates from AskEva'), function() {
			frappe.call({
				method: 'vin_chakra.whatsapp_api.get_askeva_templates',
				freeze: true,
				freeze_message: __('Connecting to AskEva API...'),
				callback: function(r) {
					if (r.message && r.message.status === 'success') {
						const templates = r.message.templates || [];
						if (!templates.length) {
							frappe.msgprint({
								title: __('AskEva Templates'),
								indicator: 'orange',
								message: __('Connected to AskEva successfully, but no templates were found in your AskEva WhatsApp account. You can create templates in the AskEva dashboard.')
							});
							return;
						}

						let rowsHtml = templates.map(t => {
							const isApproved = t.status === 'APPROVED';
							let statusBadge = isApproved
								? '<span class="badge badge-success" style="background:#15803d; color:#fff; padding:2px 8px; border-radius:10px;">APPROVED</span>'
								: `<span class="badge badge-danger" style="background:#dc2626; color:#fff; padding:2px 8px; border-radius:10px;">${t.status}</span>`;

							let details = '';
							if (t.rejected_reason && t.rejected_reason !== 'NONE') {
								details = `<div style="font-size:11px; color:#b91c1c; margin-top:2px;">Reason: <strong>${t.rejected_reason}</strong>${t.rejected_reason === 'INVALID_FORMAT' ? ' (Use {{1}}, {{2}} in Meta template body, not {name})' : ''}</div>`;
							}

							return `
								<tr style="border-bottom:1px solid #f1f5f9; ${!isApproved ? 'background:#fef2f2;' : ''}">
									<td style="padding:10px 8px; font-weight:600; color:#1e293b;">
										${t.name}
										${details}
									</td>
									<td style="padding:10px 8px; color:#475569;">${t.language}</td>
									<td style="padding:10px 8px; color:#475569;">${t.category || '-'}</td>
									<td style="padding:10px 8px;">${statusBadge}</td>
									<td style="padding:10px 8px; color:#475569; font-size:12px;">${t.param_count} param(s)</td>
									<td style="padding:10px 8px; text-align:right;">
										<button class="btn btn-xs ${isApproved ? 'btn-primary' : 'btn-default'} select-tpl-btn" data-name="${t.name}" data-lang="${t.language}" data-status="${t.status}">
											${isApproved ? __('Use Template') : __('Not Approved')}
										</button>
									</td>
								</tr>
							`;
						}).join('');

						const d = new frappe.ui.Dialog({
							title: __('AskEva WhatsApp Templates ({0})', [templates.length]),
							size: 'large',
							fields: [
								{
									fieldtype: 'HTML',
									fieldname: 'template_list_html',
									options: `
										<div style="max-height:360px; overflow-y:auto;">
											<table class="table table-bordered table-sm" style="width:100%; margin:0; font-size:13px;">
												<thead style="background:#f8fafc;">
													<tr>
														<th style="padding:8px;">${__('Template Name')}</th>
														<th style="padding:8px;">${__('Language')}</th>
														<th style="padding:8px;">${__('Category')}</th>
														<th style="padding:8px;">${__('Status')}</th>
														<th style="padding:8px;">${__('Parameters')}</th>
														<th style="padding:8px; text-align:right;">${__('Action')}</th>
													</tr>
												</thead>
												<tbody>
													${rowsHtml}
												</tbody>
											</table>
										</div>
									`
								}
							]
						});

						d.$wrapper.on('click', '.select-tpl-btn', function() {
							const tplStatus = $(this).data('status');
							const tplName = $(this).data('name');
							const tplLang = $(this).data('lang');

							if (tplStatus !== 'APPROVED') {
								frappe.msgprint({
									title: __('Template Not Approved'),
									indicator: 'red',
									message: __('Template "{0}" cannot be selected because its Meta status is <strong>{1}</strong>. Only <strong>APPROVED</strong> templates can be used to send WhatsApp messages.', [tplName, tplStatus])
								});
								return;
							}

							frm.set_value('invoice_send_mode', 'Template Message');
							frm.set_value('invoice_template_name', tplName);
							if (tplLang) {
								frm.set_value('invoice_template_language', tplLang);
							}
							d.hide();
							frappe.show_alert({
								message: __('Template "{0}" selected.', [tplName]),
								indicator: 'green'
							});
						});

						d.show();
					} else {
						frappe.msgprint({
							title: __('AskEva Connection Error'),
							indicator: 'red',
							message: r.message ? r.message.message : __('Failed to communicate with AskEva.')
						});
					}
				}
			});
		}, __('AskEva'));
	},

	invoice_send_mode: function(frm) {
		frm.trigger('toggle_mode_fields');
	},

	toggle_mode_fields: function(frm) {
		const isTemplate = frm.doc.invoice_send_mode === 'Template Message';
		frm.toggle_display(['invoice_template_name', 'invoice_template_language', 'invoice_template_params'], isTemplate);
		frm.toggle_display('invoice_message_template', !isTemplate);
		// "Attach Invoice PDF" applies to both modes (as a document in Direct Text mode).
		frm.toggle_display('include_pdf_link', true);
	}
});
