# DESIGN BRIEF — Sushi-Lito Food Truck (batch 27, run 2026-10-22)

Business: Sushi-Lito Food Truck, Sonoran-style (Caborca-style) sushi food truck, 5422 S 12th Ave, Tucson, AZ 85706. Phone (520) 639-4863, email sushilito20@gmail.com. Hours: Mon closed; Tue-Thu 2:00-9:30 PM; Fri 2:00-9:00 PM; Sat 2:00-9:30 PM; Sun 2:00-9:00 PM. Google-aggregated 5.0 / 15 reviews (shown once per page). Menu items and prices taken from the business's own posted menu graphics (streetfoodfinder profile menu + restaurantji menu-board photo), not invented. Call-ahead ordering recommended per research notes. No verified online booking destination, so no "Book Now" CTA anywhere; Call and email CTAs only.

## Concept
"Desert-night street stall": the truck works after sunset (2 PM onward, closing 9-9:30 PM), and the strongest real photos show the red truck glowing at night under string lights with a lit OPEN sign. The site leans into that: a dark, warm, night-market mood with neon-red energy, chunky confident type, and a scrolling roll-name ticker like a hand-painted truck menu board.

## Aesthetic
Bold Sonoran street-food confidence. Dark charcoal-brown canvas, brand-red accents lifted from the truck itself, cream text, amber highlights like string lights. No minimalism-by-default; this is a truck that shouts its menu from the roadside.

## Typography
- Display: "Archivo Black" (Google Fonts) — heavy, poster-like headlines.
- Body/UI: "Inter" (Google Fonts) — clean, readable contrast.
- Sizes mobile-first; hero headline scales with clamp().

## Palette
- --night: #100c09 (near-black warm brown, page background)
- --panel: #1c1510 (raised panels/cards)
- --red: #e3322b (brand red from truck; CTAs, accents)
- --red-deep: #a81f1a (hover/pressed)
- --amber: #ffb547 (highlights, ticker, stars)
- --cream: #f6ecd9 (primary text)
- --sand: #b8a88f (muted text)
- Borders: hairline rgba(246,236,217,.14)

## Imagery (all real business photos, captioned; provenance in img/PROVENANCE.txt)
1. hero.jpg — worldlocationmap hero: the red Sushi-Lito truck at night, lit OPEN sign, outdoor seating. (index hero)
2. truck-dusk.jpg — foodtrucksworld: truck at dusk, "sushi ITO" wrap, diners at tables. (index About/Visit)
3. menu-graphic.jpg — streetfoodfinder business menu graphic: full menu with prices, food photos, logo, address, socials. (menu page evidence + index menu teaser)
4. menu-board.jpg — restaurantji menu-board photo. (menu page)
Photo captions identify real photos. No stock photos used; no illustrations anywhere.

## Layout (mobile-first; two pages: index.html, menu.html)
1. Preview bar (thin, amber): "WEBSITE CONCEPT — a design preview for Sushi-Lito Food Truck, not a live business site."
2. Sticky nav: SUSHI-LITO wordmark left; links Menu / Reviews / Hours / Find Us; "Call Now" red button (tel:+15206394863). Mobile hamburger (functional icon only).
3. Hero: full-bleed hero.jpg, dark gradient, eyebrow "SONORAN-STYLE SUSHI · TUCSON, AZ", H1 "Sushi-Lito Food Truck", lede line, Call CTA + "See the menu" ghost CTA, preview badge chip.
4. Marquee ticker (CSS text animation, amber on red): roll names.
5. About: "Sushi, Caborca style" — short grounded paragraph (fried rolls, cream cheese, buffalo chicken/carne asada fillings per Tucson Foodie coverage; the namesake Sushi-Lito Roll: cheese, breaded shrimp, imitation crab, Sriracha, eel sauce, scallions). truck-dusk.jpg beside.
6. Signature rolls: cards for Sushi-Lito Roll (the namesake, described), Monster Roll (fan favorite per reviews, "get the monster roll"), Caborca Roll, Tocino Roll, Vaquero, Boneless Roll — from research notes; prices from posted menu shown on menu page, not duplicated here.
7. Menu teaser: menu-board.jpg + "Full menu with prices" button to menu.html.
8. Reviews: single rating line used ONCE per page: "5.0 stars / 15 reviews (Google-aggregated listing)". Grounded review quotes from worldlocationmap ("get the monster roll", "my favorite sushi in all of Tucson") attributed as customer reviews from the listing.
9. Hours & Find Us: hours table (Mon closed), address 5422 S 12th Ave, Tucson, AZ 85706, "Get directions" link to Google Maps search, call-ahead note.
10. Contact/footer: Call button, email button, address, hours recap; footer carries preview disclosure + noindex (meta tag).
menu.html: full menu grouped as on the truck's posted menu (Sushi Natural/Empanizado $12; Sushi Especial with names/descriptions/prices; Extras; Combos; Charolas; Aperitivos; Bebidas) + menu-graphic.jpg as source evidence + Call CTA.

## Customer journey (mobile)
Arrive > see the truck at night, name, what it is (Sonoran sushi) > tap Call to order ahead > browse menu page > check hours/address > call again. Every screen keeps "Call" within one tap.

## Copy rules honored
No em dashes; no invented facts; rating appears exactly once per page with exact source and count; no comma triples, no "No X, no Y" triples, no banned AI phrases; plain direct sentences.

## Clipart status
No SVG illustrations, no CSS-drawn graphics, no generated art anywhere. Only real photos + functional hamburger/icon glyphs. Clipart check recorded in release record after render review.
