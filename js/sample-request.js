(function () {
  var form = document.getElementById("sample-request-form");
  if (!form) return;

  var success = document.getElementById("sr-success");
  var errorBox = document.getElementById("sr-error");
  var errorText = document.getElementById("sr-error-text");
  var submitBtn = document.getElementById("sr-submit");

  var FIELDS = [
    { id: "sr-name", name: "name", max: 100, required: true },
    { id: "sr-email", name: "email", max: 254, required: true, email: true },
    { id: "sr-company", name: "company", max: 120, required: false },
    { id: "sr-message", name: "message", max: 2000, required: true, minLen: 10 }
  ];
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // Attribute the lead to the page that sent them here (?src=...).
  try {
    var src = new URLSearchParams(window.location.search).get("src");
    if (src && /^[a-z0-9-]{1,40}$/.test(src)) {
      document.getElementById("sr-source").value = src;
    }
  } catch (e) {}

  function setError(field, msg) {
    var err = document.getElementById("err-" + field.id);
    if (msg) {
      err.textContent = msg;
      err.hidden = false;
      field.setAttribute("aria-invalid", "true");
    } else {
      err.hidden = true;
      err.textContent = "";
      field.removeAttribute("aria-invalid");
    }
  }

  function validateField(field) {
    var input = document.getElementById(field.id);
    var value = input.value.trim();
    if (field.required && !value) {
      setError(input, "This field is required.");
      return false;
    }
    if (value && field.email && !EMAIL_RE.test(value)) {
      setError(input, "Please enter a valid email address.");
      return false;
    }
    if (value && field.minLen && value.length < field.minLen) {
      setError(input, "Please write a little more (at least " + field.minLen + " characters).");
      return false;
    }
    if (value.length > field.max) {
      setError(input, "Please keep this under " + field.max + " characters.");
      return false;
    }
    setError(input, null);
    return true;
  }

  FIELDS.forEach(function (f) {
    var input = document.getElementById(f.id);
    input.addEventListener("blur", function () { validateField(f); });
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    errorBox.hidden = true;

    var valid = FIELDS.map(validateField).every(Boolean);
    if (!valid) {
      var firstBad = document.querySelector("#sample-request-form [aria-invalid]");
      if (firstBad) firstBad.focus();
      return;
    }

    var payload = {
      name: document.getElementById("sr-name").value.trim(),
      email: document.getElementById("sr-email").value.trim(),
      company: document.getElementById("sr-company").value.trim(),
      message: document.getElementById("sr-message").value.trim(),
      website: document.getElementById("sr-website").value,
      source: document.getElementById("sr-source").value
    };

    submitBtn.disabled = true;
    submitBtn.textContent = "Sending...";

    fetch("/api/sample-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
      .then(function (res) { return res.json().catch(function () { return {}; }); })
      .then(function (data) {
        if (data && data.ok) {
          form.hidden = true;
          success.hidden = false;
          success.scrollIntoView({ behavior: "smooth", block: "start" });
          if (window.gtag) gtag("event", "sample_request_success", { event_category: "lead" });
        } else {
          var msg = (data && data.message) ||
            (data && data.error === "service_not_configured"
              ? "Our request form is not configured yet. Please email hello@freightfolio.net directly and we will take it from there."
              : null) ||
            "We could not submit your request. Please email hello@freightfolio.net directly and we will take it from there.";
          errorText.innerHTML = "";
          errorText.appendChild(document.createTextNode(msg.split("hello@freightfolio.net")[0]));
          var a = document.createElement("a");
          a.href = "mailto:hello@freightfolio.net";
          a.textContent = "hello@freightfolio.net";
          errorText.appendChild(a);
          errorText.appendChild(document.createTextNode(msg.split("hello@freightfolio.net")[1] || ""));
          errorBox.hidden = false;
          submitBtn.disabled = false;
          submitBtn.textContent = "Request my free sample";
        }
      })
      .catch(function () {
        errorBox.hidden = false;
        submitBtn.disabled = false;
        submitBtn.textContent = "Request my free sample";
      });
  });
})();
