// Inject responsive CSS for the custom grid buttons
$(`<style>
	/* Hide inline history button on smaller screens to save space */
	@media (max-width: 1100px) {
		.btn-prev-quote {
			display: none !important;
		}
	}
	/* Ensure the actions container doesn't squash icons */
	.responsive-row-actions {
		display: flex !important;
		align-items: center !important;
		justify-content: flex-end !important;
		gap: 8px !important;
		min-width: 50px !important;
	}
</style>`).appendTo('head');

frappe.ui.form.on('Quotation', {
	refresh: function (frm) {
		// On form load, inject buttons for all existing rows that already have an item
		setTimeout(() => {
			(frm.doc.items || []).forEach(row => {
				if (row.item_code) {
					if (!row.__prev_quotes_fetched) {
						fetch_historical_data(frm, row.name);
					} else {
						inject_history_button_with_retry(frm, row.name, 0);
					}
				}
			});
		}, 400);
	},

	validate: function (frm) {
		let warnings = [];
		(frm.doc.items || []).forEach(row => {
			// Prioritize the actual custom field if it exists, fallback to API variable
			let min_rate = row.custom_minimum_bargaining_rate || row.__min_rate || 0;
			if (min_rate > 0 && row.rate < min_rate) {
				warnings.push(`Item <b>${row.item_code}</b> rate (${format_currency(row.rate, frm.doc.currency)}) is below minimum (${format_currency(min_rate, frm.doc.currency)}).`);
			}
		});
		if (warnings.length > 0) {
			frappe.msgprint({
				title: __('Minimum Rate Error'),
				indicator: 'red',
				message: __('Some items are quoted below their Minimum Bargaining Rate. You cannot save this Quotation.<br><br>' + warnings.join('<br>'))
			});
			frappe.validated = false; // Block the save action
		}
	}
});

frappe.ui.form.on('Quotation Item', {
	item_code: function (frm, cdt, cdn) {
		let row = locals[cdt][cdn];
		row.__prev_quotes_fetched = false;
		fetch_historical_data(frm, cdn);
	},

	rate: function (frm, cdt, cdn) {
		let row = locals[cdt][cdn];
		// Prioritize the actual custom field if it exists, fallback to API variable
		let min_rate = row.custom_minimum_bargaining_rate || row.__min_rate || 0;
		if (min_rate > 0 && row.rate < min_rate) {
			frappe.msgprint({
				title: __('Rate Warning'),
				indicator: 'orange',
				message: __('The entered rate <b>{0}</b> is below the Minimum Bargaining Rate <b>{1}</b> for item {2}.',
					[format_currency(row.rate, frm.doc.currency), format_currency(min_rate, frm.doc.currency), row.item_code])
			});
		}
	},

	form_render: function (frm, cdt, cdn) {
		// Inject the button into the Edit Form modal header
		let grid_row = get_grid_row(frm, cdn);
		if (!grid_row || !grid_row.grid_form) return;

		let $wrapper = grid_row.grid_form.wrapper;
		let $header = $wrapper.find('.grid-form-heading');
		
		// Create button if it doesn't exist
		if (!$header.find('.btn-form-prev-quote').length) {
			let row = frappe.get_doc(cdt, cdn);
			let history_exists = row.__prev_quotes && row.__prev_quotes.length > 0;
			let btn_color = history_exists ? 'orange' : '#6c757d';

			let $btn = $(`<button class="btn btn-xs btn-default btn-form-prev-quote" style="margin-left: 10px;">
				<i class="fa fa-history" style="color: ${btn_color};"></i> Previous Quotations
			</button>`);

			$btn.on('click', function () {
				let current_row = frappe.get_doc(cdt, cdn);
				if (current_row.__prev_quotes_fetched) {
					show_previous_quotations_dialog(frm, current_row);
				} else {
					frappe.show_alert({ message: 'Fetching history...', indicator: 'blue' });
					frappe.call({
						method: 'vin_chakra.utils.quotation.get_item_and_previous_quotations',
						args: {
							item_code: current_row.item_code,
							customer: frm.doc.party_name || null
						},
						callback: function (r) {
							if (r.message) {
								current_row.__prev_quotes = r.message.previous_quotations || [];
								current_row.__min_rate = r.message.minimum_bargaining_rate || 0;
								current_row.__prev_quotes_fetched = true;
								show_previous_quotations_dialog(frm, current_row);
							}
						}
					});
				}
			});

			// Append to the header actions
			$header.find('.text-right, .level-right').prepend($btn);
			// Fallback if header layout is different
			if (!$header.find('.btn-form-prev-quote').length) {
				$header.append($btn);
			}
		}
	}
});

// ─── API Fetch ────────────────────────────────────────────────────────────────

function fetch_historical_data(frm, cdn) {
	let row = frappe.get_doc('Quotation Item', cdn);
	if (!row || !row.item_code) return;

	frappe.call({
		method: 'vin_chakra.utils.quotation.get_item_and_previous_quotations',
		args: {
			item_code: row.item_code,
			customer: frm.doc.party_name || null
		},
		callback: function (r) {
			if (!r.message) return;

			row.__prev_quotes = r.message.previous_quotations || [];
			row.__min_rate = r.message.minimum_bargaining_rate || 0;
			row.__prev_quotes_fetched = true;

			// Fill the custom_minimum_bargaining_rate column in the grid if it exists
			if (frappe.meta.has_field('Quotation Item', 'custom_minimum_bargaining_rate')) {
				frappe.model.set_value(row.doctype, row.name, 'custom_minimum_bargaining_rate', row.__min_rate);
			}

			// Inject the history button — retry up to 5 times if DOM not ready yet
			inject_history_button_with_retry(frm, cdn, 0);
		}
	});
}

