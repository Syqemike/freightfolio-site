/* Freightfolio - Design Lab template engine.
   7 business categories x 4 design directions = 28 live mini-website previews.
   Direction changes palette + typography + layout. Category changes content. */
(function () {
  "use strict";

  var CATEGORIES = {
    restaurant: {
      label: "Restaurant",
      name: "The Salty Anchor",
      kicker: "Seafood Kitchen",
      headline: "Fresh from the Gulf,",
      headlineEm: "on your plate tonight.",
      sub: "Dock-to-table seafood, cold drinks, and a porch built for long evenings.",
      services: [
        { t: "Fresh Catch Menu", d: "Daily specials based on what the boats bring in." },
        { t: "Private Events", d: "Book the back room for parties up to forty guests." },
        { t: "Weekend Specials", d: "Oyster nights and live music every Friday." }
      ],
      cta: "See the menu",
      foot: "Tue-Sun · 11am-9pm",
      phone: "(228) 555-0142"
    },
    contractor: {
      label: "Contractor",
      name: "Coastline Builders",
      kicker: "General Contractor",
      headline: "Built right.",
      headlineEm: "Finished on time.",
      sub: "Remodels, additions, and storm repairs from a crew that shows up.",
      services: [
        { t: "Kitchen Remodels", d: "From layout to final walkthrough, handled start to finish." },
        { t: "Home Additions", d: "Extra rooms that look like they were always there." },
        { t: "Storm Repair", d: "Fast, solid repairs after Gulf weather does its worst." }
      ],
      cta: "Get a free estimate",
      foot: "Mon-Fri · 7am-5pm",
      phone: "(228) 555-0117"
    },
    barber: {
      label: "Barber / Salon",
      name: "Sharp Edge Barbers",
      kicker: "Barbershop",
      headline: "Look sharp.",
      headlineEm: "Feel sharper.",
      sub: "Classic cuts, hot towel shaves, and zero waiting around.",
      services: [
        { t: "Classic Cuts", d: "Precision cuts tailored to your style, every time." },
        { t: "Hot Towel Shaves", d: "Straight-razor shaves the old-fashioned way." },
        { t: "Beard Sculpting", d: "Shape, detail, and condition for a clean finish." }
      ],
      cta: "Book a chair",
      foot: "Tue-Sat · 9am-6pm",
      phone: "(228) 555-0189"
    },
    pet: {
      label: "Pet services",
      name: "Happy Tails Grooming",
      kicker: "Pet Grooming",
      headline: "Your dog will",
      headlineEm: "strut out of here.",
      sub: "Gentle, experienced grooming for dogs of every size.",
      services: [
        { t: "Full Grooming", d: "Bath, cut, nails, and finishing touches." },
        { t: "Bath & Brush", d: "A deep clean that leaves coats soft and fresh." },
        { t: "Nail Care", d: "Quick, careful trims that keep paws healthy." }
      ],
      cta: "Book a groom",
      foot: "Mon-Fri · 8am-4pm",
      phone: "(228) 555-0163"
    },
    automotive: {
      label: "Automotive",
      name: "Gulf Auto Care",
      kicker: "Auto Repair",
      headline: "Fixed right",
      headlineEm: "the first time.",
      sub: "Honest diagnostics and fair prices from local mechanics.",
      services: [
        { t: "Oil & Maintenance", d: "Scheduled service that keeps your car running longer." },
        { t: "Brake Service", d: "Pads, rotors, and inspections you can trust." },
        { t: "Diagnostics", d: "We find the real problem before we quote the fix." }
      ],
      cta: "Schedule service",
      foot: "Mon-Fri · 8am-5pm",
      phone: "(228) 555-0128"
    },
    professional: {
      label: "Professional services",
      name: "Harbor & Pine Law",
      kicker: "Law Firm",
      headline: "Clear counsel",
      headlineEm: "when it matters.",
      sub: "Contracts, estate planning, and small business law.",
      services: [
        { t: "Free Consultations", d: "Talk through your situation before you commit." },
        { t: "Contract Review", d: "Plain-language review of what you are signing." },
        { t: "Estate Planning", d: "Wills and documents that protect your family." }
      ],
      cta: "Request a consultation",
      foot: "Mon-Fri · 9am-5pm",
      phone: "(228) 555-0174"
    },
    other: {
      label: "Other",
      name: "Cornerstone Home Services",
      kicker: "Local Services",
      headline: "One call",
      headlineEm: "handles it all.",
      sub: "Repairs, installations, and seasonal checkups for your home.",
      services: [
        { t: "Home Repairs", d: "Small jobs and big fixes, done in one visit when possible." },
        { t: "Installations", d: "Fixtures, fans, and fittings installed cleanly." },
        { t: "Seasonal Checkups", d: "Stay ahead of problems before each season turns." }
      ],
      cta: "Get a free quote",
      foot: "Mon-Sat · 8am-6pm",
      phone: "(228) 555-0151"
    }
  };

  var DIRECTIONS = {
    modern:   { label: "Modern",  cls: "mini-modern" },
    luxury:   { label: "Luxury",  cls: "mini-luxury" },
    bold:     { label: "Bold",    cls: "mini-bold" },
    minimal:  { label: "Minimal", cls: "mini-minimal" }
  };

  var state = { category: "restaurant", direction: "modern" };

  var stage = document.getElementById("labStage");
  var comboLabel = document.getElementById("labCombo");
  if (!stage) return;

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function navLinks() {
    return '<div class="m-links"><span>Services</span><span>About</span><span>Contact</span></div>';
  }

  function render() {
    var c = CATEGORIES[state.category];
    var d = DIRECTIONS[state.direction];
    var html = "";

    if (state.direction === "modern") {
      html =
        '<div class="mini ' + d.cls + '">' +
          '<div class="m-nav"><div class="m-logo">' + esc(c.name) + '</div>' + navLinks() + '</div>' +
          '<div class="m-hero"><h4>' + esc(c.headline) + ' ' + esc(c.headlineEm) + '</h4>' +
          '<p>' + esc(c.sub) + '</p><span class="m-btn">' + esc(c.cta) + '</span></div>' +
          '<div class="m-cards">' +
            c.services.map(function (s) {
              return '<div class="m-card"><h5>' + esc(s.t) + '</h5><p>' + esc(s.d) + '</p></div>';
            }).join("") +
          '</div>' +
          '<div class="m-foot"><span>' + esc(c.foot) + '</span><span>' + esc(c.phone) + '</span></div>' +
        '</div>';
    } else if (state.direction === "luxury") {
      html =
        '<div class="mini ' + d.cls + '">' +
          '<div class="m-nav"><div class="m-logo">' + esc(c.name) + '</div></div>' +
          '<div class="m-hero"><div class="m-kicker">' + esc(c.kicker) + '</div>' +
          '<h4>' + esc(c.headline) + '<br>' + esc(c.headlineEm) + '</h4>' +
          '<div class="m-rule"></div><p>' + esc(c.sub) + '</p>' +
          '<span class="m-btn">' + esc(c.cta) + '</span></div>' +
          '<div class="m-cards">' +
            c.services.map(function (s) {
              return '<div class="m-card"><h5>' + esc(s.t) + '</h5><p>' + esc(s.d) + '</p></div>';
            }).join("") +
          '</div>' +
          '<div class="m-foot">' + esc(c.name) + ' · ' + esc(c.phone) + '</div>' +
        '</div>';
    } else if (state.direction === "bold") {
      html =
        '<div class="mini ' + d.cls + '">' +
          '<div class="m-nav"><div class="m-logo">' + esc(c.name) + '</div>' + navLinks() + '</div>' +
          '<div class="m-hero"><div class="m-kicker">' + esc(c.kicker) + '</div>' +
          '<h4>' + esc(c.headline) + ' <em>' + esc(c.headlineEm) + '</em></h4>' +
          '<span class="m-btn">' + esc(c.cta) + '</span></div>' +
          '<div class="m-cards">' +
            c.services.map(function (s) {
              return '<div class="m-card"><h5>' + esc(s.t) + '</h5><p>' + esc(s.d) + '</p></div>';
            }).join("") +
          '</div>' +
          '<div class="m-foot"><span>' + esc(c.foot) + '</span><span>' + esc(c.phone) + '</span></div>' +
        '</div>';
    } else { /* minimal */
      html =
        '<div class="mini ' + d.cls + '">' +
          '<div class="m-nav"><div class="m-logo">' + esc(c.name) + '</div>' + navLinks() + '</div>' +
          '<div class="m-hero"><div class="m-kicker">' + esc(c.kicker) + '</div>' +
          '<h4>' + esc(c.headline) + ' ' + esc(c.headlineEm) + '</h4>' +
          '<p>' + esc(c.sub) + '</p><span class="m-btn">' + esc(c.cta) + ' &rarr;</span></div>' +
          '<div class="m-cards">' +
            c.services.map(function (s, i) {
              return '<div class="m-card"><div class="m-num">0' + (i + 1) + '</div>' +
                     '<div><h5>' + esc(s.t) + '</h5><p>' + esc(s.d) + '</p></div></div>';
            }).join("") +
          '</div>' +
          '<div class="m-foot"><span>' + esc(c.foot) + '</span><span>' + esc(c.phone) + '</span></div>' +
        '</div>';
    }

    stage.querySelector(".lab-viewport").innerHTML = html;
    if (comboLabel) {
      comboLabel.textContent = c.label + " × " + d.label;
    }
  }

  function wireGroup(groupId, key) {
    var group = document.getElementById(groupId);
    if (!group) return;
    group.addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-value]");
      if (!btn) return;
      state[key] = btn.getAttribute("data-value");
      group.querySelectorAll("button").forEach(function (b) {
        b.classList.toggle("active", b === btn);
        b.setAttribute("aria-pressed", b === btn ? "true" : "false");
      });
      render();
    });
  }

  wireGroup("labCategories", "category");
  wireGroup("labDirections", "direction");

  var viewport = stage.querySelector(".lab-viewport");
  document.querySelectorAll("[data-viewport]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var mobile = btn.getAttribute("data-viewport") === "mobile";
      viewport.classList.toggle("mobile", mobile);
      document.querySelectorAll("[data-viewport]").forEach(function (b) {
        b.classList.toggle("active", b === btn);
      });
    });
  });

  render();
})();
