/**
 * js/login.js — magic-link sign-in flow (CSP-safe external script).
 *
 * Two modes:
 *   1. ?token=<magic> in the URL -> verify the token, set the session cookie,
 *      redirect to /workspace/ (or show the error).
 *   2. No token -> show the email form; POST /api/auth/request.
 */

(function () {
  "use strict";

  var form = document.getElementById("login-form");
  var emailInput = document.getElementById("email");
  var submitBtn = document.getElementById("login-submit");
  var errEl = document.getElementById("login-error");
  var okEl = document.getElementById("login-ok");
  var verifyState = document.getElementById("verify-state");
  var verifyMsg = document.getElementById("verify-msg");
  var verifyError = document.getElementById("verify-error");

  function showError(el, msg) {
    el.textContent = msg;
    el.hidden = false;
  }
  function hide(el) {
    el.hidden = true;
    el.textContent = "";
  }

  async function postJson(url, body) {
    var res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      credentials: "same-origin",
    });
    var data = null;
    try { data = await res.json(); } catch (e) { /* non-JSON */ }
    return { status: res.status, data: data };
  }

  // --- Mode 1: token in URL ---
  var params = new URLSearchParams(window.location.search);
  var token = params.get("token");
  if (token) {
    form.hidden = true;
    verifyState.hidden = false;
    verifyMsg.textContent = "Checking your sign-in link\u2026";
    postJson("/api/auth/verify", { token: token }).then(function (r) {
      if (r.status === 200 && r.data && r.data.ok) {
        verifyMsg.textContent = "Signed in. Taking you to your workspace\u2026";
        // Strip the single-use token from the URL, then go to the workspace.
        window.location.replace("/workspace/");
      } else if (r.status === 410) {
        verifyMsg.textContent = "";
        showError(verifyError, "That sign-in link has expired. Request a fresh one below.");
        form.hidden = false;
      } else if (r.status === 429) {
        verifyMsg.textContent = "";
        showError(verifyError, "Too many attempts. Please wait a little while and try again.");
        form.hidden = false;
      } else {
        verifyMsg.textContent = "";
        showError(verifyError, "That sign-in link isn\u2019t valid. Request a fresh one below.");
        form.hidden = false;
      }
    }).catch(function () {
      verifyMsg.textContent = "";
      showError(verifyError, "Something went wrong checking the link. Please try again.");
      form.hidden = false;
    });
    // Remove the token from the address bar so it isn't kept in history.
    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, "", "/login");
    }
    return;
  }

  // --- Mode 1b: ?setup=<token> -> set a password with no prior session ---
  var setupToken = params.get("setup");
  if (setupToken && !token) {
    form.hidden = true;
    if (document.getElementById("login-form-password"))
      document.getElementById("login-form-password").hidden = true;
    var setupState = document.getElementById("setup-state");
    var setupForm = document.getElementById("setup-form");
    var setupPass = document.getElementById("setup-password");
    var setupSubmit = document.getElementById("setup-submit");
    var setupErr = document.getElementById("setup-error");
    var setupMsg = document.getElementById("setup-msg");
    setupState.hidden = false;
    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, "", "/login");
    }
    setupForm.addEventListener("submit", function (ev) {
      ev.preventDefault();
      hide(setupErr);
      var password = setupPass.value || "";
      if (password.length < 8) {
        showError(setupErr, "Password must be at least 8 characters.");
        setupPass.focus();
        return;
      }
      setupSubmit.disabled = true;
      setupSubmit.textContent = "Setting password\u2026";
      postJson("/api/auth/set-password-token", { token: setupToken, password: password }).then(function (r) {
        setupSubmit.disabled = false;
        setupSubmit.textContent = "Set password & sign in";
        if (r.status === 200 && r.data && r.data.ok) {
          setupMsg.textContent = "Password set. Taking you to your workspace\u2026";
          window.location.replace("/workspace/");
        } else if (r.data && r.data.error === "invalid_token") {
          showError(setupErr, "This setup link is invalid, expired, or already used. Request a fresh one below.");
          setupState.hidden = true;
          form.hidden = false;
        } else if (r.data && r.data.error === "already_set") {
          showError(setupErr, "A password is already set for this account. Sign in with it, or use the Email link tab.");
          setupState.hidden = true;
          form.hidden = false;
        } else {
          showError(setupErr, "Something went wrong. Please try again.");
        }
      }).catch(function () {
        setupSubmit.disabled = false;
        setupSubmit.textContent = "Set password & sign in";
        showError(setupErr, "Couldn\u2019t reach the server. Check your connection and try again.");
      });
    });
    return;
  }

  // --- "Set up a password instead" link on the magic-link tab ---
  var setupLinkReq = document.getElementById("setup-link-request");
  if (setupLinkReq) {
    setupLinkReq.addEventListener("click", function (ev) {
      ev.preventDefault();
      hide(errEl);
      hide(okEl);
      var email = (emailInput.value || "").trim();
      if (!email || email.indexOf("@") < 0) {
        showError(errEl, "Enter your email address above first, then click the link.");
        emailInput.focus();
        return;
      }
      postJson("/api/auth/setup-link", { email: email }).then(function (r) {
        if (r.status === 200) {
          okEl.textContent = "If an account exists for that email, a password-setup link is on its way. Check your inbox (and spam folder).";
          okEl.hidden = false;
        } else if (r.status === 429) {
          showError(errEl, "Too many requests. Please wait a little while and try again.");
        } else {
          showError(errEl, "Something went wrong. Please try again, or email hello@freightfolio.net.");
        }
      }).catch(function () {
        showError(errEl, "Couldn\u2019t reach the server. Check your connection and try again.");
      });
    });
  }

  // --- Tab switching ---
  var tabPw = document.getElementById("tab-password");
  var tabMagic = document.getElementById("tab-magic");
  var pwForm = document.getElementById("login-form-password");
  var pwEmail = document.getElementById("pw-email");
  var pwPass = document.getElementById("pw-password");
  var pwSubmit = document.getElementById("pw-submit");
  var pwErr = document.getElementById("pw-error");

  function selectTab(which) {
    var isPw = which === "password";
    if (tabPw) tabPw.classList.toggle("active", isPw);
    if (tabMagic) tabMagic.classList.toggle("active", !isPw);
    if (pwForm) pwForm.hidden = !isPw;
    if (form) form.hidden = isPw;
    if (verifyState) verifyState.hidden = true;
  }
  // Attach handlers - use both addEventListener and onclick for maximum compatibility
  if (tabPw) {
    tabPw.addEventListener("click", function () { selectTab("password"); });
    tabPw.onclick = function () { selectTab("password"); };
  }
  if (tabMagic) {
    tabMagic.addEventListener("click", function () { selectTab("magic"); });
    tabMagic.onclick = function () { selectTab("magic"); };
  }
  // Expose globally for debugging
  window.ffSelectTab = selectTab;

  // --- Password login ---
  if (pwForm) {
    pwForm.addEventListener("submit", function (ev) {
      ev.preventDefault();
      hide(pwErr);
      var email = (pwEmail.value || "").trim();
      var password = pwPass.value || "";
      if (!email || email.indexOf("@") < 0) {
        showError(pwErr, "Please enter a valid email address.");
        pwEmail.focus();
        return;
      }
      if (!password) {
        showError(pwErr, "Please enter your password.");
        pwPass.focus();
        return;
      }
      pwSubmit.disabled = true;
      pwSubmit.textContent = "Signing in\u2026";
      postJson("/api/auth/login", { email: email, password: password }).then(function (r) {
        pwSubmit.disabled = false;
        pwSubmit.textContent = "Sign in";
        if (r.status === 200 && r.data && r.data.ok) {
          window.location.replace("/workspace/");
        } else if (r.status === 429) {
          showError(pwErr, "Too many attempts. Please wait a little while and try again.");
        } else if (r.data && r.data.error === "invalid_credentials") {
          showError(pwErr, "Invalid email or password. If you haven't set a password yet, switch to the Email link tab and use \u201CSet up a password instead\u201D.");
        } else {
          showError(pwErr, "Something went wrong. Please try again.");
        }
      }).catch(function () {
        pwSubmit.disabled = false;
        pwSubmit.textContent = "Sign in";
        showError(pwErr, "Couldn\u2019t reach the server. Check your connection and try again.");
      });
    });
  }

  // --- Mode 2: request a link ---
  form.addEventListener("submit", function (ev) {
    ev.preventDefault();
    hide(errEl);
    hide(okEl);
    var email = (emailInput.value || "").trim();
    if (!email || email.indexOf("@") < 0) {
      showError(errEl, "Please enter a valid email address.");
      emailInput.focus();
      return;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = "Sending\u2026";
    postJson("/api/auth/request", { email: email }).then(function (r) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Email me a sign-in link";
      if (r.status === 200) {
        okEl.textContent = "If an account exists for that email, a sign-in link is on its way. Check your inbox (and spam folder).";
        okEl.hidden = false;
      } else if (r.status === 429) {
        showError(errEl, "Too many requests. Please wait a little while and try again.");
      } else {
        showError(errEl, "Something went wrong. Please try again, or email hello@freightfolio.net.");
      }
    }).catch(function () {
      submitBtn.disabled = false;
      submitBtn.textContent = "Email me a sign-in link";
      showError(errEl, "Couldn\u2019t reach the server. Check your connection and try again.");
    });
  });
})();
