# DONE — Shave Barbershop (batch 19)

Built 2026-10-21. Index: `index.html`, photos in `img/`, brief in `brief.md`,
renders in `renders/` (desktop 1440px + mobile 390px, inspected, one iterate pass).

## Pre-submission checklist
- [x] 3+ photos loading: `shave_shop.jpg`, `shave_shave.jpg`, `shave_tools.jpg`
  (all verified in desktop + mobile renders, `file` confirms real JPEG bytes)
- [x] Zero concept-art illustrations: no inline SVG, no CSS-drawn graphics anywhere
- [x] Disclosure bar near top ("Design Preview: a website concept by Freightfolio"),
  business name prominent in masthead, sticky section nav (Services / Barbers / The Shop / Visit)
- [x] CTAs verified: every booking CTA is "Call to book" -> `tel:+13143674283`;
  secondary CTA is `mailto:shave-stl@gmail.com` (researched email). No online booking verified, none claimed.
- [x] No invented facts: hours Tue-Sat 8:00 AM to 6:00 PM, Mon/Sun closed; haircuts about $40
  per reviews; walk-ins welcome, appointments recommended; barbers Erik R. ("Big E") and Hank;
  1912 Washington Ave, St. Louis, MO 63103; wheelchair-accessible, parking available,
  LGBTQ+ friendly; rating 4.8 from 36 Google reviews, shown exactly once.
  Hours caveat included honestly (call ahead to confirm).
- [x] No banned phrases, no "No X, no Y" triples, no em dashes (grep-verified: zero —/– in source)
- [x] Visually distinct: broadsheet-newspaper treatment (Old Standard TT + Source Serif 4,
  cream paper, deep navy ink, ledger rows) vs. atelier editorial and retro-badge siblings

Iteration notes: removed accidental `&mdash;`/`&ndash;` entities after first render;
re-rendered and confirmed clean. Google Fonts (Old Standard TT, Source Serif 4) loaded in renders.
