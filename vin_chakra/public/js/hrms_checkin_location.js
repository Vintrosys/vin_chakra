(function () {
	if (window._hrms_location_injected) return;
	window._hrms_location_injected = true;

	let currentLat = 0;
	let currentLng = 0;

	function getDeviceId() {
		let id = localStorage.getItem("hrms_device_id");
		if (!id) {
			const userAgent = navigator.userAgent || "";
			let platform = "Web";
			if (/android/i.test(userAgent)) platform = "Android";
			else if (/iphone|ipad|ipod/i.test(userAgent)) platform = "iOS";
			else if (/mac/i.test(userAgent)) platform = "Mac";
			else if (/win/i.test(userAgent)) platform = "Windows";
			else if (/linux/i.test(userAgent)) platform = "Linux";

			const randomStr = Math.random().toString(36).substring(2, 8).toUpperCase();
			id = `HRMS-${platform}-${randomStr}`;
			localStorage.setItem("hrms_device_id", id);
		}
		return id;
	}

	function updateGeoLocation() {
		if ("geolocation" in navigator) {
			navigator.geolocation.getCurrentPosition(
				function (pos) {
					currentLat = pos.coords.latitude;
					currentLng = pos.coords.longitude;
				},
				function () {
					navigator.geolocation.getCurrentPosition(
						function (pos) {
							currentLat = pos.coords.latitude;
							currentLng = pos.coords.longitude;
						},
						null,
						{ enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 }
					);
				},
				{ enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
			);
		}
	}

	updateGeoLocation();
	setInterval(updateGeoLocation, 20000);

	// Intercept fetch requests for Employee Checkin
	const originalFetch = window.fetch;
	window.fetch = async function (...args) {
		try {
			const url = args[0] || "";
			if (typeof url === "string" && (url.includes("frappe.client.insert") || url.includes("Employee%20Checkin"))) {
				let options = args[1];
				if (options && options.body) {
					let bodyData = typeof options.body === "string" ? JSON.parse(options.body) : options.body;
					if (bodyData && bodyData.doc && bodyData.doc.doctype === "Employee Checkin") {
						if (currentLat && currentLng) {
							bodyData.doc.latitude = bodyData.doc.latitude || currentLat;
							bodyData.doc.longitude = bodyData.doc.longitude || currentLng;
						}
						if (!bodyData.doc.device_id) {
							bodyData.doc.device_id = getDeviceId();
						}
						options.body = JSON.stringify(bodyData);
					}
				}
			}
		} catch (e) {
			console.warn("HRMS location intercept error:", e);
		}
		return originalFetch.apply(this, args);
	};
})();
