# Design Brief: Anna's Pies

**Business:** Anna's Pies, 2323 Moeling St, Lake Charles, LA 70601 | +1 337-436-1166
**Rating:** 4.8 from 45 Google reviews (shown exactly once, hero pill)
**Hours:** Mon-Fri 8 AM-5:30 PM; Sat/Sun not listed -> "Weekend hours are not listed. Call to confirm."
**Service facts used:** pies (peach bourbon, pecan), lemon creme cake, pigs in blankets, almond flour muffins; inexpensive pricing. Facebook page (facebook.com/Annas-Pies-116339558389920) could NOT be verified to resolve to this business (browser fetch denied), so NO Facebook link is included.
**CTA:** "Call to order" -> tel:+13374361166 (no verified online ordering)
**Negative constraints:** nothing about regulatory history anywhere; no food-safety/cleanliness claims.

## Creative direction
Warm rustic bakery. Fraunces serif + Work Sans, cream/cocoa/cherry/gold palette, double-rule gold borders framing the centered menu like a printed bakery card. Menu is the centerpiece section; hero pairs the headline with a peach pie photo and an offset gold frame.

## Structure
Disclosure bar -> sticky header (brand, nav, Call to order) -> hero (h1) -> MENU (centered) -> about -> gallery (5 stock photos across 6 slots, each captioned "Stock photo") -> hours + visit cards -> footer with full disclaimer + freightfolio.net.

## QA notes
- 5 stock photos downloaded to img/photo-1..5.jpg, all load (one Pexels ID failed the standard URL pattern and was replaced with 4407523).
- No em/en dashes, no banned phrases, no "No X, no Y" patterns (verified by grep). "What is baking" typo fixed to "What we are baking".
- Single h1; noindex meta; viewport meta.
- Desktop + mobile renders inspected: no overlaps, menu centered properly on both.
- Differentiation: warm rustic bakery layout (menu-first, centered) unlike the barber concepts and unlike the other three wave-c sites.
