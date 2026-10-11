(function () {
  "use strict";
  function init() {
    var btn = document.querySelector(".nav-toggle");
    var nav = document.getElementById("primary-nav");
    if (!btn || !nav) return;
    function setOpen(open) {
      nav.classList.toggle("open", open);
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      btn.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    }
    btn.addEventListener("click", function () {
      setOpen(!nav.classList.contains("open"));
    });
    nav.addEventListener("click", function (e) {
      if (e.target && e.target.tagName === "A") setOpen(false);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") setOpen(false);
    });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
