frappe.ui.form.on('Item', {
  after_save(frm) {
    localStorage.setItem('tk_new_doc_created', JSON.stringify({
      doctype: 'Item',
      name: frm.doc.name,
      item_name: frm.doc.item_name,
      brand: frm.doc.brand,
      custom_model_no: frm.doc.custom_model_no,
      ts: Date.now()
    }));
  }
});