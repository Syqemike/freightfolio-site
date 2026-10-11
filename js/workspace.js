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
  var tabIds = ["overview", "uploads", "history", "issues", "reports", "account"];
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

  function startUpload() {
    uploading = true;
    var items = queue.filter(function (q) { return q.state === "ready"; });
    items.forEach(function (it) { it.state = "hashing"; it.error = ""; it.progress = 0; });
    renderQueue();
    updateAllowanceLine();

    var hashed = items.map(function (it) {
      return it.file.arrayBuffer().then(sha256Hex).then(function (h) {
        it.sha256 = h;
        return { filename: it.file.name, content_type: it.detected.mime, size_bytes: it.file.size, sha256: h };
      });
    });

    Promise.all(hashed).then(function (payload) {
      return api("/api/upload-init", {
        method: "POST",
        body: JSON.stringify({ order_id: state.orderId, files: payload }), // session cookie auth
      });
    }).then(function (res) {
      var body = res.body || {};
      if (!body.ok) {
        if (res.status === 401) throw new Error("signed_out");
        throw new Error(body.error === "allowance_exhausted"
          ? "You\u2019ve used your full document allowance for this period."
          : "The server refused the upload (" + (body.error || "unknown") + ").");
      }
      var byHash = {};
      (body.uploads || []).forEach(function (u) { byHash[u.sha256] = u; });
      (body.rejected || []).forEach(function (r) {
        var hit = items.filter(function (it) { return it.file.name === r.filename; })[0];
        if (hit) {
          hit.state = "invalid";
          hit.error = r.reason === "duplicate_content" ? "This exact file was already uploaded."
            : r.reason === "too_large" ? "Over 25 MB."
            : "Rejected by the server (" + r.reason + ").";
        }
      });
      items.forEach(function (it) {
        var u = byHash[it.sha256];
        if (u) { it.putUrl = u.put_url; it.key = u.key; it.contentType = u.required_content_type; }
        else if (it.state === "hashing") { it.state = "invalid"; it.error = "No upload URL was issued for this file."; }
      });
      renderQueue();

      var toUpload = items.filter(function (it) { return it.putUrl; });
      var chain = Promise.resolve();
      toUpload.forEach(function (it) {
        chain = chain.then(function () {
          it.state = "uploading"; renderQueue();
          return putWithProgress(it.putUrl, it.file, it.contentType, function (p) {
            it.progress = p; renderQueue();
          }).then(function () { it.state = "done"; it.progress = 100; renderQueue(); })
            .catch(function (e) { it.state = "error"; it.error = e.message + " You can re-add the file to retry."; renderQueue(); });
        });
      });
      return chain.then(function () { return toUpload; });
    }).then(function (toUpload) {
      var done = (toUpload || []).filter(function (it) { return it.state === "done"; });
      uploading = false;
      if (!done.length) { renderQueue(); return; }
      return api("/api/upload-complete", {
        method: "POST",
        body: JSON.stringify({
          order_id: state.orderId,
          uploads: done.map(function (it) { return { sha256: it.sha256, key: it.key }; }),
        }),
      }).then(function (res) {
        var body = res.body || {};
        if (!body.ok) throw new Error("finalize_failed");
        renderQueue();
        queue = queue.filter(function (it) { return it.state !== "done"; });
        renderQueue();
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
        });
      });
    }).catch(function (e) {
      uploading = false;
      if (e.message === "signed_out") { showError({ status: 401 }); return; }
      renderQueueNote(e.message || "Something went wrong starting the upload.");
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
      unreadable: "Unreadable document", note: "Note from our team" }[i.type] || "Issue";
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

  document.addEventListener("DOMContentLoaded", boot);
})();
