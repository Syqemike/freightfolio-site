# Design Brief — Chris' Waggin' Tails (Website Concept)

Business: Chris' Waggin' Tails, pet grooming, 2701 N First Ave, Evansville, IN 47710.
Phone: +1 812-434-2275 (tel:+18124342275). Hours: Tue-Fri 7:30 AM-5:30 PM; Mon/Sat/Sun closed.
Rating: 4.8 from 228 Google reviews (shown once, exact source). No public photos, no socials.

## Aesthetic: "Modern care journal"
A calm, grown-up take on a pet business. Reads like a well-designed appointment
journal rather than a cartoonish pet site. Friendly but restrained; the warmth
comes from tone and palette, not clip-art dogs.

## Typography
- Headings: Source Serif 4 (Google Fonts), semi-bold. Grown-up editorial serif.
- Body: Source Sans 3 or system fallback, regular. Short plain sentences.
- Typographic detail only: a repeated "p" glyph / dotted leader motif may echo
  paw prints. No drawn shapes, no SVG illustrations, no CSS art.

## Palette
- Deep teal `#0f3d3e` (ink / footer / hero panel)
- Warm cream `#faf5ec` (page background)
- Soft sage / muted aqua tint `#e6efec` (cards)
- Amber `#c98a2c` (small accents: hairlines, the star glyph near the rating)
- Text: deep teal-ink `#143c3d` on cream; cream on teal.

## Imagery
Five stock photos, downloaded locally to img/, every one captioned "Stock photo.":
- img/hero.jpg (smiling dog, 1543466835) — hero portrait panel
- img/grooming.jpg (pug, 1517849845537) — appointment card
- img/puppy.jpg (1583511655857) — journal strip / hours panel
- img/running.jpg (dogs running, 1548199973) — full-bleed band
- img/bond.jpg (dog and human, 1583337130417) — contact section
Provenance: all Unsplash stock, locally hosted; no public photos of the
business exist. Footer states this plainly.

## Layout (one page, single HTML file, inline CSS)
1. Slim disclosure bar: "Website Concept — Design Preview for Chris' Waggin' Tails"
2. Sticky nav: wordmark + links Grooming / Hours & Location / Contact + "Call to book" button
3. Hero: business name big in serif, one plain-sentence intro, photo panel right,
   "Call to book" CTA (tel:+18124342275). Rating appears exactly once in the hero
   as "4.8 from 228 Google reviews".
4. Appointment-card grooming panel: services shown like an appointment card
   ("Full-service grooming") + honest note "Call for the full service menu and
   current prices." Stock photo.
5. Hours + visit panel: two-column card — hours table (Tue-Fri 7:30-5:30; Mon,
   Sat, Sun closed) + address; stock photo strip.
6. Full-bleed photo band with a single grounded line of copy.
7. Contact footer: big "Call to book" tel link, address, phone, photo, and the
   footer lines: design-preview disclaimer, photo provenance, rating source,
   "Concept prepared October 2026".

## Customer journey
Land on a calm hero, learn this is full-service grooming with no invented menu,
see exact hours and address, and end at one clear action: call to book.
No online booking exists, so "Book Now" is never used.

## Copy rules honored
- Plain direct sentences only; zero em dashes.
- Banned phrases (incl. "more than just a", "discover the difference") excluded.
- No invented services, prices, packages, hours, history, or staff.
- No invented urgency or booking promises.
- Rating shown once, with exact source: "228 Google reviews".
