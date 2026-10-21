# DONE.md — Golden Barber concept (pre-submission checklist)

Date: 2026-10-21

## Checklist results

- [x] **3+ photos loading** — PASS. 7 photo slots on the page (5 unique stock images, downloaded to img/, all verified as JPEG bytes with curl + file). Playwright check: every `<img>` loaded with naturalWidth 1200 from local file:// paths. Each photo captioned "Stock photo."
- [x] **Zero concept art** — PASS. No inline SVG, no CSS-drawn graphics, no digital artwork panels. Only hairline rules, typographic numerals (01-05), and photos.
- [x] **Disclosure + business name + nav present** — PASS. Disclosure bar at very top ("Website Concept | Design Preview, prepared for Golden Barber, Twin Falls, Idaho"). "Golden Barber" nameplate prominent in sticky header and hero. Sticky nav: Services, Hours & Location, Contact.
- [x] **CTAs verified** — PASS. 12 links to tel:+12083292486, all labeled "Call to book" or the phone number. No "Book Now" anywhere; no online booking promised (none was found). Grep confirms zero "Book Now" / booking-claim strings.
- [x] **No invented facts** — PASS. Copy uses only the research facts: name, address, phone, exact hours, the five named services, price as "clients mention fades around $25" with "call to confirm current prices." Removed an invented walk-in policy line during review.
- [x] **No banned phrases or punctuation** — PASS. Grep count of em dashes: 0. No banned AI phrases ("where passion meets precision", "elevate your experience", etc.), no "No X, no Y" triples, no comma triples, no period fragments.
- [x] **Rating shown exactly once, exact source** — PASS. Appears once, in the footer: "5.0 from 21 Google reviews." A near-duplicate in the pull-quote section was removed during review.
- [x] **Footer complete** — PASS. Design-preview disclaimer (not the official site), photo provenance line ("All photos on this page are stock photos; no public photos of the business were available"), rating source line, "Concept prepared October 2026", address 407 2nd Ave E, Twin Falls, ID 83301, phone (208) 329-2486.
- [x] **robots noindex,nofollow** — PASS. Meta tag present.
- [x] **Visually distinct** — PASS. High-desert modern editorial: warm sand (#f4ede1) + charcoal ink, Fraunces editorial serif display type, oversized numbered service index (01-05), asymmetric hero collage, dark price-note callout card, centered typographic pull quote. Light warm palette, not dark-espresso.
- [x] **Hours reproduced exactly** — PASS. Monday Closed; Tuesday-Saturday 11:00 AM to 6:00 PM; Sunday 12:00 PM to 4:00 PM (table + footer).

## Review iterations performed
1. Initial render: nav "Call to book" button rendered as empty black box (ink-on-ink text, `nav.links a` specificity beat `.btn-call` color). Fixed with `nav.links a.btn-call{color:var(--paper)}`.
2. Service descriptions ran inline after titles (inline spans). Fixed with `.svc .d{display:block}`.
3. Found 3 em dashes (title, disclosure bar, kicker); replaced with commas. Grep now 0.
4. Removed invented walk-in policy claim ("Walk-ins and calls welcome"); replaced with call-during-hours copy.
5. Pulled a duplicate rating mention out of the pull-quote section; rating now appears only in the footer.
6. Fixed `.bar{padding:16px 0}` overriding `.wrap` horizontal padding (same specificity, later in source), which left header text flush against the viewport edge. Changed to padding-top/bottom only. Verified 28px padding on desktop and mobile.
7. Mobile: made the overlapping hero offset photo stack statically below the main photo for small screens.

## Deliverables
- [index.html](sandbox://workspace/goals/local-business-website-sales/hidden_files/batch19-scratch/golden-barber-400e2973cff38107bc33dd8dc97e57a4/index.html)
- [brief.md](sandbox://workspace/goals/local-business-website-sales/hidden_files/batch19-scratch/golden-barber-400e2973cff38107bc33dd8dc97e57a4/brief.md)
- img/: hero.jpg, cut.jpg, tools.jpg, portrait.jpg, work.jpg (all verified JPEG bytes)
- [renders/desktop.png](sandbox://workspace/goals/local-business-website-sales/hidden_files/batch19-scratch/golden-barber-400e2973cff38107bc33dd8dc97e57a4/renders/desktop.png), [renders/mobile.png](sandbox://workspace/goals/local-business-website-sales/hidden_files/batch19-scratch/golden-barber-400e2973cff38107bc33dd8dc97e57a4/renders/mobile.png) (1440px / 390px, inspected and fixed)

## Caveats
- All 5 photos are stock (images.unsplash.com), every one captioned "Stock photo" per the no-public-photos fallback rule; the design assumes the real shop photos will replace them if the prospect converts.
- Google Fonts (Fraunces, Manrope) load from the network via <link>; everything else is self-contained. Renders captured after fonts loaded.
