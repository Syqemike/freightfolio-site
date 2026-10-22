# DESIGN-BRIEF.md — 3 Diamantes (batch23-scratch)

## Business
- **3 Diamantes** — jewelry store selling **14k gold**, not a restaurant. Never used food copy on this site.
- Address: 340 E New Circle Rd, Lexington, KY
- Spanish-speaking clientele (copy describes it as serving Lexington's Spanish-speaking community; no claim made about staff language ability)

## Verified facts used (from the provided research; nothing added)
- Product lines: 14k gold medallions for all occasions, engagement rings, graduation rings, wedding bands, loose diamonds, custom jewelry design, bracelets/bangles. (Each maps to a Collections tile; custom design gets a claim-free text banner.)
- Hours: 11am–8pm, all 7 days. Presented as listed, with the note "Hours as listed on the business's public listing."
- Rating, shown ONCE: "4.6 stars from 31 reviews (local listing aggregation)" — exact wording and source, in the Visit section only.
- Phone: (859) 367-5102, presented as listed ("Number as listed on the business's public listing."). No verification claim.
- Web presence: Instagram location page only; no business-run profile, no Facebook, no Google/Yelp listing, no website. Kept copy modest: no invented history, no invented reviews/testimonials/awards/pricing/credentials.

## Creative direction applied
- Luxurious jewelry retail. Palette: near-black (#0c0b09) + gold (#c9a24b) + ivory (#f7f2e7). Solid colors only, no gradients.
- Typography: Cormorant Garamond (serif headings) + Manrope (body) via Google Fonts.
- Layout: hero (name, tagline "Oro de 14 kilates en Lexington, Kentucky", gold necklaces hero photo, Call CTA) → Collections grid (6 photo tiles + custom-design banner) → Hours (7-day grid + before-you-visit panel) → Visit (address + get-in-touch panels) → footer.
- All CTA buttons say "Call" with tel:+18593675102 (5 instances). No forms, no fake booking.
- Spanish tagline in hero is a language label for the store's specialty (14k gold), grounded in "Spanish-speaking clientele"; no other non-English copy.

## Photo provenance (ALL STOCK, zero real business photos)
Real photos were attempted first: the Instagram location page for 3 Diamantes returned HTTP 403 on text fetch, and no public Facebook or Google listing exists. All 7 images are stock, each captioned "Stock photo:" with a caption matching what the image actually shows (each file was visually inspected after download; file magic/content type confirmed as image).

| File | Shows | Source media URL | Source page |
|---|---|---|---|
| img/hero.jpg | Gold necklaces and chains on a black display stand, black background | https://m.media-amazon.com/images/I/710SsoXmx2L.jpg | Amazon CDN listing image (via image-search) |
| img/medallion.jpg | Gold coin medallion pendant with filigree frame on rope chain | https://img.ltwebstatic.com/v4/j/spmp/2026/03/22/20/17741781876a3e6d66eadb0f91e5c629ee05f088ce_thumbnail_750x999.webp | Shein regional listing page (m.shein.tw) |
| img/engagement.jpg | Yellow gold halo diamond engagement ring with pavé band on ivory fabric | https://static.livebooks.com/.../Ring%20Two.jpeg | sallyreps.com photographer portfolio page |
| img/bands.webp | Two gold wedding bands, one channel-set with diamonds, on blue background | https://i.etsystatic.com/12694725/r/il/88b2ac/8023156519/il_1080xN.8023156519_85s7.jpg | Etsy listing page (generic couple wedding rings) |
| img/grad.jpg | Gold class ring with blue center stone, "GRAD"/"2018" lettering | https://m.media-amazon.com/images/I/61k5ct-579L.jpg | desertcart.com.kw product page (14k class ring) |
| img/bangles.jpg | Stack of textured gold bangles on a wrist | https://bigbangles.com/wp-content/uploads/2025/12/17if-gold-bangle-bracelet-for-women-14k-multilayer-charm-textured-stackable-bracelets-boho-indian-chunky-cuff-fashion-je-1024x989.jpg | bigbangles.com review article |
| img/diamonds.jpg | Loose cut diamonds scattered on black background | https://inhabitat.com/wp-content/blogs.dir/1/files/2015/03/Loose-Diamonds.jpg | inhabitat.com blog |

No concept-art illustrations used: photographs only, no inline SVG illustrations or CSS-drawn graphics. No other business's logo appears in any photo (visually confirmed).

## Mike's rules compliance check
- [x] No em dashes (verified) and no en dashes
- [x] No banned AI phrasing (verified); no 'real this/just this', no comma triples, no period fragments, no 'No X, no Y' triples
- [x] Business name prominent at top (header brand lockup)
- [x] "Design Preview / Website Concept" disclosure near the top (topbar)
- [x] Simple section navigation (Collections, Hours, Visit)
- [x] `<meta name="robots" content="noindex">` present
- [x] Footer disclaimer: design concept by Freightfolio linking https://freightfolio.net; notes photos are stock
- [x] Rating shown once with exact source and breakdown
- [x] No social links (could not verify any business-run account; Instagram location page is not business-run)
- [x] Labeled "Website Concept"/"Design Preview", never implied as client work
- [x] Responsive (3-col → 2-col → 1-col grids)
- [x] HTTPS-free local img/ assets only; all CTA buttons "Call" with tel:+18593675102

## Could not verify (kept out of the site or presented as listed)
- Phone number: single source (Instagram location page), not dual-confirmed — presented as listed, no verification claim.
- Hours: single source (same listing) — presented as listed.
- No real photos of the store or its inventory exist publicly; all imagery is labeled stock.
- Rating source is a local listing aggregation per the research; no Google/Yelp page to confirm — shown once, verbatim.

## Blocked
- Nothing blocked the build. Real-photo harvest failed (Instagram 403), so stock was used per the brief's fallback.
