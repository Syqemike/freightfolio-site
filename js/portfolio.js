/* Freightfolio - portfolio showroom.
   Concept data reflects the actual published concept pages. All sixteen are
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
    },
    "social-suite": {
      name: "The Social Suite",
      category: "Hair Salon",
      location: "Metairie, Louisiana",
      url: "https://freightfolio.net/concepts/the-social-suite-d49077bbe945d258/",
      desktop: "img/showcase/social-suite-thumb.jpg",
      mobile: "img/showcase/social-suite-thumb.jpg",
      blurb: "A salon built around what it does best: color. Stylist spotlight, real reviews, and booking front and center.",
      features: [
        "Color and balayage service menu",
        "Stylist spotlight section",
        "Google reviews display (4.9 stars)",
        "Photo gallery of salon work",
        "Click-to-call booking line",
        "Hours and location block"
      ]
    },
    "hotspot": {
      name: "Hotspot Barber & Beauty",
      category: "Barber & Beauty Salon",
      location: "New Orleans, Louisiana",
      url: "https://freightfolio.net/concepts/hotspot-barber-beauty-af2bb6590155198d/",
      desktop: "img/showcase/hotspot-thumb.jpg",
      mobile: "img/showcase/hotspot-thumb.jpg",
      blurb: "Built for the after-work crowd: late hours and walk-ins are the first thing you see.",
      features: [
        "Late-night hours highlighted",
        "Walk-ins welcome messaging",
        "Haircut and beauty service menu",
        "Google reviews display (4.6 stars)",
        "Click-to-call phone number",
        "Address with directions link"
      ]
    },
    "twiztid-monkey": {
      name: "Twiztid Monkey Ink",
      category: "Tattoo & Piercing",
      location: "Mobile, Alabama",
      url: "https://freightfolio.net/concepts/twiztid-monkey-ink-400e7b898f83f2cb/",
      desktop: "img/showcase/twiztid-monkey-thumb.jpg",
      mobile: "img/showcase/twiztid-monkey-thumb.jpg",
      blurb: "A shop page with real personality: the artist by name, the work up front, and a perfect review record.",
      features: [
        "Artist spotlight (Justin)",
        "Tattoo and piercing service menu",
        "Photo gallery of shop work",
        "Google reviews display (5.0 stars)",
        "Click-to-call phone number",
        "Hours and location block"
      ]
    },
    "lily-day-spa": {
      name: "Lily Day Spa",
      category: "Day Spa",
      location: "Mobile, Alabama",
      url: "https://freightfolio.net/concepts/lily-day-spa-ee7c2c7e9b6ca152/",
      desktop: "img/showcase/lily-day-spa-thumb.jpg",
      mobile: "img/showcase/lily-day-spa-thumb.jpg",
      blurb: "A calm, unhurried design for a day spa: services, honest pricing, and booking without the phone tag.",
      features: [
        "Massage and facial service menu",
        "Spa party packages",
        "Google reviews display (5.0 stars)",
        "Serene photo gallery",
        "Click-to-call booking line",
        "Open-daily hours table"
      ]
    },
    "old-spanish-trail": {
      name: "Old Spanish Trail Barber Shop",
      category: "Barber Shop",
      location: "Daphne, Alabama",
      url: "https://freightfolio.net/concepts/old-spanish-trail-barber-f5fe0d54399ca3eb/",
      desktop: "img/showcase/old-spanish-trail-thumb.jpg",
      mobile: "img/showcase/old-spanish-trail-thumb.jpg",
      blurb: "A heritage shop page: nearly four decades of classic cuts, with the family story told plainly.",
      features: [
        "Classic cut and shave menu",
        "Shop history section (est. 1987)",
        "Google reviews display (4.7 stars)",
        "Barbershop photo gallery",
        "Click-to-call phone number",
        "Hours and location block"
      ]
    },
    "coxs": {
      name: "Cox's Barber Shop",
      category: "Barber Shop",
      location: "Ocean Springs, Mississippi",
      url: "https://freightfolio.net/concepts/coxs-barber-shop-396c627653c23a10/",
      desktop: "img/showcase/coxs-thumb.jpg",
      mobile: "img/showcase/coxs-thumb.jpg",
      blurb: "Old-school and proud of it: traditional cuts, fair prices, and the number-system walk-in explained.",
      features: [
        "Traditional cut service menu",
        "Walk-in number system explained",
        "Google reviews display (4.7 stars)",
        "Shop photo gallery",
        "Click-to-call phone number",
        "Hours and location block"
      ]
    },
    "studio-601": {
      name: "Studio 601 Barbershop",
      category: "Barber Shop",
      location: "Biloxi, Mississippi",
      url: "https://freightfolio.net/concepts/studio-601-barbershop-614626f4a004308a/",
      desktop: "img/showcase/studio-601-thumb.jpg",
      mobile: "img/showcase/studio-601-thumb.jpg",
      blurb: "Modern and bookable: fades, designs, and beard work with online booking built in.",
      features: [
        "Fade, taper, and design menu",
        "Squire online booking link",
        "Google reviews display (5.0 stars)",
        "Barbershop photo gallery",
        "Click-to-call phone number",
        "Hours and location block"
      ]
    },
    "danes": {
      name: "Dane's Barber Shop",
      category: "Barber Shop",
      location: "Biloxi, Mississippi",
      url: "https://freightfolio.net/concepts/danes-barber-shop-a6e930da538d0c3c/",
      desktop: "img/showcase/danes-thumb.jpg",
      mobile: "img/showcase/danes-thumb.jpg",
      blurb: "A proper old-school shop page: classic cuts, straight-razor shaves, and seven-day hours.",
      features: [
        "Classic cut and shave menu",
        "Seven-day hours table",
        "Google reviews display (4.8 stars)",
        "Shop photo gallery",
        "Click-to-call booking line",
        "Pass Road location block"
      ]
    },
    "guhdyvah": {
      name: "Guhdyvah Twenty-6",
      category: "Braid Studio",
      location: "Metairie, Louisiana",
      url: "https://freightfolio.net/concepts/guhdyvah-twenty-6-593aa0657753f61f/",
      desktop: "img/showcase/guhdyvah-thumb.jpg",
      mobile: "img/showcase/guhdyvah-thumb.jpg",
      blurb: "A braid specialist page with the receipts: 237 five-star reviews and a style gallery.",
      features: [
        "Braid style menu (knotless, boho, silk press)",
        "Style photo gallery",
        "Setmore reviews display (5.0 stars)",
        "Setmore online booking link",
        "Click-to-call phone number",
        "Salon suite location block"
      ]
    },
    "jerome-johnson": {
      name: "Jerome Johnson",
      category: "Barber",
      location: "Mobile, Alabama",
      url: "https://freightfolio.net/concepts/jerome-johnson-06e8ec87ff6750cc/",
      desktop: "img/showcase/jerome-johnson-thumb.jpg",
      mobile: "img/showcase/jerome-johnson-thumb.jpg",
      blurb: "A personal brand page for a single-chair barber: his work, his reviews, his booking link.",
      features: [
        "Haircut and beard service menu",
        "Kids cuts section",
        "Booksy reviews display (5.0 stars)",
        "Booksy online booking link",
        "First-person bio section",
        "Airport Blvd location block"
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
