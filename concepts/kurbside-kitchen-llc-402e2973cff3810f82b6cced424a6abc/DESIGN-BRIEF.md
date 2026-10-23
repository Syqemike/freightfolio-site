# Design Brief — Kurbside Kitchen LLC (Moss Point, MS)
Slug: kurbside-kitchen-llc-402e2973cff3810f82b6cced424a6abc
Batch: 29, website-dev shift, 2026-10-23

## Concept
**"The Southern food-magazine cover, as a website."** Editorial, not templated.
The homepage reads like the cover of a warm Southern food magazine: a
rules-and-serif masthead, an asymmetric hero where the headline column sits
narrow-left and a big real food photo bleeds in from the right, pull-quotes,
a drop-cap intro, and menu content typeset like a printed menu card. Every
section earns its space with photography or real menu content.

## Aesthetic
Warm Southern editorial. Printed-menu warmth: cream paper, burnt-orange ink,
espresso rules. Deliberately print-like: hairline rules everywhere, small caps
eyebrows, numbered sections, a dateline strip (city, hours, phone) under the
masthead like a newspaper's front page. No rounded pill buttons as the
primary CTA language; CTAs are typeset like a menu order line.

## Palette
- Cream paper: #FAF4E8
- Cream deep: #F1E7D2 (bands)
- Burnt orange: #C25E1E (primary accent)
- Burnt orange deep: #A04C15 (hover)
- Deep espresso: #2C1B10 (text, footer)
- Muted coffee: #6E5A49 (secondary text)
- Hairline rule: #DCC9A8
- Alert red (closed days): #A03A22

## Typography
- Display serif: "Fraunces" (Google Fonts), weights 600-900, for headlines,
  masthead, menu category heads. Confident, warm, editorial.
- Body: "Karla" (Google Fonts), for reading text, nav, captions.
- Small caps eyebrows via letter-spacing + uppercase in Karla.
- Pull-quotes in Fraunces italic.

## Imagery
5 REAL business photos (provenance in PROVENANCE.txt). Food-forward:
hero spread (DoorDash header), wings, soul-food plates, turkey wings plate,
fried-fish open-face plate. No stock needed. No illustrations, no icons that
are drawings, no SVG art, no CSS graphics.

## Layout
- Index: dateline topbar (disclosure + hours + phone) → masthead with
  oversized serif name, tagline "Food for the Soul" → simple section nav
  (rule top and bottom) → asymmetric hero: narrow text column left (drop-cap
  lede, eyebrow, headline) + large photo right, bleeding to edge → "This
  week's soul-food standouts" photo-strip trio → menu-forward teaser (columns)
  → hours/location/visit band → footer.
- menu.html: printed-menu layout, two columns, category heads with rules,
  item notes; "no prices" decision: prices on their flyers conflict with
  DoorDash and change often; describe dishes instead. Actually include the
  honest note "Menus change. Call (228) 355-4638 for today's prices."
- visit.html: hours grid (Wed-Sat / closed Sun-Tue), address, directions link,
  ordering section (call to order, DoorDash link verified, Caviar text mention),
  takeout note.
- about.html: their story in their own words style ("Food for the Soul"),
  ratings once, real review quotes (grounded in real review text from the
  listings), photo of plates, tagline.

## Customer journey
Home → see the food (photos) → check the menu → check hours/location →
call to order or DoorDash. Secondary: about for story/rating reassurance.

## Distinctness
Batch-28 was nail-salon editorial, industrial charcoal, forest/brass, dark
glam, art-deco burgundy. This is the only Southern-food magazine print style:
no neon, no dark mode, no art deco borders, no industrial blocks. The print-
menu masthead + dateline strip + drop-cap is the signature move no other
site in this batch has.
