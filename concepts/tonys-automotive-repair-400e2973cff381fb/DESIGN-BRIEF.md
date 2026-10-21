# Design Brief: Tony's Automotive Repair

**Business:** Tony's Automotive Repair, 857 Angliana Ave, Lexington, KY 40508 | (859) 254-2300
**Rating:** 4.6 from 11 Google reviews (shown exactly once, hero rating line).
**Hours:** Mon-Thu 8:00 AM - 6:30 PM (Google); sources vary, so the page labels hours as listed and says to call to confirm. Fri-Sun shown as "Not listed".
**Service facts used:** fuel system work, transmission work, brakes, gaskets/manifolds, general mechanical repair; accepts credit/debit cards; about 21 years in business; near UK/student housing. No menu/prices published.
**CTA:** "Call the Shop" / "Call Tony's" -> tel:+18592542300 (no online booking verified).

## Creative direction
HONEST GARAGE. Charcoal (#22252a) + safety orange (#f26a1b) + bone. Archivo Black condensed uppercase display + Inter body. Work-order aesthetic: numbered service ledger styled like a shop ticket, angled clip-path buttons, diagonal hazard-stripe texture in hero, trust cards with orange rules. Industrial and direct; nothing like the navy law-firm or gallery-cafe concepts.

## Structure
Disclosure bar -> charcoal sticky nav -> hero (kicker, uppercase h1, lede, rating once, CTA, orange-framed photo) -> orange fact strip (21 years, cards accepted, near UK) -> services work-order ledger + 3 trust cards -> dark shop section (hours card with call-to-confirm note, car-on-lift photo, 3-photo gallery) -> orange CTA band -> footer disclaimer.

## Photo provenance
No real business photos publicly retrievable. 5 Pexels stock photos, every caption honestly labeled "Stock photo". See img/PROVENANCE.txt.

## QA notes
- 5 stock photos in img/photo-1..5.jpg, all load (relative paths).
- No em/en dashes, no banned phrases, no "No X, no Y" triples, no invented prices or promises (verified by grep + read).
- Rating shown exactly once with source and count. tel: links correct.
- Single h1; noindex meta; viewport meta.
- Desktop + mobile renders inspected; cross-site comparison: garage work-order identity is distinct from all prior concepts.
