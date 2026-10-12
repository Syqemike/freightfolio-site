/**
 * js/admin.js — ops console (CSP-safe external script).
 * Admin session only; the API enforces it (freightfolio.ops@gmail.com).
 */

(function () {
  "use strict";

  var cursor = null;
  var currentOrderId = null;

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmtDate(iso) {
    if (!iso) return "\u2014";
    try { return new Date(iso).toLocaleString(); } catch (e) { return iso; }
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
  function statusBadge(s) {
    var label = { received: "Received", processing: "Processing", needs_attention: "Needs attention",
      completed: "Completed", delivered: "Delivered", paid: "Paid", uploading: "Uploading" }[s] || s;
    return '<span class="badge badge-' + esc(s) + '">' + esc(label) + "</span>";
  }

  function boot() {
    $("admin-signout").addEventListener("click", function () {
      api("/api/auth/logout", { method: "POST" }).then(function () {
        window.location.href = "/login";
      }).catch(function () { window.location.href = "/login"; });
    });
    $("refresh-batches").addEventListener("click", function () { cursor = null; loadBatches(true); });
    $("more-batches").addEventListener("click", function () { loadBatches(false); });
    $("back-to-list").addEventListener("click", showList);
    $("action-apply-status").addEventListener("click", function () {
      var v = $("action-status").value;
      if (v) doAction({ action: "set_status", status: v });
    });
    $("action-add-note").addEventListener("click", function () {
      var v = $("action-note").value.trim();
      if (v) doAction({ action: "add_note", note: v });
    });
    $("action-add-issue").addEventListener("click", function () {
      var v = $("issue-message").value.trim();
      if (!v) return;
      doAction({
        action: "add_issue",
        issue: {
          type: "note",
          severity: $("issue-severity").value,
          load: $("issue-load").value.trim(),
          message: v,
          recommendation: $("issue-recommendation").value.trim(),
        },
      });
    });
    $("action-resend").addEventListener("click", function () {
      if (confirm("Resend the files-received emails for this order?")) {
        doAction({ action: "resend_notification" });
      }
    });

    api("/api/me").then(function (r) {
      $("admin-loading").hidden = true;
      if (r.status === 200 && r.body && r.body.ok && r.body.role === "admin") {
        $("admin-app").hidden = false;
        loadBatches(true);
        loadRecoveryAdmin();
      } else {
        $("admin-denied").hidden = false;
      }
    }).catch(function () {
      $("admin-loading").hidden = true;
      $("admin-denied").hidden = false;
    });
  }

  /* ---------- recovery add-on (read-only; backend owned by billing workstream) ---------- */
  // GET /api/admin/recovery is an assumed contract from the billing workstream.
  // Shape: { ok, entitlements: [{email, entitlement, status, requests_used,
  // requests_remaining, allowance, reauth_required}],
  // exceptions: [...], audit: [...] }. The managed_included flag control stays
  // disabled until the admin API contract supports writes.
  function loadRecoveryAdmin() {
    var box = $("recovery-admin");
    var RA = (typeof window !== "undefined" && window.RecoveryAddon) ? window.RecoveryAddon : null;
    var path = RA ? RA.ENDPOINTS.admin : "/api/admin/recovery";
    api(path).then(function (r) {
      if (!r.body || !r.body.ok) {
        box.innerHTML = "<p class='muted'>Recovery admin data is not available yet " +
          "(the billing workstream has not wired the endpoint). No action needed.</p>";
        return;
      }
      var b = r.body;
      var html = "";
      var ents = b.entitlements || [];
      html += "<h2>Entitlements (" + ents.length + ")</h2>";
      if (!ents.length) {
        html += "<p class='muted'>No customers on the Recovery add-on.</p>";
      } else {
        html += '<div class="table-wrap"><table class="data-table"><thead><tr>' +
          "<th>Customer</th><th>Entitlement</th><th>Status</th><th>Used / allowance</th>" +
          "<th>Reauth</th></tr></thead><tbody>" +
          ents.map(function (e) {
            var label = RA ? RA.entitlementLabel(e.entitlement) : e.entitlement;
            var st = RA ? RA.statusLabel(e.status) : e.status;
            return "<tr><td class='small'>" + esc(e.email || "") + "</td><td>" + esc(label) + "</td>" +
              "<td>" + statusBadge(e.status || "") + " " + esc(st) + "</td>" +
              "<td>" + esc(e.requests_used) + " / " + esc(e.allowance != null ? e.allowance : 50) + "</td>" +
              "<td>" + (e.reauth_required ? "Yes" : "No") + "</td></tr>";
          }).join("") + "</tbody></table></div>";
      }
      var excs = b.exceptions || [];
      html += "<h2 style='margin-top:18px'>Exceptions and failures (" + excs.length + ")</h2>";
      html += excs.length
        ? excs.map(function (x) {
            return '<div class="issue sev-' + esc(x.severity || "medium") + '"><h3>' + esc(x.title || "Exception") + "</h3>" +
              "<p>" + esc(x.message || "") + "</p>" +
              (x.recommendation ? '<div class="rec"><strong>Recommended next step:</strong> ' + esc(x.recommendation) + "</div>" : "") + "</div>";
          }).join("")
        : "<p class='muted'>None.</p>";
      var audit = b.audit || [];
      html += "<h2 style='margin-top:18px'>Audit history (" + audit.length + ")</h2>";
      html += audit.length
        ? '<ul class="audit-log">' + audit.map(function (a) {
            return "<li class='small'>" + esc(a.at || "") + " \u2014 " + esc(a.actor || "") +
              ": " + esc(a.action || "") + (a.detail ? " (" + esc(a.detail) + ")" : "") + "</li>";
          }).join("") + "</ul>"
        : "<p class='muted'>No audit entries yet.</p>";
      html += "<h2 style='margin-top:18px'>Managed-billing inclusion</h2>" +
        '<p class="muted small">The <em>managed_included</em> entitlement flag is controlled by the add-on backend contract, which does not expose a write path yet. The control below is disabled until it does.</p>' +
        '<p><select id="recovery-managed-flag" disabled aria-label="Managed inclusion flag">' +
        '<option>Managed inclusion (unavailable, read-only)</option></select></p>';
      box.innerHTML = html;
    }).catch(function () {
      box.innerHTML = "<p class='muted'>Could not load recovery admin data. Refresh to retry.</p>";
    });
  }

  function loadBatches(reset) {
    var qs = "limit=50" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : "");
    api("/api/admin/batches?" + qs).then(function (r) {
      var batches = (r.body && r.body.batches) || [];
      cursor = r.body && r.body.cursor ? r.body.cursor : null;
      $("more-batches").hidden = !cursor;
      var tb = $("batch-table").querySelector("tbody");
      if (reset) tb.innerHTML = "";
      batches.forEach(function (b) {
        var tr = document.createElement("tr");
        tr.innerHTML = "<td><a href='#' data-order='" + esc(b.order_id) + "'>" + esc(b.order_id) + "</a>" +
          (b.test ? ' <span class="badge badge-low">test</span>' : "") + "</td>" +
          "<td class='small'>" + esc(b.customer_email || "") + "</td>" +
          "<td class='small'>" + esc(b.product) + (b.plan ? " \u00b7 " + esc(b.plan) : "") + "</td>" +
          "<td>" + statusBadge(b.status) + "</td>" +
          "<td>" + esc(b.files) + "</td><td>" + esc(b.reports) + "</td><td>" + esc(b.issues) + "</td>" +
          "<td class='small'>" + esc(fmtDate(b.created_at)) + "</td>";
        tb.appendChild(tr);
      });
      tb.querySelectorAll("a[data-order]").forEach(function (a) {
        a.addEventListener("click", function (e) {
          e.preventDefault();
          openBatch(a.getAttribute("data-order"));
        });
      });
    });
  }

  function showList() {
    $("batch-detail-view").hidden = true;
    $("batch-list-view").hidden = false;
    currentOrderId = null;
  }

  function openBatch(orderId) {
    currentOrderId = orderId;
    $("batch-list-view").hidden = true;
    $("batch-detail-view").hidden = false;
    $("batch-detail").innerHTML = "<p class='muted'>Loading\u2026</p>";
    api("/api/admin/batch?order_id=" + encodeURIComponent(orderId)).then(function (r) {
      var o = r.body && r.body.order;
      if (!o) { $("batch-detail").innerHTML = "<p class='form-error'>Batch not found.</p>"; return; }
      var html = "<h2>" + esc(o.order_id) + " " + statusBadge(o.status) +
        (o.test ? ' <span class="badge badge-low">test</span>' : "") + "</h2>" +
        "<p class='muted small'>Customer " + esc(o.customer_email || "") +
        " \u00b7 created " + esc(fmtDate(o.created_at)) +
        (o.delivered_at ? " \u00b7 delivered " + esc(fmtDate(o.delivered_at)) : "") + "</p>" +
        "<h3>Files (" + (o.files || []).length + " of " + esc(o.doc_allowance) + " allowed)</h3>";
      html += (o.files || []).length
        ? '<div class="table-wrap"><table class="data-table"><thead><tr><th>File</th><th>Size</th><th>Received</th></tr></thead><tbody>' +
          o.files.map(function (f) {
            return "<tr><td>" + esc(f.filename) + "</td><td>" + esc(f.size_bytes) + "</td><td class='small'>" + esc(fmtDate(f.received_at)) + "</td></tr>";
          }).join("") + "</tbody></table></div>"
        : "<p class='muted'>No files yet.</p>";
      html += "<h3>Reports (" + (o.report_files || []).length + ")</h3>";
      html += (o.report_files || []).length
        ? "<ul>" + o.report_files.map(function (rf) {
            return "<li class='small'>" + esc(rf.name) + " \u00b7 " + esc(fmtDate(rf.uploaded_at)) + "</li>";
          }).join("") + "</ul>"
        : "<p class='muted'>No reports yet.</p>";
      html += "<h3>Issues (" + (o.issues || []).length + ")</h3>";
      html += (o.issues || []).length
        ? o.issues.map(function (i) {
            return "<p class='small'><strong>[" + esc(i.severity) + "]</strong> " + esc(i.message) +
              " <span class='muted'>(" + esc(i.source || "") + ")</span></p>";
          }).join("")
        : "<p class='muted'>None.</p>";
      if ((o.ops_notes || []).length) {
        html += "<h3>Ops notes</h3><ul class='audit-log'>" + o.ops_notes.map(function (n) {
          return "<li>" + esc(n.at) + " \u2014 " + esc(n.by || "") + ": " + esc(n.note) + "</li>";
        }).join("") + "</ul>";
      }
      $("batch-detail").innerHTML = html;
    });
  }

  function doAction(payload) {
    $("admin-ok").hidden = true; $("admin-error").hidden = true;
    payload.order_id = currentOrderId;
    api("/api/admin/action", { method: "POST", body: JSON.stringify(payload) }).then(function (r) {
      if (r.body && r.body.ok) {
        $("admin-ok").textContent = "Done \u2014 " + (r.body.detail || r.body.action) + ". Logged.";
        $("admin-ok").hidden = false;
        $("action-note").value = ""; $("issue-message").value = "";
        $("issue-load").value = ""; $("issue-recommendation").value = "";
        openBatch(currentOrderId);
        cursor = null; loadBatches(true);
      } else {
        $("admin-error").textContent = "Failed: " + ((r.body && r.body.error) || "unknown") +
          (r.body && r.body.detail ? " \u2014 " + r.body.detail : "");
        $("admin-error").hidden = false;
      }
    }).catch(function () {
      $("admin-error").textContent = "Request failed. Check your connection.";
      $("admin-error").hidden = false;
    });
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
