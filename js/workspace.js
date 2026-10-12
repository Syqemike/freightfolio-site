/**
 * js/workspace.js — customer workspace app (CSP-safe external script).
 *
 * Loads /api/me on boot (401 -> sign-in prompt). Tabs: Overview, Uploads,
 * History, Issues, Reports, Account. Uploads reuse /api/upload-init and
 * /api/upload-complete with session-cookie auth (no token needed).
 */

(function () {
  "use strict";

  var state = { me: null, orderId: null, remaining: 0 };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmtDate(iso) {
    if (!iso) return "\u2014";
    try { return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); }
    catch (e) { return iso; }
  }
  function fmtSize(bytes) {
    if (!bytes && bytes !== 0) return "\u2014";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1048576).toFixed(1) + " MB";
  }
  function statusBadge(status) {
    var label = { received: "Received", processing: "Processing", needs_attention: "Needs attention",
      completed: "Completed", delivered: "Delivered", paid: "Paid", uploading: "Uploading",
      active: "Active", trialing: "Trial", past_due: "Past due", canceled: "Canceled" }[status] || status;
    return '<span class="badge badge-' + esc(status) + '">' + esc(label) + "</span>";
  }
  function api(path, opts) {
    opts = opts || {};
    opts.credentials = "same-origin";
    if (opts.body && !opts.headers) opts.headers = { "content-type": "application/json" };
    return fetch(path, opts).then(function (r) {
      return r.json().then(function (j) { return { status: r.status, body: j }; })
        .catch(function () { return { status: r.status, body: null }; });
    });
  }

  /* ---------- boot ---------- */
  function boot() {
    wireTabs();
    wireSignout();
    wireUploads();
    wireHistory();
    wireAccount();
    wirePlans();
    api("/api/me").then(function (r) {
      if (r.status === 401 || (r.body && !r.body.ok)) { showError(r); return; }
      state.me = r.body;
      state.orderId = r.body.current_order ? r.body.current_order.order_id : null;
      state.remaining = r.body.current_order ? r.body.current_order.remaining : 0;
      $("ws-loading").hidden = true;
      $("ws-app").hidden = false;
      renderAll();
    }).catch(function () { showError(null); });
  }

  function showError(r) {
    $("ws-loading").hidden = true;
    $("ws-error").hidden = false;
    if (r && r.status === 503) {
      $("ws-error-msg").textContent = "Workspace sign-in isn't configured yet. Please try again shortly.";
    } else if (r && r.status === 404 && r.body && r.body.role === "admin") {
      // Site administrator signed in: the admin panel is their home.
      window.location.replace("/admin");
      return;
    } else if (r && (r.status === 404 || (r.body && r.body.error === "no_customer"))) {
      $("ws-error-msg").textContent = "We couldn't find any orders for this email address. If you paid with a different email, sign out and sign in with that one — or email hello@freightfolio.net and we'll sort it out.";
    }
  }

  function wireSignout() {
    $("signout-btn").addEventListener("click", function () {
      api("/api/auth/logout", { method: "POST" }).then(function () {
        window.location.href = "/login";
      }).catch(function () { window.location.href = "/login"; });
    });
  }

  /* ---------- tabs (with arrow-key nav) ---------- */
  var tabIds = ["overview", "uploads", "history", "issues", "reports", "account", "recovery"];
  function wireTabs() {
    var tabs = tabIds.map(function (id) { return $("tab-" + id); });
    tabs.forEach(function (tab, i) {
      tab.addEventListener("click", function () { selectTab(i); });
      tab.addEventListener("keydown", function (e) {
        var j = null;
        if (e.key === "ArrowRight") j = (i + 1) % tabs.length;
        else if (e.key === "ArrowLeft") j = (i - 1 + tabs.length) % tabs.length;
        else if (e.key === "Home") j = 0;
        else if (e.key === "End") j = tabs.length - 1;
        if (j !== null) { e.preventDefault(); selectTab(j); tabs[j].focus(); }
      });
    });
    document.querySelectorAll("[data-goto-tab]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var i = tabIds.indexOf(btn.getAttribute("data-goto-tab"));
        if (i >= 0) { selectTab(i); $("tab-" + tabIds[i]).focus(); }
      });
    });
  }
  function selectTab(i) {
    tabIds.forEach(function (id, j) {
      var tab = $("tab-" + id), panel = $("panel-" + id);
      var on = i === j;
      tab.setAttribute("aria-selected", on ? "true" : "false");
      tab.tabIndex = on ? 0 : -1;
      panel.classList.toggle("active", on);
      panel.hidden = !on;
      if (on) {
        if (id === "history") loadHistory();
        if (id === "issues") loadIssues();
        if (id === "reports") loadReports();
        if (id === "account") loadAccount();
        if (id === "recovery") renderRecovery();
      }
    });
  }

  /* ---------- overview ---------- */
  function renderAll() {
    var me = state.me;
    $("ws-user").textContent = me.email || "";
    var ent = me.entitlement;
    var planName = ent ? ent.plan_name : "No plan";
    $("ws-plan-line").textContent = planName + (ent && ent.kind === "subscription"
      ? " \u00b7 renews " + fmtDate(ent.current_period_end)
      : "");

    var stats = [
      { v: me.current_order ? me.current_order.remaining : 0, l: "Documents remaining" },
      { v: me.stats.awaiting_processing, l: "Awaiting processing", alert: me.stats.awaiting_processing > 0 },
      { v: me.stats.completed_reports, l: "Reports ready" },
      { v: me.stats.open_issues, l: "Open issues", alert: me.stats.open_issues > 0 },
    ];
    $("overview-stats").innerHTML = stats.map(function (s) {
      return '<div class="stat-card' + (s.alert ? " alert" : "") + '"><div class="stat-value">' +
        esc(s.v) + '</div><div class="stat-label">' + esc(s.l) + "</div></div>";
    }).join("");

    if (me.current_order) {
      var used = me.current_order.used, allow = me.current_order.allowance;
      var pct = allow > 0 ? Math.round((used / allow) * 100) : 0;
      $("allowance-text").textContent = used + " of " + allow + " documents used this " +
        (me.current_order.kind === "pilot" ? "pilot" : "billing period") + ".";
      var bar = $("allowance-bar");
      bar.setAttribute("aria-valuenow", String(pct));
      bar.firstElementChild.style.width = Math.min(100, pct) + "%";
    } else {
      $("allowance-text").textContent = "No active upload allowance right now.";
    }

    var recent = [];
    (me.orders || []).forEach(function (o) {
      (o.files || []).slice(-3).forEach(function (f) {
        recent.push({ name: f.filename, at: f.received_at, order: o.order_id, status: o.status });
      });
    });
    recent.sort(function (a, b) { return a.at < b.at ? 1 : -1; });
    recent = recent.slice(0, 5);
    $("overview-recent").innerHTML = recent.length
      ? '<div class="table-wrap"><table class="data-table"><thead><tr><th>File</th><th>Received</th><th>Status</th></tr></thead><tbody>' +
        recent.map(function (r) {
          return "<tr><td>" + esc(r.name) + "</td><td>" + esc(fmtDate(r.at)) + "</td><td>" + statusBadge(r.status) + "</td></tr>";
        }).join("") + "</tbody></table></div>"
      : '<p class="muted">Nothing uploaded yet. Your recent uploads will show up here.</p>';

    var issuesN = me.stats.open_issues;
    $("issues-count").textContent = issuesN > 0 ? "(" + issuesN + ")" : "";
    updateAllowanceLine();
  }
  /* ---------- uploads ---------- */
  var MAX_BYTES = 25 * 1024 * 1024;
  var queue = [];
  var uploading = false;

  function wireUploads() {
    var dz = $("dropzone"), fi = $("file-input");
    dz.addEventListener("click", function () { fi.click(); });
    dz.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fi.click(); }
    });
    ["dragenter", "dragover"].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add("dragover"); });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove("dragover"); });
    });
    dz.addEventListener("drop", function (e) { addFiles(e.dataTransfer.files); });
    fi.addEventListener("change", function () { addFiles(fi.files); fi.value = ""; });
  }

  function detectType(buf) {
    var b = new Uint8Array(buf);
    if (b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46)
      return { mime: "application/pdf", ext: "pdf" };
    if (b.length >= 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF)
      return { mime: "image/jpeg", ext: "jpg" };
    if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47)
      return { mime: "image/png", ext: "png" };
    return null;
  }

  function addFiles(files) {
    if (!state.orderId) {
      renderQueueNote("No open upload batch right now. If you have an active plan, try reloading the page.");
      return;
    }
    var canUnzip = typeof window.FFZip !== "undefined";
    Array.prototype.slice.call(files).forEach(function (f) {
      if (canUnzip && FFZip.isZipName(f.name)) enqueueZip(f);
      else enqueueFile(f);
    });
    renderQueue();
  }

  function removeItem(item) {
    var i = queue.indexOf(item);
    if (i >= 0) queue.splice(i, 1);
  }

  function enqueueZip(f) {
    var item = { file: f, state: "extracting", progress: 0, error: "", sha256: "", putUrl: "", key: "", contentType: "" };
    if (f.size > MAX_BYTES) {
      item.state = "invalid";
      item.error = "That ZIP is over 25 MB \u2014 split it and try again.";
      queue.push(item);
      renderQueue();
      return;
    }
    queue.push(item);
    renderQueue();
    FFZip.unzipDocuments(f).then(function (docs) {
      removeItem(item);
      docs.forEach(function (d) {
        var file;
        try {
          file = new File([d.blob], d.name, { type: d.blob.type });
        } catch (e) {
          file = d.blob; // very old browsers
          try { file.name = d.name; } catch (ignored) {}
        }
        enqueueFile(file);
      });
      renderQueue();
      maybeStart();
    }).catch(function (err) {
      item.state = "invalid";
      item.error = (err && err.message) || "Couldn\u2019t open that ZIP file.";
      renderQueue();
      maybeStart();
    });
  }

  function enqueueFile(f) {
    var item = { file: f, state: "checking", progress: 0, error: "", sha256: "", putUrl: "", key: "", contentType: "" };
    queue.push(item);
    var reader = new FileReader();
    reader.onload = function () {
      var detected = detectType(reader.result);
      if (f.size > MAX_BYTES) {
        item.state = "invalid";
        item.error = "Over 25 MB \u2014 shrink it or split it and try again.";
      } else if (!detected) {
        item.state = "invalid";
        item.error = "Doesn\u2019t look like a PDF, JPG, or PNG. Renamed files are rejected.";
      } else {
        item.state = "ready";
        item.detected = detected;
      }
      renderQueue();
      maybeStart();
    };
    reader.onerror = function () {
      item.state = "invalid"; item.error = "Couldn\u2019t read this file."; renderQueue(); maybeStart();
    };
    reader.readAsArrayBuffer(f.slice(0, 8));
  }

  function sha256Hex(buf) {
    return crypto.subtle.digest("SHA-256", buf).then(function (d) {
      return Array.prototype.map.call(new Uint8Array(d), function (b) {
        return ("0" + b.toString(16)).slice(-2);
      }).join("");
    });
  }

  function renderQueueNote(msg) {
    $("queue").innerHTML = '<p class="form-error" role="alert">' + esc(msg) + "</p>";
  }

  function renderQueue() {
    var q = $("queue");
    if (!queue.length) { q.innerHTML = ""; return; }
    q.innerHTML = queue.map(function (it, i) {
      var status = "";
      if (it.state === "checking") status = '<div class="qstatus">Checking file type\u2026</div>';
      else if (it.state === "extracting") status = '<div class="qstatus">Extracting archive\u2026</div>';
      else if (it.state === "ready") status = '<div class="qstatus">Ready</div>';
      else if (it.state === "hashing") status = '<div class="qstatus">Preparing\u2026</div>';
      else if (it.state === "uploading") status = '<div class="qstatus">Uploading \u2014 ' + it.progress + '%</div>';
      else if (it.state === "done") status = '<div class="qstatus ok">Uploaded \u2713</div>';
      else if (it.state === "error" || it.state === "invalid") status = '<div class="qstatus err">' + esc(it.error || "Rejected") + "</div>";
      return '<div class="queue-item"><div class="qname">' + esc(it.file.name) + '</div>' +
        '<div class="qmeta">' + esc(fmtSize(it.file.size)) + "</div>" +
        (it.state === "uploading" ? '<div class="qbar"><span style="width:' + it.progress + '%"></span></div>' : "") +
        status + "</div>";
    }).join("");
  }

  function maybeStart() {
    if (uploading) return;
    if (!queue.some(function (it) { return it.state === "ready"; })) return;
    startUpload();
  }

  function putWithProgress(url, file, contentType, onProgress) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open("PUT", url, true);
      xhr.setRequestHeader("Content-Type", contentType);
      xhr.upload.onprogress = function (e) {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error("Upload failed (HTTP " + xhr.status + ")."));
      };
      xhr.onerror = function () { reject(new Error("Network error during upload.")); };
      xhr.send(file);
    });
  }

  // Uploads go through POST /api/upload-direct (same origin). The Function
  // validates the file and stores it in B2 via the native API, so the
  // browser never talks to B2 directly (no CORS / S3-endpoint issues).
  function postFileDirect(it, onProgress) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/upload-direct", true);
      xhr.upload.onprogress = function (e) {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = function () {
        var body = null;
        try { body = JSON.parse(xhr.responseText); } catch (e) { /* fall through */ }
        if (xhr.status >= 200 && xhr.status < 300 && body && body.ok) { resolve(body); return; }
        var err = (body && body.error) || ("http_" + xhr.status);
        reject(new Error(err === "unauthorized" || xhr.status === 401 ? "signed_out" : friendlyUploadError(err)));
      };
      xhr.onerror = function () { reject(new Error("Network error during upload.")); };
      var fd = new FormData();
      fd.append("order_id", state.orderId);
      fd.append("file", it.file, it.file.name || "file");
      xhr.send(fd);
    });
  }

  function friendlyUploadError(err) {
    switch (err) {
      case "duplicate_content": return "This exact file was already uploaded.";
      case "too_large": return "Over 25 MB \u2014 shrink it or split it and try again.";
      case "bad_file_type": return "Doesn\u2019t look like a PDF, JPG, or PNG. Renamed files are rejected.";
      case "allowance_exhausted": return "You\u2019ve used your full document allowance for this period.";
      case "storage_error": return "Our storage hiccuped \u2014 please retry in a moment.";
      default: return "The server refused the upload (" + err + ").";
    }
  }

  function startUpload() {
    uploading = true;
    var items = queue.filter(function (q) { return q.state === "ready"; });
    items.forEach(function (it) { it.state = "uploading"; it.error = ""; it.progress = 0; });
    renderQueue();
    updateAllowanceLine();

    var signedOut = false;
    var chain = Promise.resolve();
    items.forEach(function (it) {
      chain = chain.then(function () {
        if (signedOut) return;
        return postFileDirect(it, function (p) { it.progress = p; renderQueue(); })
          .then(function () { it.state = "done"; it.progress = 100; renderQueue(); })
          .catch(function (e) {
            if (e.message === "signed_out") { signedOut = true; throw e; }
            it.state = "error";
            it.error = e.message + " You can re-add the file to retry.";
            renderQueue();
          });
      });
    });

    chain.then(function () {
      uploading = false;
      if (signedOut) { showError({ status: 401 }); return; }
      var done = items.filter(function (it) { return it.state === "done"; });
      queue = queue.filter(function (it) { return it.state !== "done"; });
      renderQueue();
      if (!done.length) { maybeStart(); return; }
      // Refresh allowance + overview.
      return api("/api/me").then(function (r2) {
        if (r2.body && r2.body.ok) {
          state.me = r2.body;
          state.remaining = r2.body.current_order ? r2.body.current_order.remaining : 0;
          renderAll();
          updateAllowanceLine();
        }
        var note = document.createElement("p");
        note.className = "form-ok";
        note.setAttribute("role", "status");
        note.textContent = "Received \u2014 " + done.length + " document" + (done.length > 1 ? "s" : "") +
          " confirmed. We\u2019ll email you when processing is done.";
        $("queue").prepend(note);
      }).then(function () {
        // Files that became ready while this batch was uploading go next.
        maybeStart();
      });
    }).catch(function () {
      uploading = false;
      if (signedOut) { showError({ status: 401 }); return; }
      maybeStart();
    });
  }

  function updateAllowanceLine() {
    var me = state.me;
    if (!me || !me.current_order) return;
    var line = me.current_order.remaining + " of " + me.current_order.allowance + " documents remaining" +
      (me.current_order.kind === "pilot" ? " in your pilot" : " this billing period") + ".";
    $("upload-allowance-line").textContent = line;
    $("upload-remaining").textContent = me.current_order.remaining + " left.";
  }
  /* ---------- history ---------- */
  function wireHistory() {
    var t;
    $("hist-q").addEventListener("input", function () {
      clearTimeout(t); t = setTimeout(loadHistory, 250);
    });
    $("hist-status").addEventListener("change", loadHistory);
    $("hist-order").addEventListener("change", loadHistory);
  }

  function loadHistory() {
    var me = state.me;
    if (!me) return;
    var sel = $("hist-order");
    if (!sel.options.length || sel.options.length <= 1) {
      (me.orders || []).forEach(function (o) {
        var opt = document.createElement("option");
        opt.value = o.order_id;
        opt.textContent = o.order_id + (o.plan ? " \u00b7 " + o.plan : "");
        sel.appendChild(opt);
      });
    }
    var qs = "limit=200&q=" + encodeURIComponent($("hist-q").value || "") +
      "&status=" + encodeURIComponent($("hist-status").value) +
      (sel.value ? "&order_id=" + encodeURIComponent(sel.value) : "");
    api("/api/files?" + qs).then(function (r) {
      var files = (r.body && r.body.files) || [];
      var tb = $("hist-table").querySelector("tbody");
      tb.innerHTML = files.map(function (f) {
        return "<tr><td>" + esc(f.filename) + "</td><td class='small'>" + esc(f.order_id) + "</td><td>" +
          esc(fmtDate(f.received_at)) + "</td><td>" + esc(fmtSize(f.size_bytes)) + "</td><td>" +
          statusBadge(f.status) + "</td></tr>";
      }).join("");
      $("hist-empty").hidden = files.length > 0;
      $("hist-table").style.display = files.length ? "" : "none";
    });
  }

  /* ---------- issues ---------- */
  function loadIssues() {
    api("/api/issues").then(function (r) {
      var issues = (r.body && r.body.issues) || [];
      $("issues-empty").hidden = issues.length > 0;
      $("issues-list").innerHTML = issues.map(function (i) {
        return '<div class="issue sev-' + esc(i.severity) + '">' +
          "<h3>" + esc(issueTitle(i)) + " " + statusBadge(i.severity) + "</h3>" +
          "<p>" + esc(i.message) + "</p>" +
          (i.load ? '<p class="small muted">Affected load: ' + esc(i.load) + "</p>" : "") +
          (i.recommendation ? '<div class="rec"><strong>Recommended next step:</strong> ' + esc(i.recommendation) + "</div>" : "") +
          '<p class="small muted">Batch ' + esc(i.order_id) + " \u00b7 flagged " + esc(fmtDate(i.created_at)) + "</p>" +
          '<p><button class="btn btn-sm" type="button" data-goto-tab="uploads">Upload more documents</button></p>' +
          "</div>";
      }).join("");
      // wire the freshly rendered buttons
      $("issues-list").querySelectorAll("[data-goto-tab]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var i = tabIds.indexOf("uploads"); selectTab(i); $("tab-uploads").focus();
        });
      });
    });
  }
  function issueTitle(i) {
    return { missing_document: "Missing document", discrepancy: "Discrepancy found",
      unreadable: "Unreadable document", unsigned: "Unsigned document",
      conflicting: "Conflicting documents", note: "Note from our team" }[i.type] || "Issue";
  }

  /* ---------- reports ---------- */
  function loadReports() {
    api("/api/reports").then(function (r) {
      var reports = (r.body && r.body.reports) || [];
      $("reports-empty").hidden = reports.length > 0;
      $("reports-list").innerHTML = reports.map(function (rep) {
        var href = "/api/reports/download?order_id=" + encodeURIComponent(rep.order_id) +
          "&file=" + encodeURIComponent(rep.name);
        return '<div class="report-row"><div><div class="rname">' + esc(rep.name) + "</div>" +
          '<div class="rmeta">Batch ' + esc(rep.order_id) + " \u00b7 completed " + esc(fmtDate(rep.completed_at)) +
          (rep.size_bytes ? " \u00b7 " + esc(fmtSize(rep.size_bytes)) : "") + "</div></div>" +
          '<div class="rspacer"></div>' +
          '<a class="btn btn-sm btn-amber" href="' + esc(href) + '">Download</a></div>';
      }).join("");
    });
  }

  /* ---------- account ---------- */
  function wireAccount() {
    $("delete-request-btn").addEventListener("click", function () {
      var btn = $("delete-request-btn");
      $("delete-ok").hidden = true; $("delete-error").hidden = true;
      btn.disabled = true;
      api("/api/account/delete-request", {
        method: "POST",
        body: JSON.stringify({ detail: $("delete-note").value || "" }),
      }).then(function (r) {
        btn.disabled = false;
        if (r.body && r.body.ok) {
          $("delete-ok").textContent = "Request sent. We\u2019ll remove your files and records by hand and confirm by email.";
          $("delete-ok").hidden = false;
          $("delete-note").value = "";
        } else {
          $("delete-error").textContent = "Couldn\u2019t send the request. Please email hello@freightfolio.net instead.";
          $("delete-error").hidden = false;
        }
      }).catch(function () {
        btn.disabled = false;
        $("delete-error").textContent = "Couldn\u2019t send the request. Please email hello@freightfolio.net instead.";
        $("delete-error").hidden = false;
      });
    });
  }

  function loadAccount() {
    api("/api/account").then(function (r) {
      var a = r.body;
      if (!a || !a.ok) return;
      var plan = a.plan || {};
      var html = '<dl style="display:grid;grid-template-columns:auto 1fr;gap:8px 18px;max-width:560px">' +
        "<dt><strong>Email</strong></dt><dd>" + esc(a.email) + "</dd>" +
        "<dt><strong>Plan</strong></dt><dd>" + esc(plan.name || "\u2014") +
        (plan.kind === "subscription" ? " (subscription" + (plan.cancel_at_period_end ? ", ends " + esc(fmtDate(plan.current_period_end)) : ", renews " + esc(fmtDate(plan.current_period_end))) + ")" : "") + "</dd>" +
        (a.usage ? "<dt><strong>Usage</strong></dt><dd>" + esc(a.usage.used) + " of " + esc(a.usage.allowance) + " documents</dd>" : "") +
        "<dt><strong>Support</strong></dt><dd><a href='mailto:" + esc(a.support.email) + "'>" + esc(a.support.email) + "</a> \u2014 " + esc(a.support.note) + "</dd>" +
        "</dl>";
      if (!plan.portal_url) {
        html += '<p class="small muted">To change or cancel billing, email <a href="mailto:hello@freightfolio.net">hello@freightfolio.net</a> and we\u2019ll take care of it.</p>';
      }
      $("account-details").innerHTML = html;
      $("retention-text").textContent = (a.retention && a.retention.summary) || "";
    });
  }

  function wirePlans() {
    var t = $("plans-toggle"), panel = $("plans-panel");
    if (!t || !panel) return;
    t.addEventListener("click", function () {
      var open = panel.hidden;
      if (open) renderPlans();
      panel.hidden = !open;
      t.setAttribute("aria-expanded", String(open));
      t.textContent = open ? "Hide plans" : "Need more room? Compare plans";
    });
  }

  var UPGRADE_PLANS = [
    { key: "starter", name: "Starter", price: "$39/mo", docs: "100 documents/mo", url: "https://buy.stripe.com/28E7sK4Rd6mq1X3cNnabK07" },
    { key: "business", name: "Business", price: "$149/mo", docs: "400 documents/mo", url: "https://buy.stripe.com/aFa8wOabx8uy1X37t3abK08" },
    { key: "premium", name: "Premium", price: "$369/mo", docs: "1,000 documents/mo", url: "https://buy.stripe.com/5kQ4gyabx9yC1X38x7abK09" }
  ];

  function currentPlanKey() {
    var ent = state.me && state.me.entitlement;
    if (ent && ent.kind === "subscription" && ent.plan) return ent.plan;
    return null;
  }

  function renderPlans() {
    var panel = $("plans-panel");
    var cur = currentPlanKey();
    var html = UPGRADE_PLANS.map(function (p) {
      var isCur = cur === p.key;
      var action = isCur
        ? '<span class="plan-current">Current plan</span>'
        : '<a class="plan-sub" href="' + p.url + '" target="_blank" rel="noopener">Subscribe</a>';
      return '<div class="plan-row"><span class="plan-name">' + esc(p.name) + "</span>" +
        '<span class="plan-meta">' + esc(p.price) + " \u00b7 " + esc(p.docs) + "</span>" +
        '<span class="spacer"></span>' + action + "</div>";
    }).join("");
    html += '<p class="plans-note">Subscribing starts a new plan. Email <a href="mailto:hello@freightfolio.net">hello@freightfolio.net</a> and we\u2019ll cancel the old one so you\u2019re never double-billed.</p>';
    panel.innerHTML = html;
  }

  /* ---------- recovery add-on ---------- */
  // Renders the 7th tab ("Recovery") defensively from state.me.recovery. The
  // billing workstream owns the /api/me recovery object and the action
  // endpoints below; if they are absent the tab degrades without crashing.
  var RA = (typeof window !== "undefined" && window.RecoveryAddon) ? window.RecoveryAddon : null;

  function recoveryActionError(r) {
    if (!r || !r.body) return "Request failed. Check your connection.";
    if (r.status === 404 || (r.body.error === "not_configured")) {
      return "That part of the add-on is not wired up yet. Email hello@freightfolio.net and we will take care of it.";
    }
    return "Failed: " + (r.body.error || "unknown") +
      (r.body.detail ? " (" + r.body.detail + ")" : "");
  }

  function renderRecovery() {
    var root = $("recovery-root");
    if (!RA) {
      root.innerHTML = '<div class="app-card"><p class="form-error" role="alert">The Recovery panel failed to load. Reload the page or email hello@freightfolio.net.</p></div>';
      return;
    }
    var r = RA.normalizeRecovery(state.me && state.me.recovery);
    if (!r || !RA.isEntitled(r)) { renderRecoveryUpsell(root); return; }
    if (r.reauth_required || r.status === "awaiting_setup") { renderRecoveryOnboarding(root, r); return; }
    renderRecoveryActive(root, r);
  }

  /* ----- upsell (not entitled) ----- */
  function renderRecoveryUpsell(root) {
    var me = state.me || {};
    var planKey = me.entitlement && me.entitlement.kind === "subscription" && me.entitlement.plan
      ? me.entitlement.plan : "business";
    var ex = RA.planTotalExample(planKey);
    var link = RA.RECOVERY.PAYMENT_LINK;
    var placeholder = link.indexOf("REPLACE_ME") >= 0;
    root.innerHTML =
      '<div class="app-card">' +
      "<h2>Missing-Document Recovery</h2>" +
      "<p>Missing paperwork? Freightfolio requests it from your approved contacts, follows up automatically, and updates your load packets when verified documents arrive. Includes 50 document requests per month for $99.</p>" +
      '<ul class="checklist">' +
      "<li><strong>Included</strong><span>Automated requests to your approved contacts, scheduled reminders, incoming document checks, and report updates when verified documents arrive.</span></li>" +
      "<li><strong>Not included</strong><span>Phone calls, unlimited chasing, collections, disputes, manual investigation, invoice submission, and custom integrations unless separately contracted.</span></li>" +
      "</ul>" +
      '<div class="stat-grid">' +
      '<div class="stat-card"><div class="stat-value">' + esc(RA.fmtMoney(RA.RECOVERY.PRICE_CENTS)) + '</div><div class="stat-label">per month</div></div>' +
      '<div class="stat-card"><div class="stat-value">50</div><div class="stat-label">document requests / month</div></div>' +
      '<div class="stat-card"><div class="stat-value">Free</div><div class="stat-label">extra requests queue for next month</div></div>' +
      "</div>" +
      '<p class="small" style="margin-top:14px">Recovered documents count toward your base plan&rsquo;s monthly document allowance. Requests beyond 50 in a month wait in the queue for the next cycle at no extra charge. If you add Recovery mid-cycle, your first charge may be prorated. What we promise is the process, not guaranteed recovery: cases we cannot resolve come back to you with supporting evidence and a recommended next action.</p>' +
      '<p class="small"><strong>Example total:</strong> ' + esc(ex.plan_name) + " (" + esc(ex.base) + "/mo) + Recovery (" + esc(ex.addon) + "/mo) = <strong>" + esc(ex.total) + "/mo</strong>.</p>" +
      '<p style="margin-top:16px"><a class="btn btn-amber" id="recovery-add-btn" href="' + esc(link) + '" target="_blank" rel="noopener">Add Recovery ($99/mo)</a></p>' +
      '<p class="form-error" id="recovery-link-note" role="alert" hidden></p>' +
      '<p class="hint">No setup yet means no outreach. After purchase you will approve your contacts and email templates here, and outreach starts only after you authorize it.</p>' +
      "</div>";
    var btn = $("recovery-add-btn");
    if (placeholder) {
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        var note = $("recovery-link-note");
        note.textContent = "Online checkout for this add-on is not set up yet on this staging site. Email hello@freightfolio.net and we will add it for you.";
        note.hidden = false;
      });
    }
  }

  /* ----- onboarding / reauthorization ----- */
  function renderRecoveryOnboarding(root, r) {
    var pre = RA.prefillOnboarding(r.setup);
    var awaiting = r.status === "awaiting_setup";
    var html = '<div class="app-card">';
    if (r.reauth_required) {
      html += '<div class="issue sev-high"><h3>Reauthorization needed</h3>' +
        "<p>Your contacts, sending identity, templates, or cadence changed. Outreach is paused until you re-approve the details below.</p></div>";
    } else if (awaiting) {
      html += '<div class="issue"><h3>Awaiting setup</h3>' +
        "<p>Payment received. Outreach starts only after you complete and authorize the setup below. Payment alone does not activate it.</p></div>";
    }
    html += '<h2>' + (r.reauth_required ? "Re-approve your recovery setup" : "Set up Missing-Document Recovery") + "</h2>" +
      '<p class="muted small">One form. We only ever contact the people you list here, and only with the wording you approve.</p>' +
      '<form id="rco-form" novalidate>';

    html += "<h3>Approved contacts</h3>" +
      '<p class="hint">Add at least one. We request documents only from these contacts, and only about your loads.</p>';
    RA.CONTACT_ROLES.forEach(function (role) {
      var c = pre.contacts[role.key] || {};
      html += '<div class="field"><label>' + esc(role.label) + " contact</label>" +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
        '<input type="text" id="rco-contact-name-' + role.key + '" placeholder="Full name" value="' + esc(c.name) + '" autocomplete="off">' +
        '<input type="email" id="rco-contact-email-' + role.key + '" placeholder="name@company.com" value="' + esc(c.email) + '" autocomplete="off">' +
        "</div>" +
        '<span class="field-error" id="rco-err-contact-name-' + role.key + '" role="alert" hidden></span>' +
        '<span class="field-error" id="rco-err-contact-email-' + role.key + '" role="alert" hidden></span>' +
        "</div>";
    });

    html += '<div class="field">' +
      '<label style="display:flex;gap:10px;align-items:flex-start;font-weight:normal">' +
      '<input type="checkbox" id="rco-permission" style="margin-top:4px;flex:none"' + (pre.permission ? " checked" : "") + '>' +
      "<span>I authorize Freightfolio to request documents from these contacts on my behalf.</span></label>" +
      '<span class="field-error" id="rco-err-permission" role="alert" hidden></span></div>';

    html += "<h3>Sending identity</h3>" +
      '<div class="field"><label for="rco-sender-name">Name requests are sent from</label>' +
      '<input type="text" id="rco-sender-name" value="' + esc(pre.sender_name) + '" placeholder="Your name">' +
      '<span class="field-error" id="rco-err-sender-name" role="alert" hidden></span></div>' +
      '<div class="field"><label for="rco-sender-email">Sending email address</label>' +
      '<input type="email" id="rco-sender-email" value="' + esc(pre.sender_email) + '" placeholder="billing@yourcompany.com">' +
      '<span class="field-error" id="rco-err-sender-email" role="alert" hidden></span></div>' +
      '<div class="field"><label for="rco-reply-to">Reply-to address (replies from contacts land here)</label>' +
      '<input type="email" id="rco-reply-to" value="' + esc(pre.reply_to) + '" placeholder="Same as above if left blank">' +
      '<p class="hint">Leave blank to use the sending address.</p>' +
      '<span class="field-error" id="rco-err-reply-to" role="alert" hidden></span></div>';

    html += "<h3>Email templates</h3>" +
      '<p class="hint">Sensible defaults are filled in. {{placeholders}} are replaced per request: load, document type, contact name, and dates.</p>';
    var tplFields = [
      { key: "first_request", label: "First request" },
      { key: "reminder", label: "Reminder" },
      { key: "escalation", label: "Escalation" },
    ];
    tplFields.forEach(function (t) {
      var sk = t.key + "_subject", bk = t.key + "_body";
      var sid = "rco-tpl-" + t.key + "-subject", bid = "rco-tpl-" + t.key + "-body";
      html += '<div class="field"><label for="' + sid + '">' + esc(t.label) + ": subject</label>" +
        '<input type="text" id="' + sid + '" value="' + esc(pre.templates[sk]) + '">' +
        '<span class="field-error" id="rco-err-tpl-' + t.key + '-subject" role="alert" hidden></span></div>' +
        '<div class="field"><label for="' + bid + '">' + esc(t.label) + ": body</label>" +
        '<textarea id="' + bid + '" rows="5">' + esc(pre.templates[bk]) + "</textarea>" +
        '<span class="field-error" id="rco-err-tpl-' + t.key + '-body" role="alert" hidden></span></div>';
    });

    html += "<h3>Cadence, escalation, timezone</h3>" +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
      '<div class="field"><label for="rco-cadence-days">Days between attempts</label>' +
      '<input type="number" id="rco-cadence-days" min="1" value="' + esc(pre.cadence.days_between_attempts) + '">' +
      '<span class="field-error" id="rco-err-cadence-days" role="alert" hidden></span></div>' +
      '<div class="field"><label for="rco-cadence-max">Max attempts per request</label>' +
      '<input type="number" id="rco-cadence-max" min="1" value="' + esc(pre.cadence.max_attempts) + '">' +
      '<span class="field-error" id="rco-err-cadence-max" role="alert" hidden></span></div></div>' +
      '<div class="field"><label for="rco-escalation-rule">Escalation rule</label>' +
      '<input type="text" id="rco-escalation-rule" value="' + esc(pre.escalation_rule) + '">' +
      '<p class="hint">Default: escalate to the escalation contact after ' + esc(pre.cadence.escalate_after_attempts) + " unanswered attempts.</p></div>" +
      '<div class="field"><label for="rco-timezone">Timezone (all schedules use this)</label>' +
      '<select id="rco-timezone">' +
      RA.RECOVERY.TIMEZONES.map(function (tz) {
        return '<option value="' + esc(tz) + '"' + (tz === pre.timezone ? " selected" : "") + ">" + esc(tz) + "</option>";
      }).join("") + "</select>" +
      '<span class="field-error" id="rco-err-timezone" role="alert" hidden></span></div>';

    html += "<h3>Document requirements</h3>" +
      '<p class="hint">Which document types we should chase for your loads.</p>' +
      RA.DOCUMENT_REQUIREMENTS.map(function (dr) {
        var on = pre.requirements.indexOf(dr.key) >= 0;
        return '<div class="field"><label style="display:flex;gap:10px;align-items:center;font-weight:normal">' +
          '<input type="checkbox" id="rco-req-' + dr.key + '"' + (on ? " checked" : "") + '>' +
          "<span>" + esc(dr.label) + "</span></label></div>";
      }).join("") +
      '<span class="field-error" id="rco-err-req-rate_con" role="alert" hidden></span>';

    if (r.reauth_required) {
      html += '<p class="hint">Submitting changes to contacts, identity, templates, or cadence pauses outreach until you re-approve here.</p>';
    }
    html += '<p><button class="btn btn-amber" type="submit" id="rco-submit">' +
      (r.reauth_required ? "Re-approve setup" : "Authorize and activate") + "</button></p>" +
      '<p class="form-ok" id="rco-ok" role="status" hidden></p>' +
      '<p class="form-error" id="rco-error" role="alert" hidden></p>' +
      "</form></div>";
    root.innerHTML = html;

    $("rco-form").addEventListener("submit", function (e) {
      e.preventDefault();
      submitOnboarding(root, r);
    });
  }

  function gatherOnboarding() {
    var d = RA.defaultOnboarding();
    RA.CONTACT_ROLES.forEach(function (role) {
      d.contacts[role.key] = {
        name: $("rco-contact-name-" + role.key).value,
        email: $("rco-contact-email-" + role.key).value,
      };
    });
    d.permission = $("rco-permission").checked;
    d.sender_name = $("rco-sender-name").value;
    d.sender_email = $("rco-sender-email").value;
    d.reply_to = $("rco-reply-to").value;
    Object.keys(RA.DEFAULT_TEMPLATES).forEach(function (k) {
      var el = $("rco-tpl-" + k.replace(/_/g, "-"));
      d.templates[k] = el ? el.value : "";
    });
    d.cadence.days_between_attempts = $("rco-cadence-days").value;
    d.cadence.max_attempts = $("rco-cadence-max").value;
    d.timezone = $("rco-timezone").value;
    d.escalation_rule = $("rco-escalation-rule").value;
    d.requirements = RA.DOCUMENT_REQUIREMENTS
      .filter(function (dr) { return $("rco-req-" + dr.key).checked; })
      .map(function (dr) { return dr.key; });
    return d;
  }

  function showOnboardingErrors(errors) {
    document.querySelectorAll("#rco-form .field-error").forEach(function (el) {
      el.hidden = true; el.textContent = "";
    });
    errors.forEach(function (e) {
      var el = document.getElementById("rco-err-" + e.field);
      if (el) { el.textContent = e.message; el.hidden = false; }
    });
    if (errors.length) {
      var first = document.getElementById("rco-err-" + errors[0].field);
      if (first) first.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }

  function submitOnboarding(root, r) {
    var data = gatherOnboarding();
    var errors = RA.validateOnboarding(data);
    showOnboardingErrors(errors);
    $("rco-ok").hidden = true; $("rco-error").hidden = true;
    if (errors.length) return;
    var btn = $("rco-submit");
    btn.disabled = true;
    api(RA.ENDPOINTS.setup, {
      method: "POST",
      body: JSON.stringify({
        permission: data.permission === true,
        contacts: data.contacts,
        sender_name: data.sender_name.trim(),
        sender_email: data.sender_email.trim(),
        reply_to: data.reply_to.trim(),
        templates: data.templates,
        cadence: {
          days_between_attempts: Number(data.cadence.days_between_attempts),
          max_attempts: Number(data.cadence.max_attempts),
          escalate_after_attempts: RA.DEFAULT_CADENCE.escalate_after_attempts,
        },
        timezone: data.timezone,
        escalation_rule: data.escalation_rule,
        requirements: data.requirements,
      }),
    }).then(function (resp) {
      btn.disabled = false;
      if (resp.body && resp.body.ok) {
        $("rco-ok").textContent = r.reauth_required
          ? "Setup re-approved. Recovery outreach resumes."
          : resp.body.activated
            ? "Setup saved. Recovery is now active."
            : "Setup saved.";
        $("rco-ok").hidden = false;
        api("/api/me").then(function (r2) {
          if (r2.body && r2.body.ok) {
            state.me = r2.body;
            setTimeout(renderRecovery, 1500);
          }
        });
      } else {
        $("rco-error").textContent = recoveryActionError(resp);
        $("rco-error").hidden = false;
      }
    }).catch(function () {
      btn.disabled = false;
      $("rco-error").textContent = recoveryActionError(null);
      $("rco-error").hidden = false;
    });
  }

  /* ----- active management ----- */
  function renderRecoveryActive(root, r) {
    var pct = r.allowance > 0 ? Math.round((r.requests_used / r.allowance) * 100) : 0;
    var html = '<div class="app-card">';
    if (r.reauth_required) {
      html += '<div class="issue sev-high"><h3>Reauthorization needed</h3>' +
        "<p>Your contacts, sending identity, templates, or cadence changed. Outreach is paused until you re-approve.</p></div>";
    }
    html += "<h2>Missing-Document Recovery</h2>" +
      '<p class="muted small">' + esc(RA.entitlementLabel(r.entitlement)) +
      (r.status !== "awaiting_setup" ? " &middot; " + esc(RA.statusLabel(r.status)) : "") +
      (r.cancel_scheduled ? " &middot; Cancel scheduled" + (r.service_end_at ? " " + esc(fmtDate(r.service_end_at)) : "") : "") + "</p>" +
      "<h3>Usage this month</h3>" +
      '<p class="muted small">' + esc(r.requests_used) + " of " + esc(r.allowance) + " requests used" +
      (r.next_period_start ? ", resets " + esc(fmtDate(r.next_period_start)) : "") + ".</p>" +
      '<div class="progress" role="progressbar" aria-label="Recovery requests used"><span style="width:' + Math.min(100, pct) + '%"></span></div>' +
      '<p class="hint">50 requests included per month. Requests beyond that wait in the queue for the next cycle at no extra charge.</p>' +
      "</div>";

    html += '<div class="app-card" style="margin-top:16px"><h2>Requests</h2>';
    if (!r.requests.length) {
      html += '<p class="muted">No recovery requests yet. Requests appear here when missing documents are found in your paperwork.</p>';
    } else {
      html += '<div class="table-wrap"><table class="data-table"><thead><tr>' +
        "<th>Document</th><th>Contact</th><th>Status</th><th>Updated</th></tr></thead><tbody>" +
        r.requests.map(function (q) {
          return "<tr><td>" + esc(q.document || q.document_type || "\u2014") + "</td><td class='small'>" +
            esc(q.contact_name || q.contact_email || "\u2014") + "</td><td>" +
            statusBadge(q.status) + " " + esc(RA.requestStatusLabel(q.status)) + "</td><td>" +
            esc(fmtDate(q.updated_at || q.created_at)) + "</td></tr>";
        }).join("") + "</tbody></table></div>";
    }
    if (r.exceptions && r.exceptions.length) {
      html += "<h3>Exceptions and failures</h3>" +
        r.exceptions.map(function (x) {
          return '<div class="issue sev-' + esc(x.severity || "medium") + '"><h3>' + esc(x.title || "Exception") + "</h3>" +
            "<p>" + esc(x.message || "") + "</p>" +
            (x.recommendation ? '<div class="rec"><strong>Recommended next step:</strong> ' + esc(x.recommendation) + "</div>" : "") + "</div>";
        }).join("");
    }
    html += "</div>";

    html += '<div class="app-card" style="margin-top:16px"><h2>Contacts and authorization</h2>';
    var setup = r.setup || {};
    var contacts = setup.contacts || {};
    var listed = RA.CONTACT_ROLES.filter(function (role) {
      var c = contacts[role.key];
      return c && (c.name || c.email);
    });
    if (!listed.length) {
      html += '<p class="muted">No approved contacts on file.</p>';
    } else {
      html += "<ul>" + listed.map(function (role) {
        var c = contacts[role.key];
        return "<li class='small'><strong>" + esc(role.label) + ":</strong> " + esc(c.name || "") +
          " &lt;" + esc(c.email || "") + "&gt; " + statusBadge("active") + " authorized</li>";
      }).join("") + "</ul>";
    }
    html += '<p><button class="btn btn-sm" type="button" id="recovery-edit-contacts">Update contacts</button></p>' +
      '<p class="hint">Changing contacts pauses outreach until you re-approve (reauthorization).</p></div>';

    html += '<div class="app-card" style="margin-top:16px"><h2>Manage</h2>';
    if (r.status === "active") {
      html += '<p><button class="btn btn-sm" type="button" id="recovery-pause">Pause outreach</button></p>';
    } else if (r.status === "paused") {
      html += '<p><button class="btn btn-sm btn-amber" type="button" id="recovery-resume">Resume outreach</button></p>';
    }
    html += '<p class="form-ok" id="recovery-ok" role="status" hidden></p>' +
      '<p class="form-error" id="recovery-error" role="alert" hidden></p>' +
      '<p style="margin-top:18px"><button class="linklike" type="button" id="recovery-cancel">Cancel the Recovery add-on</button></p>' +
      '<p class="hint">Billing questions or changes: <a href="mailto:hello@freightfolio.net">hello@freightfolio.net</a>.</p></div>';

    root.innerHTML = html;

    var editBtn = $("recovery-edit-contacts");
    if (editBtn) editBtn.addEventListener("click", function () {
      var rr = RA.normalizeRecovery(state.me && state.me.recovery);
      renderRecoveryOnboarding(root, rr);
    });
    var pauseBtn = $("recovery-pause"), resumeBtn = $("recovery-resume");
    if (pauseBtn) pauseBtn.addEventListener("click", function () {
      if (!confirm("Pause all recovery outreach? Requests in flight stop until you resume.")) return;
      recoveryPost(RA.ENDPOINTS.pause, {}, "Outreach paused.", root);
    });
    if (resumeBtn) resumeBtn.addEventListener("click", function () {
      recoveryPost(RA.ENDPOINTS.resume, {}, "Outreach resumed.", root);
    });
    $("recovery-cancel").addEventListener("click", function () {
      if (!confirm("Cancel the Recovery add-on? Outreach stops; your base plan is not affected.")) return;
      recoveryPost(RA.ENDPOINTS.cancel, {}, "Recovery add-on canceled.", root);
    });
  }

  function recoveryPost(path, body, okMsg, root) {
    var okEl = $("recovery-ok"), errEl = $("recovery-error");
    okEl.hidden = true; errEl.hidden = true;
    api(path, { method: "POST", body: JSON.stringify(body) }).then(function (resp) {
      if (resp.body && resp.body.ok) {
        okEl.textContent = okMsg;
        okEl.hidden = false;
        api("/api/me").then(function (r2) {
          if (r2.body && r2.body.ok) {
            state.me = r2.body;
            setTimeout(function () { renderRecovery(); }, 1200);
          }
        });
      } else {
        errEl.textContent = recoveryActionError(resp);
        errEl.hidden = false;
      }
    }).catch(function () {
      errEl.textContent = recoveryActionError(null);
      errEl.hidden = false;
    });
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
