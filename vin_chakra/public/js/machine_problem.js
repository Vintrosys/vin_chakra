frappe.ui.form.on('Machine Problem', {
  after_save(frm) {
    if (sessionStorage.getItem("tk_return_to_ticket_support") === "1") {
      sessionStorage.removeItem("tk_return_to_ticket_support");
      const targetJson = sessionStorage.getItem("tk_quick_entry_target");
      let target = null;
      if (targetJson) { try { target = JSON.parse(targetJson); } catch (e) {} }
      sessionStorage.setItem(
        "tk_created_doc",
        JSON.stringify({
          doctype: "Machine Problem",
          doc: frm.doc,
          target: target
        })
      );
      window.location.assign("/ticket-support");
    } else {
      localStorage.setItem('tk_new_doc_created', JSON.stringify({
        doctype: 'Machine Problem',
        name: frm.doc.name,
        problem_name: frm.doc.machine_problem || frm.doc.problem_name || frm.doc.name,
        ts: Date.now()
      }));
    }
  }
});
