# DESIGN BRIEF — Edward E. Petri Co. Jewelers (edward-e-petri-jewelers-402e2973cff381179d5ff50a4)

Source brief (Website Dev 2026-10-22 21:58 CT), followed exactly:
Aesthetic: heritage atelier. Platinum silver #c9ccd1 + oxblood #5c1f24 + ivory #f7f3ea.
Typography: Cormorant Garamond (display) + Inter (body).
Layout: heritage hero "Creations in Platinum since 1922", founder story (Edward Petri, master platinum fabricator for Tiffany and Co. in New York; "Cartier of the Midwest"; third owner works with 1890s-era tools), proprietor Charles F. Walker, services (custom jewelry design, vintage and estate jewelry, certified loose diamonds, jewelry repair, expert appraisals), hours Mon-Fri 10:00 AM-4:00 PM.
Address: 20 N. Meridian St., Indianapolis, IN (just south of Monument Circle).
CTA: "Call the shop" tel:+13176365007.
Rating "4.7 from 18 Google reviews" shown once with exact source.
Photos: labeled stock fine-jewelry/atelier (no real photos; old domain is a parked Coming Soon page; no social). Distinct from Goldman style: platinum/oxblood editorial.

## Design execution
- Centered heritage editorial: roman-numeral service list (I.-V.), oxblood rules, ivory/platinum palette, Cormorant Garamond throughout, "legacy" three-column timeline (1922 / Cartier of the Midwest / 1890s-era tools).
- heritage.html: vertical timeline (era grid) for the 1922 story with the founder, the nickname, and the tools, plus two stock photos and a call band.
- Mobile: single-column stack at 860px; rendered mobile inspection not available in this tooling, recorded NOT VERIFIED per standing waiver.

## Verified facts (from batch26-builder-data.json only)
- Business: Edward E. Petri Co. Jewelers; Indianapolis, IN; jeweler-manufacturer "Creations in Platinum since 1922"
- Founder Edward Petri was formerly a master platinum fabricator for Tiffany & Co. in New York; "Cartier of the Midwest"; third owner works with 1890s-era tools; proprietor Charles F. Walker
- Services: custom jewelry design, vintage and estate jewelry, certified loose diamonds, jewelry repair, expert appraisals
- Address: 20 N. Meridian St., Indianapolis, IN (just south of Monument Circle)
- Hours: Mon-Fri 10:00 AM-4:00 PM
- Phone: (317) 636-5007 — 2 public sources; presented as listed
- Rating: 4.7 from 18 Google reviews, shown once on the homepage
- Social: none. Website: none (old domain resolves to a parked "Coming Soon" page). No real photos.

## Image provenance summary
See img/PROVENANCE.txt for full detail. All 5 photos STOCK (Pexels free license; no real photos exist publicly):
- workbench.jpg (index hero; Pexels 6262837, Tima Miroshnichenko) — jeweler's hands crafting a ring
- diamond-ring.jpg (services; Pexels 14466164, The Glorious Studio) — solitaire diamond ring
- estate-jewelry.jpg (services + heritage; Pexels 4974342, cottonbro studio) — vintage pearls and brooch
- jewelry-tools.jpg (services + heritage; Pexels 10474312, RDNE Stock project) — pliers and tools
- atelier.jpg (proprietor section; Pexels 6263063, Tima Miroshnichenko) — jeweler at workbench
Every photo labeled "Stock photo: ..." in its caption. No concept-art illustrations anywhere on the pages.

## Pre-submission checklist
- At least 3 photos loading: PASS (5 photos, all verified JPEG bytes, non-trivial size; index.html carries 5, heritage.html carries 2)
- No concept-art illustrations: PASS (photographs only; no inline SVG art, no CSS-drawn graphics)
- Disclosure + business name + nav: PASS ("Design Preview" bar top of every page; business name in sticky header and hero; section nav present)
- CTAs verified: PASS (all CTAs are "Call the shop" tel:+13176365007; no Book Now button)
- No invented facts / banned phrases / em dashes: PASS (founder story per research notes only; em-dash grep clean on both pages; rating shown once)
- Design visually distinct: PASS (platinum/oxblood centered editorial; distinct from the dental and bakery builds)

Outstanding: rendered browser inspection not available to this builder; smoke verification is source/byte-level only. QA should do the live render check on staging.
