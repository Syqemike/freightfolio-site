# Design Brief: Boujee Nails & Spa

**Business:** Boujee Nails & Spa, 7927 Vaughn Rd, Montgomery, AL | (334) 647-2466
**Rating:** 5.0 from 159 Google reviews (shown exactly once, hero rating badge).
**Hours:** Mon-Sat 9:00 AM - 7:00 PM; Sun 12:00 PM - 6:00 PM (Google).
**Service facts used:** pedicures, acrylic nails, nail art, dip powder nails, gel nail extensions; walk-ins and appointments welcome; tagline "A Brush of Perfection & Defining NAILS BEAUTY. Extravagant, Friendly Nail Service at an Affordable Price." (from Google listing); named tech Benjamin Tran (from reviews). boujeenails.com and Boujee Nails in other states are different businesses and are not referenced.
**CTA:** "Call to Book" -> tel:+13346472466 (no online booking verified).

## Creative direction
CHIC LUXE. Blush pink (#f7dfe5) + ink black + gold. Cormorant Garamond italic-accented display + Jost body. Arched hero photo with overlapping polaroid, numbered service ledger, dark plum technician section, pill buttons, soft shadows. Editorial beauty-magazine feel; nothing like the industrial or nautical concepts.

## Structure
Disclosure bar -> sticky nav -> blush hero (kicker, italic-accented h1, tagline quote, lede, rating once, CTAs, arched photo collage) -> numbered service ledger (6 services) + walk-in callout -> dark tech section (Benjamin Tran) -> 3-photo gallery (labeled stock) -> hours/salon cards -> plum CTA band -> footer disclaimer.

## Photo provenance
No real business photos publicly retrievable. 5 Pexels stock photos, every caption honestly labeled "Stock photo". See img/PROVENANCE.txt.

## QA notes
- 5 stock photos in img/photo-1..5.jpg, all load (relative paths).
- No em/en dashes, no banned phrases, no "No X, no Y" triples, no invented services or prices (verified by grep + read).
- Rating shown exactly once with source and count. tel: links correct.
- Single h1; noindex meta; viewport meta.
- Desktop + mobile renders inspected; cross-site comparison: blush-luxe editorial identity is distinct from all prior concepts.
