// Inject a "Back to Dashboard" button on the Helpdesk Ticket Portal pages
document.addEventListener("DOMContentLoaded", () => {
    function inject_back_button() {
        // Only inject if we are on a helpdesk ticket page
        if (window.location.pathname.startsWith('/helpdesk/tickets/')) {
            if (!document.getElementById('ct-back-dashboard-btn')) {
                let btn = document.createElement('button');
                btn.id = 'ct-back-dashboard-btn';
                btn.type = 'button';
                btn.innerHTML = '<i class="fa fa-arrow-left"></i> Back';
                
                btn.style.padding = '5px 10px';
                btn.style.backgroundColor = '#f1f5f9';
                btn.style.color = '#475569';
                btn.style.border = '1px solid #e2e8f0';
                btn.style.borderRadius = '6px';
                btn.style.cursor = 'pointer';
                btn.style.fontWeight = '500';
                btn.style.fontSize = '12px';
                btn.style.display = 'flex';
                btn.style.alignItems = 'center';
                btn.style.gap = '6px';
                btn.style.transition = 'all 0.2s ease-in-out';
                btn.style.height = '28px';
                
                btn.onmouseenter = () => { btn.style.backgroundColor = '#e2e8f0'; };
                btn.onmouseleave = () => { btn.style.backgroundColor = '#f1f5f9'; };
                
                btn.onclick = (e) => {
                    e.preventDefault();
                    let referrer = document.referrer;
                    if (referrer && referrer.includes('/app/')) {
                        window.location.href = referrer;
                    } else if (window.history.length > 1) {
                        window.history.back();
                    } else {
                        window.location.href = '/app';
                    }
                };
                
                let headerRight = document.querySelector('header .flex.gap-2.items-center') || document.querySelector('.flex.gap-2.items-center');
                if (headerRight) {
                    btn.style.position = 'static';
                    btn.style.boxShadow = 'none';
                    headerRight.insertBefore(btn, headerRight.firstChild);
                } else {
                    btn.style.position = 'fixed';
                    btn.style.top = '16px';
                    btn.style.right = '280px';
                    btn.style.zIndex = '9999';
                    btn.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
                    document.body.appendChild(btn);
                }
            }
        } else {
            let btn = document.getElementById('ct-back-dashboard-btn');
            if (btn) btn.remove();
        }
    }
    setInterval(inject_back_button, 1000);
});
