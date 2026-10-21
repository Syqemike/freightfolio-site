# Design Brief: Legendary Ink Tattoos

**Business:** Legendary Ink Tattoos, 111 S Church St, Jackson, TN 38301 | +1 731-928-0111
**Rating:** 4.8 from 364 Google reviews (shown exactly once, hero rating line)
**Hours:** sources conflict, so NO hours table. "Call for today's hours" section states public listings disagree.
**Service facts used:** tattoos + piercings; opened 2007; artist-owned (Tjay/TjayRed, Christopher Burgess); walk-ins welcome; moderate pricing. Address per research: 111 S Church St (214 E Main St possibly old; only 111 S Church St shown).
**CTA:** "Call to book" -> tel:+17319280111 (phone single-sourced in research; used anyway as instructed)

## Creative direction
Bold dark editorial. Anton display type with an outlined "INK" treatment, Space Mono labels, near-black background with blood-red accent. Marquee divider, numbered sections (01 The Shop / 02 Work / 03 Gallery / 04 Hours / 05 Visit), fact-list ledger for shop details. Gallery photos carry a "STOCK PHOTO" tag bar.

## Structure
Disclosure bar -> sticky header (brand, mono nav, Call to book) -> hero (h1) -> marquee -> shop facts -> services -> gallery (5 stock photos used across 6 slots, each captioned "Stock photo") -> hours call panel -> visit -> footer with full disclaimer + freightfolio.net.

## QA notes
- 5 stock photos downloaded to img/photo-1..5.jpg, all load.
- No em/en dashes, no banned phrases, no "No X, no Y" patterns (verified by grep).
- Single h1; noindex meta; viewport meta.
- Mobile header overlap fixed (flex-wrap + smaller brand/button); re-rendered and verified.
- Desktop + mobile renders inspected: clean on both.
- Differentiation: entirely distinct visual language from both barber concepts (Anton/editorial vs serif/traditional) and from the other three wave-c sites.
