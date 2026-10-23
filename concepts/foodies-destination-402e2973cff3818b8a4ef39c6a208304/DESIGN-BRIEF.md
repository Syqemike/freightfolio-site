# DESIGN BRIEF - Foodies Destination concept site

Batch 29, website-dev shift, 2026-10-23
Slug: foodies-destination-402e2973cff3818b8a4ef39c6a208304

## Aesthetic
Bold modern Korean street-food energy. Think night-market signage and food-truck
lettering: loud, stacked, condensed type on hard color blocks, with real photos
of the actual truck doing the talking. Deliberately anti-template: no centered
hero-with-blob, no three-column icon cards, no pill buttons, no soft gradients.

## Typography
- Display: Anton (Google Fonts), all caps, massive, stacked. Kinetic feel from
  oversized leading, skewed red highlight blocks behind single words, and a
  scrolling marquee ticker of menu items.
- Body/labels: Archivo (Google Fonts). Labels are uppercase, letterspaced,
  ticket-stub style.
- Scale: display type uses clamp() so the stack works at 390px mobile and
  stays enormous at 1440px.

## Palette
- Chili red #d92323 (actions, highlights, ticker)
- Ink black #121110 (hero, footer, nav accents)
- Rice-paper cream #faf3e7 (page ground, cards)
- Truck-mustard #f2b90d (stamps, badges, star of the rating badge; matches the
  truck's own yellow lettering)
- Deep red #a41212 (shadow/hover tone)
- Warm charcoal #3a352e (secondary text)
Hard edges everywhere. Square corners on buttons, 2px ink rules, photos framed
with red borders or rotated slightly with hard drop shadows (photo styling
only; zero illustration of any kind).

## Imagery
Six REAL business photos from the sagemenu.com gallery of this exact business
(see PROVENANCE.txt). The truck photo (truck.jpg) is the visual anchor of the
hero, tilted -2deg in a red frame. Food photos break up the menu rows instead
of a photo grid. Every caption describes what is actually shown.

## Layout
- Slim ink topbar: "Website concept / Design preview" disclosure + hours
  shortcut + phone.
- Sticky cream nav with a hard 2px ink underline: brand in Anton with a red
  square, text links, and a red block "Call to order" button.
- Hero on ink: three-line Anton stack ("KOREAN / COMFORT / FOOD ON WHEELS"
  style), skewed red word highlight, lead copy, two block CTAs, tilted truck
  photo with rating badge.
- Red marquee ticker of the six menu items (CSS keyframes, pauses on hover,
  respects reduced motion).
- Menu as bold numbered rows (01-06) with red rules, photo breaks, no cards.
- Hours as ticket-style rows with perforated edges (CSS dashed borders, not
  imagery) and CLOSED stamps on off days.
- Visit page: address card, "trucks move, call to confirm" note, directions
  link, big call CTA.
- Footer on ink: address, phone, hours, disclosure, Facebook link.

## Customer journey
1. Land: see the truck photo, the name, what it is (Korean food truck), and
   the rating stamp.
2. Scroll: menu items in bold rows, see the food photos, check hours.
3. Act: "Call to order" tel:+15043305545 buttons everywhere; on Visit, get the
   address and a directions link. No online ordering is claimed or linked.

## Copy guardrails
- Only the six verified menu items, no prices (none researched), no invented
  dishes.
- Hours exactly as researched: Tue-Wed 10:30 AM-1:30 PM, Sat 3:00 PM-9:00 PM,
  closed Sun/Mon/Thu/Fri.
- No demand claims, no urgency, no reviews quoted (only the aggregate rating
  line, once per page max).
- No em dashes, no banned AI phrases.
