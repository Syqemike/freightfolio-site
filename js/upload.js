(function () {
  "use strict";

  var MAX_FILES = 10;
  var MAX_BYTES = 25 * 1024 * 1024;

  // ---- Token handling: order id is decoded from the token itself. ----
  function getToken() {
    var m = /[?&]t=([^&]+)/.exec(location.search);
    return m ? decodeURIComponent(m[1]) : "";
  }
  function b64urlDecodeToString(s) {
    var b = s.replace(/-/g, "+").replace(/_/g, "/");
    b += "=".repeat((4 - (b.length % 4)) % 4);
    var bin = atob(b), out = "";
    for (var i = 0; i < bin.length; i++) out += String.fromCharCode(bin.charCodeAt(i));
    return decodeURIComponent(escape(out));
  }
  function orderIdFromToken(token) {
    try {
      var seg = token.slice(4).split(".")[0];
      return b64urlDecodeToString(seg);
    } catch (e) { return ""; }
  }

  var token = getToken();
  var orderId = token ? orderIdFromToken(token) : "";

  var el = function (id) { return document.getElementById(id); };
  var checking = el("up-checking"), badlink = el("up-badlink"), doneAlready = el("up-done-already"),
      main = el("up-main"), confirmBox = el("up-confirm"),
      dropzone = el("up-dropzone"), fileInput = el("up-input"), fileList = el("up-files"),
      startBtn = el("up-start"), countHint = el("up-count");

  var queue = []; // {file, state, progress, error, sha256, putUrl, key, contentType}
  var allowance = MAX_FILES;

  function show(node) {
    [checking, badlink, doneAlready, main, confirmBox].forEach(function (n) { n.hidden = true; });
    node.hidden = false;
  }

  // ---- Magic-byte sniffing: never trust the extension alone. ----
  function detectType(buf) {
    var b = new Uint8Array(buf);
    function starts(sig) { for (var i = 0; i < sig.length; i++) if (b[i] !== sig[i]) return false; return true; }
    if (starts([0x25, 0x50, 0x44, 0x46])) return { type: "pdf", mime: "application/pdf" };
    if (starts([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])) return { type: "png", mime: "image/png" };
    if (starts([0xFF, 0xD8, 0xFF])) return { type: "jpg", mime: "image/jpeg" };
    return null;
  }

  function fmtBytes(n) {
    if (n >= 1048576) return (n / 1048576).toFixed(1) + " MB";
    return Math.max(1, Math.round(n / 1024)) + " KB";
  }

  function render() {
    fileList.innerHTML = "";
    queue.forEach(function (item, idx) {
      var li = document.createElement("li");
      li.className = "file-row";
      var statusText = "", statusClass = "working";
      if (item.state === "ready") { statusText = "Ready"; }
      else if (item.state === "hashing") { statusText = "Checking\u2026"; }
      else if (item.state === "uploading") { statusText = "Uploading"; }
      else if (item.state === "done") { statusText = "Uploaded"; statusClass = "ok"; }
      else if (item.state === "error") { statusText = "Failed"; statusClass = "err"; }
      else if (item.state === "invalid") { statusText = "Rejected"; statusClass = "err"; }

      li.innerHTML =
        '<div class="file-top">' +
          '<span class="file-name"></span>' +
          '<span class="file-size">' + fmtBytes(item.file.size) + '</span>' +
          '<span class="file-status ' + statusClass + '">' + statusText + "</span>" +
        "</div>" +
        '<div class="progress"><div class="' + (item.state === "done" ? "done" : "") + '" style="width:' + item.progress + '%"></div></div>' +
        (item.error ? '<div class="file-error"></div>' : "") +
        (item.state === "error" ? '<button class="btn btn-outline retry-btn" data-retry="' + idx + '">Retry</button>' : "");
      li.querySelector(".file-name").textContent = item.file.name;
      if (item.error) li.querySelector(".file-error").textContent = item.error;
      fileList.appendChild(li);
    });
    var retryBtns = fileList.querySelectorAll("[data-retry]");
    retryBtns.forEach(function (b) {
      b.addEventListener("click", function () { retryItem(Number(b.getAttribute("data-retry"))); });
    });

    var readyCount = queue.filter(function (q) { return q.state === "ready" || q.state === "error"; }).length;
    var remaining = allowance - 0; // allowance enforced server-side; client caps at MAX_FILES
    startBtn.disabled = readyCount === 0 || busy;
    countHint.textContent = queue.length === 0
      ? "No files selected yet."
      : queue.length + " of " + Math.min(MAX_FILES, allowance) + " files selected.";
  }

  var busy = false;

  function addFiles(files) {
    var room = Math.min(MAX_FILES, allowance) - queue.length;
    Array.prototype.slice.call(files).forEach(function (f) {
      if (room <= 0) return;
      room--;
      var item = { file: f, state: "hashing", progress: 0, error: "", sha256: "", putUrl: "", key: "", contentType: "" };
      queue.push(item);
      // Validate magic bytes from the first 8 bytes.
      var reader = new FileReader();
      reader.onload = function () {
        var detected = detectType(reader.result);
        if (f.size > MAX_BYTES) {
          item.state = "invalid";
          item.error = "This file is over 25 MB. Please shrink it or split it and try again.";
        } else if (!detected) {
          item.state = "invalid";
          item.error = "This does not look like a PDF, JPG, or PNG file. Renamed files are rejected.";
        } else {
          item.state = "ready";
          item.detected = detected;
        }
        render();
      };
      reader.onerror = function () {
        item.state = "invalid";
        item.error = "Could not read this file.";
        render();
      };
      reader.readAsArrayBuffer(f.slice(0, 8));
    });
    render();
  }

  function sha256Hex(buf) {
    return crypto.subtle.digest("SHA-256", buf).then(function (d) {
      return Array.prototype.map.call(new Uint8Array(d), function (b) {
        return ("0" + b.toString(16)).slice(-2);
      }).join("");
    });
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
        else reject(new Error("Upload failed (HTTP " + xhr.status + "). Please retry."));
      };
      xhr.onerror = function () { reject(new Error("Network error during upload. Please retry.")); };
      xhr.send(file);
    });
  }

  function startUpload() {
    if (busy) return;
    busy = true;
    render();
    startBtn.disabled = true;
    startBtn.innerHTML = '<span class="spinner"></span>&nbsp; Working\u2026';

    var items = queue.filter(function (q) { return q.state === "ready" || q.state === "error"; });
    items.forEach(function (it) { it.state = "hashing"; it.error = ""; it.progress = 0; });
    render();

    // Step 1: hash every file, then ask the server for presigned URLs.
    var hashed = items.map(function (it) {
      return it.file.arrayBuffer().then(function (buf) { return sha256Hex(buf); }).then(function (h) {
        it.sha256 = h;
        return {
          filename: it.file.name,
          content_type: it.detected.mime,
          size_bytes: it.file.size,
          sha256: h
        };
      });
    });

    Promise.all(hashed).then(function (payload) {
      return fetch("/api/upload-init", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: token, order_id: orderId, files: payload })
      }).then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); });
    }).then(function (res) {
      var body = res.body || {};
      if (!body.ok) {
        throw new Error(body.error === "allowance_exhausted"
          ? "This order already has its full set of documents. Email us if you need to replace one."
          : "The server refused the upload request (" + (body.error || "unknown") + "). Please try again.");
      }
      var byHash = {};
      (body.uploads || []).forEach(function (u) { byHash[u.sha256] = u; });
      (body.rejected || []).forEach(function (r) {
        var hit = items.filter(function (it) { return it.file.name === r.filename; })[0];
        if (hit) {
          hit.state = "invalid";
          hit.error = r.reason === "duplicate_content"
            ? "This exact file was already uploaded for this order."
            : r.reason === "too_large"
              ? "This file is over 25 MB."
              : "The server rejected this file (" + r.reason + ").";
        }
      });
      items.forEach(function (it) {
        var u = byHash[it.sha256];
        if (u) { it.putUrl = u.put_url; it.key = u.key; it.contentType = u.required_content_type; }
        else if (it.state === "hashing") { it.state = "invalid"; it.error = "The server did not issue an upload URL for this file."; }
      });
      render();

      // Step 2: PUT each accepted file straight to private storage.
      var toUpload = items.filter(function (it) { return it.putUrl; });
      var chain = Promise.resolve();
      toUpload.forEach(function (it) {
        chain = chain.then(function () {
          it.state = "uploading";
          render();
          return putWithProgress(it.putUrl, it.file, it.contentType, function (p) {
            it.progress = p;
            render();
          }).then(function () {
            it.state = "done";
            it.progress = 100;
            render();
          }).catch(function (e) {
            it.state = "error";
            it.error = e.message;
            render();
          });
        });
      });
      return chain.then(function () { return toUpload; });
    }).then(function (toUpload) {
      var done = (toUpload || []).filter(function (it) { return it.state === "done"; });
      if (done.length === 0) {
        throw new Error("none_uploaded");
      }
      // Step 3: tell the server what landed so it can verify and record the batch.
      return fetch("/api/upload-complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: token,
          order_id: orderId,
          uploads: done.map(function (it) { return { sha256: it.sha256, key: it.key }; })
        })
      }).then(function (r) { return r.json(); }).then(function (body) {
        if (!body.ok) throw new Error("finalize_failed");
        return body;
      });
    }).then(function (body) {
      busy = false;
      el("up-confirm-order").textContent = body.order_id || orderId;
      el("up-confirm-text").textContent =
        "Thank you. We received " + body.received + " document" + (body.received === 1 ? "" : "s") +
        " and they passed our checks. Your report is on its way.";
      show(confirmBox);
      window.scrollTo(0, 0);
    }).catch(function (e) {
      busy = false;
      if (e && e.message === "none_uploaded") {
        startBtn.innerHTML = "Upload files";
        render();
        countHint.textContent = "No files completed. Fix the errors above and retry.";
        return;
      }
      startBtn.innerHTML = "Upload files";
      render();
      countHint.textContent = "Something went wrong (" + (e && e.message ? e.message : "unknown") + "). Retry, or email hello@freightfolio.net.";
    });
  }

  function retryItem(idx) {
    var it = queue[idx];
    if (!it || busy) return;
    it.state = "ready";
    it.error = "";
    it.putUrl = "";
    render();
    startUpload();
  }

  // ---- Page init: verify the link before showing the uploader. ----
  function init() {
    dropzone.addEventListener("click", function () { fileInput.click(); });
    dropzone.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); }
    });
    ["dragover", "dragenter"].forEach(function (ev) {
      dropzone.addEventListener(ev, function (e) { e.preventDefault(); dropzone.classList.add("dragover"); });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      dropzone.addEventListener(ev, function (e) { e.preventDefault(); dropzone.classList.remove("dragover"); });
    });
    dropzone.addEventListener("drop", function (e) {
      if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
    });
    fileInput.addEventListener("change", function () { addFiles(fileInput.files); fileInput.value = ""; });
    startBtn.addEventListener("click", startUpload);

    if (!token || !orderId) {
      el("up-badlink-text").textContent =
        "This page needs a valid upload link. Open the link from your payment confirmation email.";
      show(badlink);
      return;
    }

    fetch("/api/upload-status?token=" + encodeURIComponent(token) + "&order_id=" + encodeURIComponent(orderId))
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); })
      .then(function (res) {
        var b = res.body || {};
        if (!b.ok) {
          var reason = b.reason || b.error || "unknown";
          el("up-badlink-text").textContent = reason === "expired"
            ? "This upload link expired (links are valid for 7 days after payment). Email us and we will send a fresh one."
            : "This upload link is not valid (" + reason + "). Open the link from your payment confirmation email, or email us for a fresh one.";
          show(badlink);
          return;
        }
        if (b.status === "received" || b.status === "processing" || b.status === "delivered") {
          show(doneAlready);
          return;
        }
        allowance = b.allowance || MAX_FILES;
        var note = allowance < MAX_FILES
          ? "Add up to " + allowance + " documents"
          : "Add up to 10 documents";
        el("up-sub").innerHTML = note +
          " (PDF, JPG, or PNG, 25&nbsp;MB max each): rate confirmations, BOLs, PODs, and invoices. " +
          "Files go straight to private storage. Nothing is shared." +
          (b.received_count ? " You already have " + b.received_count + " on file." : "");
        show(main);
        render();
      })
      .catch(function () {
        el("up-badlink-text").textContent =
          "We could not check your link right now. Check your connection and reload, or email hello@freightfolio.net.";
        show(badlink);
      });
  }

  init();
})();
