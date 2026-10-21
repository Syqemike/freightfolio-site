# Design Brief: Southside Grooming

**Business:** Southside Grooming, 3458 Peach Orchard Rd, Augusta, GA | +1 706-796-2575
**Rating:** 5.0 from 11 Google reviews (shown exactly once, hero pill)
**Hours:** Mon-Fri 8 AM-3 PM; Sat 8:30 AM-2 PM; Sun closed (full table, verified in research)
**Service facts used:** dog grooming for breeds under 50 lbs; appointment only; book with Tiffany; no published prices (noted on site as "Call for details and current pricing")
**CTA:** "Call to book" -> tel:+17067962575 (no verified online booking)

## Creative direction
Friendly neighborhood pet-care feel. Rounded typography (Fredoka + Nunito), warm cream background with forest green and coral accents. Asymmetric split hero with a floating "Appointment only / Book directly with Tiffany" badge over the photo. Numbered trust tiles ("Why Southside") frame the one-groomer model; services section lists standard grooming visit types with an honest no-prices note.

## Structure
Disclosure bar -> sticky header (brand, nav, Call to book) -> hero (h1) -> trust tiles -> services -> gallery (6 stock photos, each captioned "Stock photo") -> hours + visit cards -> footer with full disclaimer + freightfolio.net.

## QA notes
- 6 stock photos downloaded to img/photo-1..6.jpg, all load.
- No em/en dashes, no banned phrases, no "No X, no Y" patterns (verified by grep).
- Single h1; noindex meta; viewport meta.
- Desktop + mobile renders inspected: no overlaps, whitespace sane on both.
- Differentiation: distinct from Don's Barber Shop (Georgia serif/gold) and Presidential Grooming (Cormorant/Jost dark) via rounded friendly type, cream/green/coral palette, badge-over-photo hero.
