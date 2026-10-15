# Freightfolio Agency Site - Design Direction

Three visual concepts were developed internally and evaluated against each
other before implementation. All three shared the same constraints: dark
foundation, Space Grotesk + Inter typography, no frameworks, honest copy,
and full mobile responsiveness.

## Concept A - "Neon Terminal"

- Near-black green-tinted base (#07090a), electric blue (#2f7bff) primary,
  cyan terminal accents, monospace micro-labels.
- Sharp corners, thin circuit-like grid background, heavy outer glow on CTAs.
- Feel: developer tool, precise, technical.

## Concept B - "Violet Aurora"

- Dark charcoal/indigo foundation (#0a0c10), violet (#8b5cf6) to blue
  (#3b82f6) to cyan (#22d3ee) gradient system.
- Glassmorphism cards (backdrop-filter), soft aurora radial glows, rounded
  geometry, floating 3D mockup cards in the hero.
- Feel: premium creative agency, modern, confident.

## Concept C - "Carbon Blueprint"

- Matte black (#0b0b0c), single cyan (#22d3ee) line-art accent, hairline
  borders, blueprint grid overlay, minimal glow.
- Feel: engineering studio, exact, quiet.

## Evaluation

| Criterion | A: Neon Terminal | B: Violet Aurora | C: Carbon Blueprint |
|---|---|---|---|
| Premium agency feel | Medium - reads as dev-tool | High - gradients + glass read expensive | Medium - reads as technical |
| Warmth for local SMB buyers | Low - cold, intimidating | High - inviting, human | Low - sterile |
| Screenshot showcase pop | Good | Best - indigo base makes site thumbnails glow | Okay - flat |
| Distinctiveness | Common in dev portfolios | Distinctive in local-services market | Understated |
| Accessibility of palette | Good contrast | Good contrast (checked) | Good contrast |

## Choice: Concept B - "Violet Aurora"

Implemented across the whole site. Rationale:

1. The buyer is a local business owner (tattoo shop, HVAC, barbershop), not a
   developer. Concept B is the only direction that feels premium without
   feeling technical or cold.
2. The gradient system (violet → blue → cyan) gives CTAs, headlines, pricing
   emphasis, and the hero a single coherent visual language, instead of one
   flat accent color.
3. Glassmorphism + aurora glows make the floating 3D screenshot mockups and
   the portfolio tilt cards feel cinematic, which is the core "award-winning
   agency" impression the brief asks for.
4. It photographs the concept screenshots best: the indigo-charcoal base lets
   each colorful concept thumbnail carry the visual weight.

## Brand tokens

Centrally configurable in `css/site.css` under `:root`:

- `--brand-violet: #8b5cf6`, `--brand-blue: #3b82f6`, `--brand-cyan: #22d3ee`,
  `--brand-magenta: #e879f9`
- `--bg: #0a0c10`, `--bg-soft: #0e1219`, `--text: #f2f5fb`, `--muted: #a8b2c6`
- `--font-display: "Space Grotesk", ...`, `--font-body: "Inter", ...`
- Glow, radius, and glass tokens alongside them, plus a JS-free site config
  comment block at the top of the file (contact email, pricing, CTA targets).
