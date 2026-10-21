# Design Brief: Matthews Studios

**Business:** Matthews Studios, 4004 John F Kennedy Blvd, North Little Rock, AR | (501) 658-2255
**Rating:** 4.8 from 64 Google reviews (shown exactly once, hero rating line).
**Hours:** not verified anywhere; the page says "Call for hours" and does not show an hours table.
**Service facts used:** photography studio, also listed as art studio / visual arts. No service menu, prices, or session types are published, so the page makes no specific service claims. The B.Matthews Photo wedding brand is flagged as possibly related and is NOT asserted on the page. Domain hijack (gambling site on matthewsstudiosar.com) is a pitch angle for outreach, not site content.
**CTA:** "Inquire by Phone" / "Book a session" -> tel:+15016582255 (no online booking verified).

## Creative direction
DARKROOM EDITORIAL. Near-black (#131313) + bone + amber. Space Grotesk display + Inter body. Gallery-first layout: wide hero photo strip, hover-zoom frame grid with gradient captions, dark about panel with spec list, big centered CTA. Minimal text, maximum image; nothing like the light retail or restaurant concepts.

## Structure
Disclosure bar -> sticky nav -> hero (kicker, oversized h1, lede, rating once, CTAs, address meta, 3-photo strip) -> selected frames (3 hover-zoom photos, labeled stock) -> dark studio panel (photo + 3-item list) -> contact (copy + contact card) -> big CTA -> footer disclaimer.

## Photo provenance
No real business photos publicly retrievable. 5 Pexels stock photos, every caption honestly labeled "Stock photo". See img/PROVENANCE.txt.

## QA notes
- 5 stock photos in img/photo-1..5.jpg, all load (relative paths).
- No em/en dashes, no banned phrases, no "No X, no Y" triples, no invented services, reputation claims, or session types (verified by grep + read).
- Rating shown exactly once with source and count. tel: links correct.
- Single h1; noindex meta; viewport meta.
- Desktop + mobile renders inspected; cross-site comparison: dark editorial gallery identity is distinct from all prior concepts.
