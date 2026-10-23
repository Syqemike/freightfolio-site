# DESIGN BRIEF — Le Bakery (le-bakery-402e2973cff3810fbb3cebdce)

Source brief (Website Dev 2026-10-22 21:58 CT), followed exactly:
Aesthetic: Vietnamese-French bakery warmth. Baguette gold #c98f2d + jade green #2e7d5b + cream #fbf5e9.
Typography: Fraunces (display) + Inter (body).
Layout: menu-board hero with banh mi (roast pork, meatball, lemongrass grilled pork, Vietnamese sausage, coconut curry, tofu), Vietnamese iced coffee ca phe sua da + boba/bubble tea, 12+ turnover varieties, butter croissants, French baguettes, praline pecan rolls, cinnamon rolls, cannoli, meat pies, wedding/occasion cakes, seasonal king cakes. Note "mostly $1-10" value line. Hours: Tue-Sat 9 AM-3 PM, Sun 9 AM-1 PM, Mon closed.
Address: 280 Oak St, Biloxi, MS 39530 (East Biloxi). Social proof: "18,262 Facebook followers" once (research-verified count).
CTA: "Call to order" tel:+12284360850.
Rating "4.8 from 420 Google reviews" shown once with exact source.
Photos: labeled stock banh mi/Vietnamese-bakery (Facebook photos login-walled; note shortfall). Distinct from Electrik Maid style: jade/gold editorial, not diner.

## Design execution
- Menu-board editorial: jade-framed hero with gold inner border, horizontal menu-highlight chips, four menu-board cards (banh mi / coffee and tea / breads and pastries / sweets and occasions), value banner "Most items are $1 to $10", three-photo gallery, visit section with hours table.
- menu.html: full menu board (all research-verified items; honest note that prices are not published, value line only).
- Mobile: single-column stack at 860px; rendered mobile inspection not available in this tooling, recorded NOT VERIFIED per standing waiver.

## Verified facts (from batch26-builder-data.json only)
- Business: Le Bakery; Bakery; Biloxi, MS (East Biloxi)
- Menu items (research-verified): banh mi roast pork, meatball, lemongrass grilled pork, Vietnamese sausage, coconut curry, tofu; Vietnamese iced coffee (ca phe sua da) with boba; bubble tea; che; banh bao, pate chaud, fried banana with sticky rice; 12+ turnover varieties; butter croissants; French baguettes; flavored loaves; praline pecan rolls; cinnamon rolls; cannoli; meat pies; wedding/occasion cakes; seasonal king cakes; vegan options. No item prices published; value line "mostly $1-10" used.
- Hours: Tue-Sat 9 AM-3 PM; Sun 9 AM-1 PM; Mon closed
- Address: 280 Oak St, Biloxi, MS 39530
- Phone: (228) 436-0850 — 5 public sources
- Facebook: facebook.com/LeBakeryBiloxi, 18,262 followers (shown once in hero)
- Rating: 4.8 from 420 Google reviews (shown once in hero)
- Website: none (Facebook only; le-bakery.weeblyte.com is a third-party directory page)

## Image provenance summary
See img/PROVENANCE.txt for full detail. All 5 photos STOCK (Pexels free license; real bakery photos are login-walled on Facebook):
- banhmi.jpg (index hero; Pexels 32961648, Hau Mai) — Vietnamese banh mi
- iced-coffee.jpg (gallery; Pexels 31957631, Soc Nang Dong) — Vietnamese iced coffee
- baguettes.jpg (gallery + menu.html; Pexels 4451380, Rene Terp) — fresh baguettes
- pastries.jpg (gallery; Pexels 19859269, Valeria Boltneva) — glazed pastries
- bakery-interior.jpg (visit section; Pexels 36445222, Yasin Onus) — baker at brick oven
Every photo labeled "Stock photo: ..." in its caption. No concept-art illustrations anywhere on the pages.

## Pre-submission checklist
- At least 3 photos loading: PASS (5 photos, all verified JPEG bytes, non-trivial size; index.html carries 5, menu.html carries 1)
- No concept-art illustrations: PASS (photographs only; no inline SVG art, no CSS-drawn graphics)
- Disclosure + business name + nav: PASS ("Design Preview" bar top of every page; business name in sticky header and hero; section nav present)
- CTAs verified: PASS (all CTAs are "Call to order" tel:+12284360850; no Book Now button)
- No invented facts / banned phrases / em dashes: PASS (menu items from research only; prices not invented; rating and Facebook follower count each shown once; em-dash grep clean on both pages)
- Design visually distinct: PASS (jade/gold menu-board editorial; distinct from the dental and jeweler builds)

Outstanding: rendered browser inspection not available to this builder; smoke verification is source/byte-level only. QA should do the live render check on staging.
