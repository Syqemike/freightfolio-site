# Design Brief: Mr Gene's Beans — Concept Website

**Business:** Mr Gene's Beans, 302 De La Mare Ave, Fairhope, AL — ice cream, frozen yogurt, coffee, and gourmet popcorn shop, serving downtown Fairhope since 1993.

## Aesthetic
Old-school soda-fountain nostalgia rendered premium: warm cream paper background like a vintage menu card, deep chocolate-brown ink, the shop's own turquoise (from their sign, stools, and chairs) as the primary accent, cherry red and straw yellow as secondary pops. The mood is family-friendly small-town Alabama: porch, sunshine, whipped cream. No dark luxury themes, no barber/salon layouts, nothing generic-template.

## Typography
- Display: "Zilla Slab" (slab serif with a soda-shop feel) for headlines and the wordmark.
- Body: "Karla" — plain, friendly, highly readable on mobile.
- Hand accents: "Caveat" for short handwritten notes ("est. 1993", photo captions). Used sparingly.
Strong system fallbacks in every stack so the page is intact offline.

## Palette
- Cream paper: #FFF7E9 (page), #FBEFD8 (cards)
- Chocolate ink: #3B2417 (text), softer #6B4A33
- Turquoise: #3FA79C primary accent (their brand color, verified on signage)
- Cherry: #D64545 (secondary accents, badges)
- Straw/caramel: #F2B134 (highlights, rating stars)
- White: #FFFDF7 sections

## Imagery
Six real, verified photos of the actual business (see img/PROVENANCE.txt):
hero.jpg (storefront, sign "Home of the Fairhope Float"), storefront.jpg, float-interior.jpg,
float-closeup.jpg, float-counter.jpg, life-at-beans.jpg (customer collage). All compressed
JPEGs under 300 KB. No stock, no concept art, no SVG/CSS-drawn graphics anywhere.

## Layout (single page, mobile-first)
1. Slim "Website Concept — Design Preview" banner (disclosure, top)
2. Sticky nav: wordmark, anchors (Float, Menu, Gallery, Visit), Call button
3. Hero: full-bleed storefront photo, turquoise badge "Home of the Fairhope Float", H1
   "Mr Gene's Beans", subhead naming the four product lines + downtown Fairhope + since 1993,
   dual CTA (Call / See the menu)
4. Signature strip: The Fairhope Float, component list from research (frozen yogurt +
   coffee or iced mochaccino + whipped cream + chocolate, vanilla, cinnamon, or nutmeg),
   "the menu calls it the Official Dessert of Fairhope" (research notes), photo pair
5. Menu: five cards — Hand-Dipped Ice Cream, Frozen Yogurt, Coffee & More, Gourmet Popcorn,
   Candy & Goods. Only items verified in the research notes. No prices (none published).
6. One social-proof strip: "4.8 out of 5 from 252 Google reviews" — the rating appears
   exactly once on the page, with source and count.
7. Gallery: six real photos, plain captions
8. Visit: address, click-to-call, honest hours (Mon-Thu 10-9, Fri-Sat 10-10, Sun 12-6 with
   "Sunday hours vary, see our Facebook page" since sources conflict), Facebook link
9. Footer: design-preview disclosure again, address/phone, noindex.

## Customer journey
Land → recognize the shop and its location (hero) → learn the signature float (the hook)
→ browse what they sell → see the single verified rating → get hours/address and call.
No booking flow exists, so CTAs are call-only ("Questions? Call (251) 928-6915").

## Copy rules honored
No em dashes. No invented facts: no testimonials, no awards claimed beyond what the
shop itself uses ("Official Dessert of Fairhope" is their menu language per the notes;
"Home of the Fairhope Float" is on their sign, verified in photos). No "No X, no Y"
triples. No banned AI phrases. Plain, direct sentences.
