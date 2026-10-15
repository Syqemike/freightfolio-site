/* Freightfolio - portfolio showroom.
   Concept data reflects the actual published concept pages. All six are
   design previews only, never presented as client work. */
(function () {
  "use strict";

  var CONCEPTS = {
    "back-bone": {
      name: "Back Bone Tattoo",
      category: "Tattoo Studio",
      location: "Biloxi, Mississippi",
      url: "https://freightfolio.net/concepts/back-bone-tattoo-fb3ba1ceacad946e/",
      desktop: "img/showcase/back-bone-desktop.png",
      mobile: "img/showcase/back-bone-mobile.png",
      blurb: "A warm, no-attitude custom tattoo shop. Big photo gallery, reviews up front, walk-in hours impossible to miss.",
      features: [
        "Photo gallery of recent shop work",
        "Google reviews display (5.0 stars)",
        "Click-to-call phone number",
        "Walk-ins welcome notice",
        "Full weekly hours table",
        "Get Directions map link"
      ]
    },
    "southland": {
      name: "Southland Heating & Air",
      category: "HVAC Contractor",
      location: "Long Beach, Mississippi",
      url: "https://freightfolio.net/concepts/southland-heating-air-7184b4908fca8f9b/",
      desktop: "img/showcase/southland-desktop.png",
      mobile: "img/showcase/southland-mobile.png",
      blurb: "A contractor site built on trust: licensed, dealer-authorized, and thirty years of reputation on the first screen.",
      features: [
        "Service list with real job photos",
        "Equipment dealer badges (Trane, Mitsubishi, Ruud)",
        "License number displayed (MS #10416-SC)",
        "Customer reviews section",
        "Click-to-call service line",
        "Business hours table"
      ]
    },
    "twisted": {
      name: "Twisted Addictions",
      category: "Tattoo & Piercing",
      location: "Kenner, Louisiana",
      url: "https://freightfolio.net/concepts/twisted-addictions-41b027c1146c0f88/",
      desktop: "img/showcase/twisted-desktop.png",
      mobile: "img/showcase/twisted-mobile.png",
      blurb: "Bold shop energy with personality: artist profiles, piercing services, and a Facebook link for messages.",
      features: [
        "Photo gallery from the chairs",
        "Artist profiles (Sofi, Autumn)",
        "Service tags: cover-ups, portraits, flash, piercings",
        "Review highlights (4.8 stars)",
        "Facebook page link",
        "Click-to-call phone number"
      ]
    },
    "velvet": {
      name: "Velvet Touch Pet Spa",
      category: "Pet Grooming, Boarding & Daycare",
      location: "Denham Springs, Louisiana",
      url: "https://freightfolio.net/concepts/velvet-touch-pet-spa-511586f420d232fb/",
      desktop: "img/showcase/velvet-desktop.png",
      mobile: "img/showcase/velvet-mobile.png",
      blurb: "Playful and polished: three services, happy-client photos, and a booking call-to-action on every screen.",
      features: [
        "Service cards (grooming, boarding, daycare)",
        "Happy-client photo gallery",
        "Facebook reviews display (4.7 stars)",
        "Facebook follow link",
        "Call-to-book call-to-action",
        "Weekly hours table"
      ]
    },
    "eastern-shore": {
      name: "Eastern Shore Barber Shop",
      category: "Barber Shop",
      location: "Daphne, Alabama",
      url: "https://freightfolio.net/concepts/eastern-shore-barber-7d168e709ec13135/",
      desktop: "img/showcase/eastern-shore-desktop.png",
      mobile: "img/showcase/eastern-shore-mobile.png",
      blurb: "A classic barbershop menu: straight prices, bookable services, and the barbers introduced by name.",
      features: [
        "Service menu with real prices",
        "Booksy online booking link",
        "Barber profiles (Chris, Jose, Alex, Corky)",
        "Team and shop photo gallery",
        "Facebook reviews (5.0 stars)",
        "Two locations with hours"
      ]
    },
    "k9-paws": {
      name: "K-9 Paws",
      category: "Pet Groomer",
      location: "Gulfport, Mississippi",
      url: "https://freightfolio.net/concepts/k9-paws-038b25f4ce68/",
      desktop: "img/showcase/k9-paws-desktop.png",
      mobile: "img/showcase/k9-paws-mobile.png",
      blurb: "Decades of grooming experience, front and center: credentials, services, and reviews from local dog owners.",
      features: [
        "Service list (full groom, bath, cuts, nails)",
        "Fresh-from-the-table photo gallery",
        "Google reviews from dog owners",
        "Credential highlights (Master Groomer)",
        "Click-to-call booking line",
        "Weekly hours table"
      ]
    }
  };

  var backdrop = document.getElementById("conceptModal");
  if (!backdrop) return;

  var shotImg = backdrop.querySelector("[data-modal-shot]");
  var titleEl = backdrop.querySelector("[data-modal-title]");
  var tagEl = backdrop.querySelector("[data-modal-tag]");
  var locEl = backdrop.querySelector("[data-modal-location]");
  var blurbEl = backdrop.querySelector("[data-modal-blurb]");
  var featEl = backdrop.querySelector("[data-modal-features]");
  var demoBtn = backdrop.querySelector("[data-modal-demo]");
  var deviceBtns = backdrop.querySelectorAll(".device-toggle button");
  var current = null;
  var mode = "desktop";

  function setShot() {
    if (!current) return;
    shotImg.src = mode === "desktop" ? current.desktop : current.mobile;
    shotImg.alt = current.name + " website concept, " + mode + " view";
  }

  function openModal(key) {
    current = CONCEPTS[key];
    if (!current) return;
    mode = "desktop";
    deviceBtns.forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-device") === "desktop");
    });
    setShot();
    titleEl.textContent = current.name;
    tagEl.textContent = current.category;
    locEl.textContent = current.location;
    blurbEl.textContent = current.blurb;
    featEl.innerHTML = "";
    current.features.forEach(function (f) {
      var li = document.createElement("li");
      li.textContent = f;
      featEl.appendChild(li);
    });
    demoBtn.href = current.url;
    backdrop.classList.add("open");
    document.body.style.overflow = "hidden";
    var close = backdrop.querySelector(".modal-close");
    if (close) close.focus();
  }

  function closeModal() {
    backdrop.classList.remove("open");
    document.body.style.overflow = "";
    current = null;
  }

  document.querySelectorAll(".concept-card").forEach(function (card) {
    card.addEventListener("click", function () {
      openModal(card.getAttribute("data-concept"));
    });
    card.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openModal(card.getAttribute("data-concept"));
      }
    });
  });

  deviceBtns.forEach(function (b) {
    b.addEventListener("click", function (e) {
      e.stopPropagation();
      mode = b.getAttribute("data-device");
      deviceBtns.forEach(function (x) { x.classList.toggle("active", x === b); });
      setShot();
    });
  });

  backdrop.querySelector(".modal-close").addEventListener("click", closeModal);
  backdrop.addEventListener("click", function (e) {
    if (e.target === backdrop) closeModal();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && backdrop.classList.contains("open")) closeModal();
  });
})();
