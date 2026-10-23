# Freightfolio agency website

Static HTML, CSS and vanilla JS deployed with Cloudflare Pages. Marketing overhaul work is isolated on `codex-site-overhaul`; do not merge or deploy to production without owner approval.

## Preview

From a complete repository checkout, run `python3 -m http.server 8000` and open http://localhost:8000. The static server does not execute Cloudflare Functions. Concept previews are same-origin frames with a separate full-concept link.

## Main files

- `index.html`, `portfolio.html`, `pricing.html`: rebuilt marketing experiences.
- `css/overhaul.css`: new design system and responsive compositions; `css/site.css` preserves existing service/lab template support.
- `js/site.js`: shared navigation/timeline. `js/showcase.js`: user-controlled concept views.
- `request.html`, `js/request.js`, `functions/api/lead.js`: preserved lead workflow with accessibility and delivery-state fixes.
- `functions/api/stripe-webhook.js`: unchanged payment infrastructure.
- `concepts/`: existing prospect sites, unchanged by this overhaul.

## Verification

`node tests/lead-api.mjs` runs mocked API cases without sending emails. `python3 tests/source-checks.py` checks public HTML, pricing, JSON-LD, links and JS syntax. Rendered/device/live integration verification is separate.

Read `reports/01-original-audit.md`, `reports/02-implementation-and-qa.md` and `DESIGN.md` for evidence, decisions and open release blockers. Current status: implementation checkpoint, visual QA incomplete, not ready for production.

Cloudflare configuration still requires valid Resend and optional KV bindings. Secret values belong in Cloudflare settings, never in the repository. Placeholder namespace IDs in `wrangler.toml` have not been changed.
