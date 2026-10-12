// Bundle toggle: "Add Missing-Document Recovery" checkbox on pricing tiers.
// When checked, the subscribe button switches to the bundle payment link
// (base plan + Recovery add-on in one checkout) and the label shows the total.
(function () {
  var BUNDLE_TOTALS = { starter: "$138/mo", business: "$248/mo", premium: "$468/mo" };
  document.querySelectorAll('input[data-bundle]').forEach(function (box) {
    box.addEventListener("change", function () {
      var card = box.closest(".price-card");
      if (!card) return;
      var btn = card.querySelector("a.btn[data-base-href]");
      if (!btn) return;
      if (box.checked) {
        var bundleHref = btn.getAttribute("data-bundle-href");
        if (!bundleHref || bundleHref.indexOf("BUNDLE_") === 0) return;
        btn.href = bundleHref;
        btn.textContent = btn.getAttribute("data-base-label") + " + Recovery (" + BUNDLE_TOTALS[box.getAttribute("data-bundle")] + ")";
      } else {
        btn.href = btn.getAttribute("data-base-href");
        btn.textContent = btn.getAttribute("data-base-label");
      }
    });
  });
})();
