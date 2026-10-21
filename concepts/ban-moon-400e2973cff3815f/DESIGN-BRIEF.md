# Design Brief: Ban Moon

**Business:** Ban Moon, 405 W Ave N, San Angelo, TX 76903 | (325) 703-6156
**Rating:** 4.7 from 151 Google reviews (shown exactly once, hero rating line).
**Hours:** Mon-Fri 11:00 AM - 9:00 PM; Sat-Sun closed (Google + Wanderlog agree; one source conflicts, so the page notes the conflict and says to call to confirm).
**Service facts used:** authentic Lao & Thai cuisine; menu: crab rangoon, drunken noodles, pad thai, red curry, sweet and sour chicken, pad kra pao, beef pho (meatball/brisket/combination), tom yum/tom kha soups, lao sausage, chicken satay, fried egg rolls; takeout and delivery offered; wheelchair accessible; moderate prices. No food-safety or cleanliness claims anywhere (per research flag). No online ordering verified, so CTAs are tel:.
**CTA:** "Call for Takeout" -> tel:+13257036156.

## Creative direction
LAO-THAI KITCHEN. Deep chili red (#a31621) + gold (#d9a441) + cream + dark ink. Fraunces 900 display + Public Sans body. Split-screen hero (red copy panel / full-bleed food photo), ornamental dividers, menu as three bordered category cards, dark story section with gold rules, green takeout band. Menu-centered and warm; nothing like the garage, law-firm, or cafe concepts.

## Structure
Disclosure bar -> cream sticky nav -> split hero (tag, h1, lede, rating once, 2 CTAs, full-bleed photo) -> menu (3 category cards) -> dark kitchen-story section with 4-photo pad thai gallery (all labeled stock) -> hours/location cards -> green takeout CTA band -> footer disclaimer.

## Photo provenance
No real business photos publicly retrievable. 5 Pexels stock photos of pad thai dishes, every caption honestly labeled "Stock photo". See img/PROVENANCE.txt.

## QA notes
- 5 stock photos in img/photo-1..5.jpg, all load (relative paths).
- No em/en dashes, no banned phrases, no "No X, no Y" triples, no invented dishes/prices, no cleanliness claims (verified by grep + read).
- Rating shown exactly once with source and count. tel: links correct.
- Single h1; noindex meta; viewport meta.
- Desktop + mobile renders inspected; cross-site comparison: chili/gold restaurant identity is distinct from all prior concepts.
