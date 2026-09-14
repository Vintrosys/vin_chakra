frappe.ui.form.on('Item', {
  after_save(frm) {
    if (sessionStorage.getItem("tk_return_to_ticket_support") === "1") {
      sessionStorage.removeItem("tk_return_to_ticket_support");
      const targetJson = sessionStorage.getItem("tk_quick_entry_target");
      let target = null;
      if (targetJson) { try { target = JSON.parse(targetJson); } catch (e) {} }
      sessionStorage.setItem(
        "tk_created_doc",
        JSON.stringify({
          doctype: "Item",
          doc: frm.doc,
          target: target
        })
      );
      window.location.assign("/ticket-support");
    } else {
      localStorage.setItem('tk_new_doc_created', JSON.stringify({
        doctype: 'Item',
        name: frm.doc.name,
        item_name: frm.doc.item_name,
        brand: frm.doc.brand,
        custom_model_no: frm.doc.custom_model_no,
        ts: Date.now()
      }));
    }
  }
});