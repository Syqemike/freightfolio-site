# Design Brief: Babbar & Associates P.C.

**Business:** Babbar & Associates P.C., 3601 Hempstead Tpke, Suite 502, Levittown, NY 11756 | (516) 228-0111
**Rating:** 5.0 from 12 Google reviews (shown exactly once, hero rating line).
**Hours:** Mon-Fri 10:00 AM - 5:00 PM (Google); firm's own site shows 10:00-18:00, so the page uses the Google hours and advises calling to confirm.
**Service facts used:** immigration (naturalization/citizenship, deportation defense, habeas corpus/federal detention litigation), divorce & family law, telephone consultations, free initial phone consultation. No attorney names, bar admissions, or founding year are stated anywhere on public pages, so none appear on the site.
**CTA:** "Request a Free Phone Consultation" / "Call the Office" -> tel:+15162280111 (no online booking verified).

## Creative direction
TRUSTED COUNSEL. Deep navy (#16263f) + gold (#c9a24b) + ivory. Cormorant Garamond display serif + Source Sans 3 body. Stately structure: gold rule accents, diamond-bullet practice cards, framed hero photo, gold strip of key facts, dark consultation section. Restrained and professional; nothing playful, nothing like the cafe concept.

## Structure
Disclosure bar -> navy sticky nav -> hero (gold rule, kicker, serif h1, lede, rating once, 2 CTAs, framed photo) -> gold fact strip -> practice areas (2 cards) -> dark consultation section -> 3-photo gallery (labeled stock) -> contact (hours + office cards) -> footer disclaimer.

## Photo provenance
No real business photos publicly retrievable. 5 Pexels stock photos, every caption honestly labeled "Stock photo". See img/PROVENANCE.txt.

## QA notes
- 5 stock photos in img/photo-1..5.jpg, all load (relative paths).
- No em/en dashes, no banned phrases, no "No X, no Y" triples, no invented credentials or attorney names (verified by grep + read).
- Rating shown exactly once with source and count. tel: links correct.
- Single h1; noindex meta; viewport meta.
- Desktop + mobile renders inspected; cross-site comparison: navy/gold serif identity is distinct from the gallery-cafe concept and from recent Freightfolio builds.
