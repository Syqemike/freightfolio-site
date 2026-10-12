# freightfolio-site

Public website for Freightfolio (https://freightfolio.net).

This repo is connected to the `freightfolio` Cloudflare Pages project — every push to `main` auto-deploys.

- `index.html` — homepage
- `privacy.html` — privacy & data-handling policy
- `sample-dashboard.html` — sample billing-readiness dashboard (generated from `product/src/dashboard.py`)
- `sample-report.xlsx` — sample Excel report (generated from the pipeline)
- `assets/` — stylesheet and logos


## Missing-Document Recovery add-on — billing core (staging)

$99/month paid add-on. Entitlement lives on the customer record as
`customer.recovery` (see `lib/customer.js` header for the full field/schema
docs). Product/price configuration lives ONLY in
`lib/recovery-entitlements.js` — nothing else hardcodes product names,
price ids, or allowances.

### Stripe price setup (Mike, in the Stripe dashboard — test mode first)

1. Create a **$99.00/month recurring** product named "Missing-Document Recovery".
2. Copy the real price id (`price_...`).
3. Paste it over the placeholder in `lib/recovery-entitlements.js`
   (`RECOVERY_ADDON.priceId`, currently `"price_TBD_CREATE_IN_STRIPE_DASHBOARD"`).
4. Do NOT create products/prices/charges via the API — the available Stripe
   connection is live-only and the price does not exist yet.

Entitlement comes ONLY from verified webhook events → KV records. A
checkout-success page or any browser flag must NEVER enable service.

### Eligibility rule (the gate the recovery engine enforces)

Chasing runs ONLY when ALL THREE hold:

(a) `recoveryEntitled(customer)` — entitlement is `addon` or
    `managed_included` AND status is `active`/`grace` (or `past_due` with the
    7-day grace window still open);
(b) customer authorization complete — `authorized_at` set AND
    `setup.approved === true`;
(c) valid operational config + approved contacts —
    `setup.config_valid === true` AND `setup.contacts_approved === true`.

A fresh purchase lands at status `awaiting_setup`: **payment alone never
enables chasing.**

### Grace / cancel semantics

- `invoice.payment_failed` → status `past_due`, `grace_until` = now + 7 days.
  Chasing CONTINUES during the grace window. Redeliveries never extend it.
- Grace expiry → `paused` (evaluated lazily by the internal endpoints via
  `applyRecoveryLifecycle()` — the VM worker's periodic eligibility checks
  drive the transition; no separate cron needed).
- `cancel_at_period_end` → status stays `active` with `cancel_scheduled=true`
  until the period ends; then `canceled`. Immediate delete → `canceled` now.
- `invoice.paid` after `past_due`/`grace`/`paused` → status restored to the
  pre-failure status (or `awaiting_setup`).
- The 50-request monthly allowance resets ONLY when Stripe advances
  `current_period_start` — never on plan changes, duplicate, or out-of-order
  events. All webhook writes are idempotent and converge.
- Stripe prorates the first add-on charge when it is added mid-cycle; when a
  prorated line item is detected on the invoice, a `proration_note` is stored
  on the entitlement record disclosing this.

### Managed-service path

Ops sets `entitlement: "managed_included"` (status `active`) ONLY via
`POST /api/internal/recovery-admin` (`set_managed`). The webhook rejects any
add-on purchase for a `managed_included` customer as a duplicate — the $99
charge must never apply to managed customers.

### Internal endpoints (all guarded by `x-intake-key` = INTAKE_INTERNAL_KEY)

- `GET /api/internal/recovery-eligibility?email=` → `{ eligible, reasons[],
  entitlement, status, allowance_remaining, overage_cap_cents, ... }` for the
  VM worker. Never exposes secrets.
- `POST /api/internal/recovery-usage-sync` ← VM pushes
  `{ email, period_start, period_end?, requests_used, overage_units }`.
  Idempotent and monotonic — counters never decrease; a later `period_start`
  resets the baseline.
- `POST /api/internal/recovery-admin` (ops only) →
  `set_managed` / `clear_managed` / `set_authorization` / `clear_authorization` /
  `set_status` / `set_overage_cap`. Every call is audit-logged to KV
  (`recovery_audit:*`).

Tests: `node --test tests/recovery-billing.test.js` (synthetic `livemode:false`
events only — no live Stripe, no real emails).
