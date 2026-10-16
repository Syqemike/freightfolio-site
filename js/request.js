/* Freightfolio - free preview request form.
   Posts JSON to /api/lead. Inline validation, honeypot stays silent. */
(function () {
  "use strict";

  var form = document.getElementById("leadForm");
  if (!form) return;

  /* Pre-select plan from ?plan= URL parameter (pricing page buttons). */
  /* Pre-fill from Reimagined ?business= ?industry= ?style= params. */
  try {
    var qs = new URLSearchParams(window.location.search);
    var planParam = qs.get("plan");
    var planSelect = document.getElementById("plan");
    if (planParam && planSelect) {
      var validPlans = ["starter", "professional", "business-growth"];
      if (validPlans.indexOf(planParam) !== -1) {
        planSelect.value = planParam;
      }
    }
    var bizParam = qs.get("business");
    var bizNameField = document.getElementById("business_name");
    if (bizParam && bizNameField && !bizNameField.value) {
      bizNameField.value = bizParam.slice(0, 60);
    }
    var industryParam = qs.get("industry");
    var industrySelect = document.getElementById("business_type");
    if (industryParam && industrySelect) {
      var industryMap = {
        restaurant: "Restaurant / Food",
        contractor: "Contractor / Trades",
        barber: "Barber / Salon",
        pet: "Pet services",
        automotive: "Automotive",
        professional: "Professional services",
        other: "Other"
      };
      if (industryMap[industryParam]) industrySelect.value = industryMap[industryParam];
    }
    var styleParam = qs.get("style");
    var commentsField = document.getElementById("comments");
    if (styleParam && commentsField && !commentsField.value) {
      commentsField.value = "Liked the " + styleParam + " style in the Design Lab.";
    }
  } catch (e) { /* URL parsing not supported; leave defaults */ }

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function setInvalid(name, message) {
    var field = form.querySelector('[data-field="' + name + '"]');
    if (!field) return;
    field.classList.add("invalid");
    var err = field.querySelector(".error");
    if (err) err.textContent = message;
  }

  function clearInvalid(name) {
    var field = form.querySelector('[data-field="' + name + '"]');
    if (field) field.classList.remove("invalid");
  }

  function val(name) {
    var el = form.elements[name];
    return el ? el.value.trim() : "";
  }

  function validate() {
    var ok = true;
    ["business_name", "your_name", "email", "business_type"].forEach(clearInvalid);

    if (!val("business_name")) { setInvalid("business_name", "Please enter your business name."); ok = false; }
    if (!val("your_name")) { setInvalid("your_name", "Please enter your name."); ok = false; }
    if (!EMAIL_RE.test(val("email"))) { setInvalid("email", "Please enter a valid email address."); ok = false; }
    if (!val("business_type")) { setInvalid("business_type", "Please choose a business type."); ok = false; }

    var phone = val("phone");
    if (phone && !/^[+()\-.\s\d]{7,}$/.test(phone)) {
      setInvalid("phone", "That phone number does not look right.");
      ok = false;
    }
    return ok;
  }

  ["business_name", "your_name", "email", "business_type", "phone"].forEach(function (n) {
    var el = form.elements[n];
    if (el) el.addEventListener("input", function () { clearInvalid(n); });
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!validate()) {
      var firstBad = form.querySelector(".field.invalid input, .field.invalid select");
      if (firstBad) firstBad.focus();
      return;
    }

    var submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = "Sending...";

    var features = [];
    form.querySelectorAll('input[name="features"]:checked').forEach(function (cb) {
      features.push(cb.value);
    });

    var payload = {
      business_name: val("business_name"),
      your_name: val("your_name"),
      email: val("email"),
      phone: val("phone"),
      current_website: val("current_website"),
      business_type: val("business_type"),
      plan: val("plan"),
      features: features,
      comments: val("comments"),
      website_url: val("website_url") /* honeypot; humans leave this empty */
    };

    fetch("/api/lead", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
      .then(function (res) { return res.json().catch(function () { return { ok: false }; }); })
      .then(function (data) {
        if (data && data.ok) {
          form.style.display = "none";
          document.getElementById("formSuccess").classList.add("show");
          window.scrollTo({ top: 0, behavior: "smooth" });
        } else {
          throw new Error((data && data.error) || "send-failed");
        }
      })
      .catch(function () {
        var note = document.getElementById("formError");
        note.style.display = "block";
        note.textContent = "Something went wrong sending your request. Please try again, or email us directly at hello@freightfolio.net.";
        submitBtn.disabled = false;
        submitBtn.textContent = "Request my free preview";
      });
  });
})();
