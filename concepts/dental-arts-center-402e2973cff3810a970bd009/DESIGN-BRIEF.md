# DESIGN BRIEF — Dental Arts Center (dental-arts-center-402e2973cff3810a970bd009)

Source brief (Website Dev 2026-10-22 21:58 CT), followed exactly:
Aesthetic: calm clinical trust. Clinical teal #2a7f76 + warm sand #e9dcc3 + white.
Typography: Source Serif 4 (display) + Inter (body).
Layout: family dentistry positioning, doctor card: Dr. Michael H. Shields, 43 years experience (per WebMD), "family dental practice in downtown Moss Point" per branding, services: general/family dentistry (detailed list not published; present honestly as general family dentistry, do NOT invent procedures).
Address: 4218 Castenera Ave, Moss Point, MS 39563. Hours: none published anywhere; use "Call for office hours" honestly, do NOT invent hours.
CTA: "Call the office" tel:+18559286306 (single-source number; present as listed).
Rating "5.0 from 11 Google reviews" shown once with exact source.
Photos: labeled stock dental-office (no real photos; no social at all).
Distinct from spa builds: clinical/editorial, not pampering.

## Design execution
- Editorial magazine layout: numbered care cells (01/02/03), serif headline hero, thin rules, sand-tinted photo frames, dark-teal doctor section, visit card with info panel beside a full-bleed photo.
- An explicit "A note on our services" honest-note box states that no detailed procedure list is published, instead of inventing treatments.
- Mobile: single-column stack at 860px; mobile rendered inspection not available in this tooling, recorded NOT VERIFIED per standing waiver.

## Verified facts (from batch26-builder-data.json only)
- Business: Dental Arts Center Michael H Shields DMD; display name on site: "Dental Arts Center — Dr. Michael H. Shields, DMD"
- Category: Dental Office; Moss Point, MS; family dental practice / general dentistry
- Dr. Michael H. Shields, 43 years experience (per WebMD)
- Address: 4218 Castenera Ave, Moss Point, MS 39563
- Phone: (855) 928-6306 — SINGLE SOURCE (patientconnect365 only); presented as listed, no invented alternates
- Hours: not found on any source — "Call for office hours" used everywhere
- Rating: 5.0 from 11 Google reviews (Google-aggregated via patientconnect365), shown once on the homepage
- Social: none found. Website: none (patientconnect365 directory profile only). No real photos, no logo.

## Image provenance summary
See img/PROVENANCE.txt for full detail. All 5 photos STOCK (Pexels free license; no real photos exist publicly):
- dental-chair.jpg (visit.html) — Pexels 4269265, Cedric Fauntleroy — dental chair
- dental-exam.jpg (index.html hero) — Pexels 3845747, Anna Shvets — dentist treating patient
- dental-tools.jpg (index.html doctor section) — Pexels 305566, Daniel Frank — dental tool set
- dental-patient.jpg (visit.html) — Pexels 3845744, Anna Shvets — smiling patient
- dental-reception.jpg (index.html visit teaser) — Pexels 6809645, Pavel Danilyuk — clinic reception
Every photo labeled "Stock photo: ..." in its caption. No concept-art illustrations anywhere on the pages.

## Pre-submission checklist
- At least 3 photos loading: PASS (5 photos, all verified JPEG bytes, non-trivial size)
- No concept-art illustrations: PASS (photographs only; no inline SVG art, no CSS-drawn graphics)
- Disclosure + business name + nav: PASS ("Design Preview" bar top of every page; business name in sticky header and hero; section nav present)
- CTAs verified: PASS (all CTAs are "Call the office" tel:+18559286306; no Book Now button)
- No invented facts / banned phrases / em dashes: PASS (services described honestly; no AI phrases; em-dash grep clean on both pages; rating shown once)
- Design visually distinct: PASS (clinical teal/sand editorial; distinct from other batch builds)

Outstanding: rendered browser inspection not available to this builder; smoke verification is source/byte-level only. QA should do the live render check on staging.
