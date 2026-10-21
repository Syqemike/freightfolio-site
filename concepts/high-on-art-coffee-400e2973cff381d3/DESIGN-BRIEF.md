# Design Brief: High on Art & Coffee

**Business:** High on Art & Coffee, 523 E High St, Lexington, KY 40502 | (859) 576-3981
**Rating:** 5.0 from 125 Google reviews (shown exactly once, hero rating badge). Restaurantji 4.9/222 exists but is not shown on the page.
**Hours:** Mon-Fri 8:00 AM - 4:00 PM; Sat 10:00 AM - 4:00 PM; Sun closed (Google, Restaurantji, and business site agree).
**Service facts used:** fair-trade organic coffee drinks (mocha, Chailine chai latte, matcha), milkshakes, cafe food (Crangarine Turkey Club, LGBT Sandwich, avocado toast, bagels, salads, blueberry waffles, seasonal soups, chicken salad); takeout available; pet-friendly patio; 100+ local artists in-store; tips split with charities. No email found publicly; no online ordering, so CTAs are tel:.
**CTA:** "Call to Order Takeout" / "Call Now" -> tel:+18595763981 (no verified online ordering).

## Creative direction
ART GALLERY CAFE. Warm paper background (#faf4e8) with gallery accents: terracotta, teal, gold, rose. Fraunces display serif with italic color-blocked headline + Karla body. Hard-shadow sticker buttons, tilted hero photo with teal offset shadow, scrolling marquee strip, chalkboard-style menu cards, dark artists section with gold rules. Playful but polished; nothing like the dark barbershop concepts.

## Structure
Disclosure bar -> sticky nav (brand, 4 links, call button) -> hero grid (kicker, color-blocked h1, lede, rating badge once, 2 CTAs, tilted hero photo) -> marquee strip -> menu (3 category cards) -> dark art/community section (gallery photo + 3 give-back cards) -> 4-photo gallery (all labeled stock) -> visit (hours card + teal contact card) -> footer disclaimer.

## Photo provenance
No real business photos publicly retrievable. 5 Pexels stock photos, every caption honestly labeled "Stock photo". See img/PROVENANCE.txt.

## QA notes
- 5 stock photos in img/photo-1..5.jpg, all load (relative paths).
- No em/en dashes, no banned phrases, no "No X, no Y" triples, no reservation/demand promises (verified by grep + read).
- Rating shown exactly once with source and count. tel: links correct.
- Single h1; noindex meta; viewport meta.
- Desktop + mobile renders inspected; cross-site comparison vs recent Freightfolio concepts: gallery-cafe palette and sticker-button language are distinct.
