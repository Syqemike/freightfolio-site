# DONE.md — Pre-Submission Checklist: Thomas Hardy Hair Salon

## Checklist
- [x] 3+ photos loading locally — 6 JPEGs in img/, all verified as real image bytes via `file`, all referenced and confirmed rendering in desktop + mobile full-page Playwright screenshots.
- [x] Zero concept art — no inline SVG, no CSS-drawn graphics, no digital artwork panels. Only hairline 1px borders and 2px brass rules.
- [x] Disclosure bar present at top — "Website Concept | Design Preview prepared for Thomas Hardy Hair Salon".
- [x] Business name prominent at top — masthead H1 "Thomas Hardy Hair Salon".
- [x] Sticky simple section nav — Services, Stylists, Hours & Location, Contact.
- [x] Footer contains: design-preview disclaimer (not the official site), photo provenance line, rating source line, "Concept prepared October 2026", address + phone.
- [x] CTAs verified — 3 instances of tel:+18013939561 ("Call to book" hero, "Call +1 801-393-9561" hours section, phone-big in contact). No "Book Now" anywhere.
- [x] No invented facts — all copy uses only provided research facts (services, hours per Birdeye + honest Tuesday-Saturday discrepancy note, stylist names with only the two researched titles, 4.7 from 221 Birdeye reviews shown exactly once in footer, Facebook as only web presence).
- [x] No banned phrases — grep confirmed zero matches for all 9 banned phrases.
- [x] No em dashes — grep confirmed zero (one `&mdash;` found during build, replaced with commas before rendering).
- [x] Rating shown exactly once with exact source — "Rated 4.7 from 221 Birdeye reviews." (footer only).
- [x] Every photo captioned "Stock photo." — all 6 figures have the caption.
- [x] noindex, nofollow meta present.
- [x] Visually distinct — centered masthead + ivory/brass/deco editorial style, not a generic hero-template clone.

## Iterate pass
First render found the stylists grid leaving an empty 3-column beige block after "Ali" (4-col grid, 9 items). Fixed with an explicit 3-col/2-col responsive grid. Re-rendered both viewports, inspected crops, confirmed clean.

## Notes
- Hero interior stock photo (photo-1560066984) is itself a black-and-white image from Unsplash; it is a real photo file, not a filter.
- Desktop and mobile full-page PNGs in renders/.
