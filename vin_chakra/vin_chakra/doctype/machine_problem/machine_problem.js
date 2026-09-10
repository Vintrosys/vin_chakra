// Copyright (c) 2026, harrishragavan and contributors
// For license information, please see license.txt

frappe.ui.form.on('Machine Problem', {
  after_save(frm) {
    localStorage.setItem('tk_new_doc_created', JSON.stringify({
      doctype: 'Machine Problem',
      name: frm.doc.name,
      problem_name: frm.doc.problem_name,
      ts: Date.now()
    }));
  }
});