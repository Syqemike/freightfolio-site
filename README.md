# freightfolio-site

Website design agency site for Freightfolio (https://freightfolio.net).
Branch `agency-rebuild` holds the agency rebuild; `main` is untouched by this work.

## Pages

- `index.html` - homepage with animated hero
- `portfolio.html` - six website design concepts (showroom with modal)
- `services.html` - done-for-you service details
- `pricing.html` - Starter $149/mo, Professional $199/mo, Business Growth $299/mo ($0 upfront)
- `how-it-works.html` - interactive 4-step timeline
- `design-lab.html` - live mini-website preview: 7 categories x 4 directions
- `about.html`, `request.html` (lead form), `faq.html`, `privacy.html`, `terms.html`, `404.html`

## Structure

- `css/site.css` - all styles; brand tokens live in `:root` at the top
- `js/site.js` - nav, particles, tilt, reveal-on-scroll
- `js/portfolio.js` - concept modal data and logic
- `js/design-lab.js` - design lab template engine
- `js/request.js` - lead form validation and POST to /api/lead
- `functions/api/lead.js` - Cloudflare Pages Function: validates, emails via Resend, stores in KV
- `img/showcase/` - concept screenshots (desktop + mobile)
- `concepts/` - the 10 sales concept sites (do not modify)

## Backend setup

1. In the Cloudflare dashboard (Pages project > Settings > Environment variables):
   - `RESEND_API_KEY` - Resend API key (secret, required for lead emails)
   - `LEAD_TO_EMAIL` - destination for lead emails (default: hello@freightfolio.net)
2. Create a KV namespace and paste its ID into `wrangler.toml` (`LEADS_KV`). Optional at runtime.

## Design notes

See `DESIGN.md` for the three visual concepts evaluated and why "Violet Aurora" was chosen.
