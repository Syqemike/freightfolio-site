# Freightfolio — Environment Variables

Every variable the Cloudflare Pages Functions need, where it is set, and
what breaks if it is missing. Secret values live **only** in the Cloudflare
dashboard (Pages project > Settings > Environment variables); they are never
committed to git. Non-secret config is also declared in `wrangler.toml [vars]`.

## KV namespace bindings

| Binding    | Purpose                                              | Required by                          |
|------------|------------------------------------------------------|--------------------------------------|
| `ORDER_KV` | Orders, customers, Stripe mappings, upload-link state | order-store.js, customer.js, uploads |
| `EVENT_LOG`| Append-only Stripe webhook event audit log            | api/stripe-webhook.js                |

Declared in `wrangler.toml`. Paste the real namespace IDs from
Workers & Pages > KV before a rebuild.

## Secrets (dashboard only — never in git)

| Variable               | Purpose                                              | Missing behavior                          |
|------------------------|------------------------------------------------------|-------------------------------------------|
| `STRIPE_WEBHOOK_SECRET`| HMAC verification of Stripe webhook signatures       | Webhook returns 400 on every event        |
| `UPLOAD_TOKEN_SECRET`  | HMAC signing of upload tokens                        | Order creation + uploads fail (500)       |
| `RECOVERY_UPLOAD_SECRET` | HMAC signing of recovery upload-link tokens (single-requirement scope, 7-day TTL; VM mints, site verifies) | Recovery upload endpoint returns 500; VM-side minting must use the same value (600-perm file on the VM) |
| `SESSION_SECRET`       | Workspace magic-link session cookie signing          | Login/workspace fail                      |
| `RESEND_API_KEY`       | Resend API key for all outbound email                | No customer or ops emails send            |
| `INTAKE_INTERNAL_KEY`  | Shared secret for bridge → site internal endpoints   | Bridge status pushes rejected (401)       |
| `B2_KEY_ID`            | Backblaze B2 application key ID (bucket-restricted)  | Uploads/downloads fail                    |
| `B2_KEY_SECRET`        | Backblaze B2 application key secret                  | Uploads/downloads fail                    |

## Non-secret config

| Variable           | Default in wrangler.toml          | Purpose                                    |
|--------------------|-----------------------------------|--------------------------------------------|
| `PUBLIC_ORIGIN`    | `https://freightfolio.net`        | Absolute URLs in emails and upload links   |
| `OPS_NOTIFY_EMAIL` | `freightfolio.ops@gmail.com`      | Ops notifications recipient                |
| `B2_BUCKET`        | `Freightfolio-uploads`            | B2 bucket name                             |
| `B2_BUCKET_ID`     | *(dashboard)*                     | B2 bucket ID (used for some native API calls) |
| `B2_ENDPOINT`      | `s3.us-east-005.backblaze2.com`   | B2 S3-compatible endpoint                  |
| `B2_REGION`        | `us-east-005`                     | B2 region for S3 signing                   |

## Setting a secret

Dashboard: Pages project > Settings > Environment variables > Add variable >
type "Secret". Or via wrangler:

```bash
npx wrangler pages secret put STRIPE_WEBHOOK_SECRET --project-name freightfolio-site
```

## Rebuild checklist

1. `wrangler.toml` — fill in the two KV namespace IDs.
2. This file — set all 7 secrets in the dashboard.
3. Verify non-secret `[vars]` match production values above.
4. `git push origin main` — Pages auto-deploys.
5. Smoke test: `/api/health` (if present), Stripe webhook signature check,
   upload-link resend for a test email.
