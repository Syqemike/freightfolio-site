# Freightfolio original audit — 2026-10-23

Source: upstream main bcdc684b18015e706c5e98ffdafddac32161e309, obtained through the authorized GitHub connector. This is a source audit, not a claim of live-site or rendered verification. The environment proxy is unreachable; sandbox socket restrictions also prevent local browser launch until runtime access is available.

## Prioritized findings

| Severity | Evidence | Consequence / action |
|---|---|---|
| Critical | functions/api/lead.js returns `{ok:true}` with no RESEND_API_KEY, even when LEADS_KV is absent | Visitor can receive a false success while their inquiry is discarded. Require an actual storage or delivery success. |
| High | index.html promotes Back Bone, Southland and Twisted concepts; AGENTS.md supersedes earlier acceptances and names Studio 601 and TailWaggers as the accepted references | Replace homepage and portfolio promotion with those existing examples; preserve concept files and historical decisions. |
| High | pricing, terms and homepage include two additional Growth features beyond the mission's final list | Align public package lists to the exact current owner brief; leave payment infrastructure untouched. |
| High | Portfolio copy includes specific ratings, dealer/license claims and unverified project capabilities | Remove unsupported promotional claims; show concepts as demonstrations, never as completed client work. |
| High | request.js sets only a visual .invalid class; error text has no programmatic field association; success panel is not focused | Add aria-invalid, describedby, live error status, and success focus; verify mocked transport separately from actual delivery. |
| Medium | index.html eagerly loads three PNGs totaling 1,097,435 bytes before other assets | Replace hero media with one optimized real concept preview; lazy-load secondary work. |
| Medium | js/site.js particle loop redraws continually and compares every pair of particles | Remove canvas and continuous animation; use event-driven interactions. |
| Medium | .reveal content starts hidden and depends on JS/IntersectionObserver | Make content visible by default and animate only when enhancement initializes. |
| Medium | Main navigation has eight destinations plus CTA | Reduce primary choices; retain secondary routes in footer. |
| Medium | Page structure repeats centered heading + same cards throughout | Introduce typographic hero, oversized live concept stage, editorial service section, process rail and clear pricing. |
| Medium | js/site.js sticky CTA uses relative request.html even in /blog/ | Use root-aware links and prevent persistent mobile obstruction. |
| Medium | design-lab.html has two h1 elements | Establish one main heading. |
| Medium | CSS font tokens and DESIGN.md disagree; README describes an old branch | Document the actual design system and branch workflow. |
| Medium | wrangler.toml contains placeholder KV IDs | Deployment binding readiness cannot be assumed. Preserve config; flag owner setup requirement. |
| Medium | No rendered / live speed, contrast, CWV or touch verification available yet | Measurements remain unverified. Do not claim scores or accessibility conformance. |
| Low | Canonical, OG metadata, sitemap, basic schema and reduced-motion checks already exist | Preserve and improve these strengths instead of replacing blindly. |

## Architecture and protected systems

Static HTML/CSS/vanilla JS, Cloudflare Pages, /api/lead, Stripe webhook and concept analytics middleware. No package.json or frontend dependencies. Keep the stack. Do not touch payment/webhook, operational data, automation, credentials or prospect concept source. No publishing, production merge, outbound messages or Notion operational edits are needed for this marketing-site branch.

## Page inventory reviewed in source

Homepage; portfolio; services; pricing; process; design lab and its template scripts; about; FAQ; request and validation; privacy; terms; thank-you; 404; blog index and three articles; sitemap, robots, shared CSS/JS, lead API, headers, Wrangler configuration. Concept directory inventory reviewed; the many independent prospect sites are outside redesign scope and not visually cleared. Live navigation, deployed redirects, third-party readiness, mobile rendering and CWV remain unverified.

## Creative direction: The living portfolio

Warm ivory, near-black ink and a restrained electric-chartreuse accent. Oversized sans-serif editorial typography paired with quiet serif emphasis. A real existing concept becomes the hero's functional browser stage; visitors switch examples and viewport modes. Thin rules, generous space and a strong typographic wordmark replace particles, tilt gimmicks and glow cards. Light work sections alternate with a dark service chapter. Trust comes from exact prices, clear subscription terms and visible work, never invented metrics.

Audit recorded before implementation.