// ─── Button Injection ─────────────────────────────────────────────────────────

function inject_history_button_with_retry(frm, cdn, attempts) {
	let success = inject_history_button(frm, cdn);
	if (!success && attempts < 5) {
		setTimeout(() => inject_history_button_with_retry(frm, cdn, attempts + 1), 250);
	}
}

function get_grid_row(frm, cdn) {
	let grid = frm.fields_dict && frm.fields_dict.items && frm.fields_dict.items.grid;
	if (!grid) return null;

	// Frappe v14+ — direct dictionary lookup (fastest and most reliable)
	if (grid.grid_rows_by_docname && grid.grid_rows_by_docname[cdn]) {
		return grid.grid_rows_by_docname[cdn];
	}

	// Fallback for older versions — search the array
	return (grid.grid_rows || []).find(r => r.doc && r.doc.name === cdn) || null;
}

function inject_history_button(frm, cdn) {
	let row = frappe.get_doc('Quotation Item', cdn);
	if (!row) return false;

	let grid_row = get_grid_row(frm, cdn);
	if (!grid_row || !grid_row.row) return false;

	let $row_el = $(grid_row.row);

	// In newer Frappe versions, find the parent container of the edit (pencil) button
	let $actions = $row_el.find('.row-actions');
	if (!$actions.length) $actions = $row_el.find('.grid-row-actions');
	if (!$actions.length) $actions = $row_el.find('.btn-open-row').parent();

	if (!$actions.length) return false;

	// Make the actions area visible and use flexbox to align buttons nicely
	$actions.addClass('responsive-row-actions');
	$actions.css({
		'visibility': 'visible',
		'padding-right': '5px'
	});

	// Create button only once
	let $btn = $actions.find('.btn-prev-quote');
	if (!$btn.length) {
		$btn = $(`<a class="btn-prev-quote" 
			style="cursor:pointer; text-decoration:none; padding: 4px;" 
			title="Previous Quotations">
			<i class="fa fa-history" style="font-size:15px;"></i>
		</a>`);
		
		// Insert it right before the edit pencil if it exists, otherwise prepend
		let $pencil = $actions.find('.btn-open-row');
		if ($pencil.length) {
			$pencil.before($btn);
		} else {
			$actions.prepend($btn);
		}

		$btn.on('click', function (e) {
			e.stopPropagation();
			e.preventDefault();
			let current_row = frappe.get_doc('Quotation Item', cdn);
			if (!current_row) return;

			// If data already fetched, show dialog immediately
			if (current_row.__prev_quotes_fetched) {
				show_previous_quotations_dialog(frm, current_row);
				return;
			}

			// Otherwise, fetch on-demand and then show dialog
			frappe.show_alert({ message: 'Fetching history...', indicator: 'blue' });
			frappe.call({
				method: 'vin_chakra.utils.quotation.get_item_and_previous_quotations',
				args: {
					item_code: current_row.item_code,
					customer: frm.doc.party_name || null
				},
				callback: function (r) {
					if (r.message) {
						current_row.__prev_quotes = r.message.previous_quotations || [];
						current_row.__min_rate = r.message.minimum_bargaining_rate || 0;
						current_row.__prev_quotes_fetched = true;
						show_previous_quotations_dialog(frm, current_row);
					}
				}
			});
		});
	}

	// Show button only if history exists
	let $icon = $btn.find('i');
	if (row.__prev_quotes && row.__prev_quotes.length > 0) {
		$icon.css('color', '#ff9800'); // Orange = history found
		$btn.attr('title', `${row.__prev_quotes.length} Previous Quotation(s) — Click to view`);
		$btn.show();
	} else {
		$btn.hide();
	}

	return true;
}

// ─── Dialog ───────────────────────────────────────────────────────────────────

function show_previous_quotations_dialog(frm, row) {
	if (!row) {
		frappe.msgprint("Could not load row data.");
		return;
	}

	let html = `
		<table class="table table-bordered table-sm">
			<thead class="thead-dark">
				<tr>
					<th>Date</th>
					<th>Quotation ID</th>
					<th>Qty</th>
					<th>Rate</th>
					<th>Status</th>
				</tr>
			</thead>
			<tbody>
	`;

	if (!row.__prev_quotes || row.__prev_quotes.length === 0) {
		html += `<tr><td colspan="5" class="text-center text-muted" style="padding:12px;">
			No previous quotations found for this Customer and Item.
		</td></tr>`;
	} else {
		row.__prev_quotes.forEach(q => {
			let color = q.docstatus === 0 ? 'orange' : 'blue';
			html += `
				<tr>
					<td>${frappe.datetime.str_to_user(q.date)}</td>
					<td><a href="/app/quotation/${q.quotation_id}" target="_blank">${q.quotation_id}</a></td>
					<td>${q.qty}</td>
					<td><b>${format_currency(q.rate, frm.doc.currency)}</b></td>
					<td><span class="indicator-pill ${color}">${q.status}</span></td>
				</tr>
			`;
		});
	}

	html += `</tbody></table>`;

	let d = new frappe.ui.Dialog({
		title: `Previous Quotations — ${row.item_code}`,
		fields: [{ fieldtype: 'HTML', fieldname: 'history_html', options: html }],
		primary_action_label: 'Close',
		primary_action: function () { d.hide(); }
	});

	d.show();
}
