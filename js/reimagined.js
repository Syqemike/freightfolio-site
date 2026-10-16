/* Freightfolio - "Your Business. Reimagined." personalized preview.
   Visitor enters their business name + industry; we render a personalized
   mini-site in 4 switchable styles, desktop + phone previews side by side.
   Selections carry into the request form via URL params. */
(function () {
  "use strict";

  var form = document.getElementById("reimagined-form");
  if (!form) return;

  var stage = document.getElementById("reimagined-stage");
  var browser = document.getElementById("reimagined-browser");
  var desktopView = document.getElementById("reimagined-desktop-view");
  var phoneView = document.getElementById("reimagined-phone-view");
  var comboLabel = document.getElementById("reimagined-combo");
  var cta = document.getElementById("reimagined-cta");
  var styleButtons = document.querySelectorAll(".reimagined-styles button");

  var state = { name: "", category: "restaurant", style: "modern" };

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function navLinks() {
    return '<div class="m-links"><span>Services</span><span>About</span><span>Contact</span></div>';
  }

  /* Render a personalized mini-site. Same theme system as the Design Lab,
     but the business name is the visitor's. All other copy is clearly
     illustrative industry sample content. */
  function renderMini(name, category, style) {
    var cats = window.FF_CATEGORIES || {};
    var dirs = window.FF_DIRECTIONS || {};
    var c = cats[category] || cats.restaurant;
    var d = dirs[style] || dirs.modern;
    if (!c || !d) return "";
    var bizName = name || c.name;

    function cards(numbered) {
      return c.services.map(function (s, i) {
        var num = numbered ? '<div class="m-num">0' + (i + 1) + "</div>" : "";
        var inner = "<h5>" + esc(s.t) + "</h5><p>" + esc(s.d) + "</p>";
        return '<div class="m-card">' + num + (numbered ? "<div>" + inner + "</div>" : inner) + "</div>";
      }).join("");
    }
    function foot() {
      return '<div class="m-foot"><span>' + esc(c.foot) + "</span><span>" + esc(c.phone) + "</span></div>";
    }

    var html = "";
    if (style === "modern") {
      html =
        '<div class="mini ' + d.cls + '">' +
          '<div class="m-nav"><div class="m-logo">' + esc(bizName) + "</div>" + navLinks() + "</div>" +
          '<div class="m-hero"><h4>' + esc(c.headline) + " " + esc(c.headlineEm) + "</h4>" +
          "<p>" + esc(c.sub) + '</p><span class="m-btn">' + esc(c.cta) + "</span></div>" +
          '<div class="m-cards">' + cards(false) + "</div>" + foot() +
        "</div>";
    } else if (style === "luxury") {
      html =
        '<div class="mini ' + d.cls + '">' +
          '<div class="m-nav"><div class="m-logo">' + esc(bizName) + "</div></div>" +
          '<div class="m-hero"><div class="m-kicker">' + esc(c.kicker) + "</div>" +
          "<h4>" + esc(c.headline) + "<br>" + esc(c.headlineEm) + "</h4>" +
          '<div class="m-rule"></div><p>' + esc(c.sub) + "</p>" +
          '<span class="m-btn">' + esc(c.cta) + "</span></div>" +
          '<div class="m-cards">' + cards(false) + "</div>" +
          '<div class="m-foot">' + esc(bizName) + " · " + esc(c.phone) + "</div>" +
        "</div>";
    } else if (style === "bold") {
      html =
        '<div class="mini ' + d.cls + '">' +
          '<div class="m-nav"><div class="m-logo">' + esc(bizName) + "</div>" + navLinks() + "</div>" +
          '<div class="m-hero"><div class="m-kicker">' + esc(c.kicker) + "</div>" +
          "<h4>" + esc(c.headline) + " <em>" + esc(c.headlineEm) + "</em></h4>" +
          '<span class="m-btn">' + esc(c.cta) + "</span></div>" +
          '<div class="m-cards">' + cards(false) + "</div>" + foot() +
        "</div>";
    } else { /* minimal */
      html =
        '<div class="mini ' + d.cls + '">' +
          '<div class="m-nav"><div class="m-logo">' + esc(bizName) + "</div>" + navLinks() + "</div>" +
          '<div class="m-hero"><div class="m-kicker">' + esc(c.kicker) + "</div>" +
          "<h4>" + esc(c.headline) + " " + esc(c.headlineEm) + "</h4>" +
          "<p>" + esc(c.sub) + '</p><span class="m-btn">' + esc(c.cta) + " &rarr;</span></div>" +
          '<div class="m-cards">' + cards(true) + "</div>" + foot() +
        "</div>";
    }
    return html;
  }

  function render() {
    var html = renderMini(state.name, state.category, state.style);
    desktopView.innerHTML = html;
    phoneView.innerHTML = html;
    var dirs = window.FF_DIRECTIONS || {};
    var d = dirs[state.style];
    if (comboLabel && d) comboLabel.textContent = d.label;
    updateCta();
  }

  function updateCta() {
    var params = new URLSearchParams();
    params.set("business", state.name);
    params.set("industry", state.category);
    params.set("style", state.style);
    cta.href = "request.html?" + params.toString();
  }

  styleButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      styleButtons.forEach(function (b) {
        b.classList.remove("active");
        b.setAttribute("aria-pressed", "false");
      });
      btn.classList.add("active");
      btn.setAttribute("aria-pressed", "true");
      state.style = btn.getAttribute("data-style");
      /* Rebuild animation: quick pull-back and rebuild. */
      browser.classList.remove("rebuilding");
      void browser.offsetWidth;
      browser.classList.add("rebuilding");
      render();
    });
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var nameInput = document.getElementById("biz-name");
    var industrySelect = document.getElementById("biz-industry");
    var name = nameInput.value.trim().slice(0, 60);
    if (!name) {
      nameInput.focus();
      return;
    }
    state.name = name;
    state.category = industrySelect.value;
    state.style = "modern";
    styleButtons.forEach(function (b) {
      var active = b.getAttribute("data-style") === "modern";
      b.classList.toggle("active", active);
      b.setAttribute("aria-pressed", active ? "true" : "false");
    });

    /* Reveal the stage with the pull-back-and-rebuild transition. */
    stage.hidden = false;
    browser.classList.remove("rebuilding");
    render();
    stage.scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(function () {
      browser.classList.add("rebuilding");
    }, 450);
  });
})();
