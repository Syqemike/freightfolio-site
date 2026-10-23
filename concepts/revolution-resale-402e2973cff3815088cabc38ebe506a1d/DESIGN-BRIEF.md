# Design Brief — Revolution Resale (Batch 29)

Business: upscale consignment boutique, Fairhope, AL. Gently used name-brand
clothing, shoes, accessories for men, women, juniors. Sustainable-fashion
mission. Tagline: "I can afford that!"

## Aesthetic
Fashion lookbook editorial, styled like a printed magazine spread. The site
reads as an issue, not a template: oversized serif headlines, index-numbered
sections (01, 02, 03), full-bleed photography, asymmetric offsets, rotated
photo captions, hairline rules, generous whitespace. No hero-left-text/
right-image cookie-cutter, no gradients, no glowing blobs, no identical
card grids, no pill buttons.

## Typography
- Display: Fraunces (Google Fonts, 9..144 optical), fallback Didot, Bodoni MT,
  Georgia, serif. Huge, tight leading, occasional italic accent word.
- Body/labels: Inter, fallback system sans. Kickers in spaced uppercase.
- Numbers/prices styled like magazine folios.

## Palette
- Ivory paper: #FAF5EC (page), #F3EBDB (alt bands)
- Black ink: #171310 (text, wordmark)
- Coral clay accent: #C2542E (kickters, rules, one CTA treatment)
- Muted stone: #8A7E6E (captions, secondary text)
All type contrast passes on ivory and ink.

## Imagery
Nine real photos from the business's own Instagram/Facebook (see
PROVENANCE.txt). Used as full-bleed spreads and staggered lookbook figures
with honest, literal captions. No stock, no illustration, no SVG art.

## Layout
- Masthead: stacked wordmark "REVOLUTION / RESALE" in huge Fraunces, thin
  nav row beneath, issue-style topbar carrying the Website Concept
  disclosure.
- index: full-bleed hero photo with overlaid headline; mission spread with
  offset pull quote; staggered photo trio; "spotted on the floor" brand
  index as a typographic list (no cards); hours/location/contact band; footer.
- shop.html ("The Floor"): lookbook spread, all 9 photos in asymmetric
  rows with folio numbers and literal captions.
- about.html ("The Mission"): mission copy in their own words, Nappie
  finalist note, pricing note attributed to the visitors guide.
- visit.html: hours table, address, phone, directions + call CTAs, Instagram
  link (verified profile).

## Customer journey
1. Land: see the business name, the real store, the price promise.
2. Scroll: understand the mission and what the floor holds (brands seen).
3. Convert: call the boutique or get directions; hours are always visible.
Mobile 390px: single column, type scales with clamp(), images full width.
