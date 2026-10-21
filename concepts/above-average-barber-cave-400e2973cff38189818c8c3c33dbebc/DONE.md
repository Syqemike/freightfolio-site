# Pre-Submission Checklist: Above Average Barber Cave Concept

## Checklist result: PASS on all items

- [x] **3+ photos loading locally**: 6 real JPEGs load from img/ (cut1, cut2, cut3, cut4, cut5, cut7). Playwright broken-image scan on both viewports returned empty arrays. Zero hotlinks.
- [x] **Zero concept art**: no inline SVG, no CSS-drawn illustrations, no digital artwork panels. The only circular elements are the punched notches on the ticket-stub cards, built with plain CSS borders as the approved design direction allows. Hairline dividers and typographic ornaments only.
- [x] **Disclosure + business name + nav present**: slim "WEBSITE CONCEPT / Design preview prepared by Freightfolio" bar at the very top; "Above Average Barber Cave" wordmark in sticky nav and in hero; sticky section nav (Services, Barbers, Hours & Location, Contact) plus Book Now button.
- [x] **CTAs verified**: "Book Now" links to https://book.thecut.co/DavidTurner, confirmed resolving to https://app.thecut.co/barbers/DavidTurner with HTTP 200 via curl. "Call to book" uses tel:+12604427937 throughout.
- [x] **No invented facts**: every fact comes from the site-facts brief (name, address, phone, hours, services, barbers, tagline quote, walk-ins/appointments, family-friendly, 4.9/19 rating, booking page). No prices anywhere (not published). No barber titles or bios invented.
- [x] **No banned phrases or em dashes**: grepped the HTML for em dashes, all nine banned AI phrases, and "No X, no Y" constructions. Zero hits. Copy is plain direct sentences. One period-fragment headline found in pass 1 ("Two chairs. One standard.") and fixed to "Two chairs, one standard."
- [x] **Rating shown exactly once with exact source**: "Rated 4.9 from 19 Google reviews" appears once in the amber band. Footer carries only "Review source: Google reviews." The theCut 4.96/227 figure appears nowhere.
- [x] **Visually distinct**: dark slate + hazard amber industrial identity, Oswald/Archivo type, split-screen hero, ticket-stub service cards with perforated stub edges, ticket-board hours layout. No dark-espresso template look.
- [x] **noindex meta**: `<meta name="robots" content="noindex, nofollow">` present.
- [x] **Footer complete**: design-preview disclaimer, photo provenance naming the theCut profile, rating source line, "Concept prepared October 2026", address + phone.
- [x] **Renders inspected**: desktop 1440px and mobile 390px full-page PNGs rendered via Playwright (google-chrome, headless, --no-sandbox, file:// URL). Two render passes; pass 2 fixes (fragment headline, mobile wordmark size, anchor scroll margin) re-rendered and re-inspected. No overlap, no broken images, no excess whitespace issues remaining.

## Render passes
- Pass 1: full page renders both viewports, visually inspected. Found: period-fragment headline; mobile wordmark slightly oversized.
- Pass 2: fixes applied, re-rendered, re-inspected. Clean.

## Caveats
- One of the eight supplied photo URLs (cut6) returned an S3 AccessDenied XML error and was skipped; the page uses 7 real photos (6 on-page, 1 unused collage that was off-brand). No stock photos were needed.
- Footer directions link points to a Google Maps search URL for the address (standard external link, opens in a new tab).
- Photo captions describe only what each photo shows; provenance stated in the gallery intro and footer.
