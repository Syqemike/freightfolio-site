# Missing-Document Recovery add-on ($99/mo) — Launch Checklist

Branch: `addon-recovery-billing` (staging). This doc is the exact production
sequence. Do the steps in order; each has a verification.

Product terms (single source of truth: `lib/recovery-entitlements.js`):
- $99.00/month recurring, 50 document requests per billing month included
- Overage $2.00 per request, ONLY within a customer-approved monthly cap
  (default $0 = overage blocked; excess requests queue instead of billing)
- Payment alone NEVER enables chasing: a new purchase lands at
  `awaiting_setup`; the customer must complete onboarding (contacts,
  sending identity, templates, cadence + explicit permission) before the
  engine may send anything

## Behavior summary

| Event | Result |
|---|---|
| Purchase (payment link) | entitlement `addon`, status `awaiting_setup`. No chasing. |
| Onboarding submit (valid) | authorization recorded, status → `active`. Engine may chase. |
| Contacts/identity/templates/cadence changed | new config saved, `reauth_required` set, outreach paused until customer re-approves |
| invoice.payment_failed | status `past_due`, 7-day grace (chasing continues during grace) |
| Grace expires (lazy, on next eligibility/usage call) | status `paused` |
| invoice.paid during grace/paused | restores prior status (or `awaiting_setup` if never authorized) |
| invoice.paid with a NEW period | allowance resets to 50; usage counters reset |
| invoice.paid same period (duplicate/out-of-order) | NO reset; converges |
| Customer cancel (workspace) | `cancel_scheduled`, service runs to period end; ops MUST also cancel in Stripe dashboard (no server-side key) |
| subscription.deleted (Stripe) | `canceled` immediately |
| Re-purchase after cancel | new entitlement, `awaiting_setup` again |
| managed_included customer tries to buy | rejected as duplicate (`managed_included_duplicate`) |
| Overage cap change | raise/lower/disable anytime; never below $ already incurred |
| 51st request at $0 cap | engine gate returns `queued_cap` — queued, NOT sent, NOT billed |

## Steps

### 1. Stripe dashboard (Mike, TEST mode first)
- [ ] Create product **"Missing-Document Recovery"**, $99.00/month recurring.
- [ ] Create a payment link for it. Add metadata on the link:
      `recovery_addon = <the price id>` (fallback detection if Stripe does
      not expand line_items in the webhook payload).
- [ ] Verify: run the integration suite (`node --test tests/recovery-addon-integration.test.js`)
      — it uses the configured price id synthetically.

### 2. Config (code)
- [ ] In `lib/recovery-entitlements.js`: replace
      `price_TBD_CREATE_IN_STRIPE_DASHBOARD` with the real price id.
- [ ] In `js/recovery-addon.js`: replace `REPLACE_ME_CREATE_IN_DASHBOARD`
      in `RECOVERY.PAYMENT_LINK` with the real payment link.
- [ ] Commit, merge `addon-recovery-billing` → main, deploy to Cloudflare Pages.
- [ ] Verify: redeploy completes; no other file hardcodes the price (grep `price_`).

### 3. Environment variables (Cloudflare Pages → freightfolio → Production)
- [ ] `INTAKE_INTERNAL_KEY` — already set? Confirm value matches the VM
      creds file (`hidden_files/backblaze-b2-credentials.txt`, 600 perms,
      `INTAKE_INTERNAL_KEY=` line). The usage-sync runner and eligibility
      checks need it.
- [ ] `SESSION_SECRET` — already set (customer workspace auth).
- [ ] Verify: `GET /api/internal/recovery-eligibility?email=` with the key
      returns 401 without it, 404 for unknown customer with it.

### 4. VM metering (ops VM, `recovery-metering/`)
- [ ] Copy a seed `entitlements.json` into the metering dir
      (`{email: {email, billing_period_start, billing_period_end, allowance,
      overage_cap_cents}}` per add-on customer; refresh from
      `GET /api/admin/recovery`).
- [ ] Dry-run: `python3 sync_runner.py --all` → payloads print, exit 0,
      no POST.
- [ ] Live test: `python3 sync_runner.py --email <allowlisted> --live`
      → 200 from the usage-sync endpoint.
- [ ] Create the cron (see §Cron below) with `--live`, every 15 min.
- [ ] Verify: usage in the workspace Recovery tab increments after a real
      billable send; `reconcile.py` shows no anomalies.

### 5. Worker activation (the recovery engine itself)
- [ ] BLOCKED until BLOCKERS.md is cleared (independent engine review has
      NOT passed; no live email ever sent; upload endpoint undeployed).
- [ ] When cleared: create the worker cron (worker.py --live per the engine
      runbook), confirm the first cycle reports `eligible:false` until the
      allowlisted test customer completes onboarding.

### 6. Allowlisted live test (Mike's call, after steps 1–5)
- [ ] Synthetic order on `michaelmccaryk@gmail.com` (per the standing live-test
      authorization): purchase via the TEST-mode link → `awaiting_setup` in
      the workspace tab → complete onboarding → `active`.
- [ ] Trigger one chase email to his inbox ONLY (test approval recorded).
- [ ] He replies with a POD attachment → ingest → validate → resolve.
- [ ] Verify in order: scanner counts exactly 1 billable unit; usage-sync
      payload posts; workspace shows 49 remaining; the customer delivery
      email and ops notification send.
- [ ] Then repeat in LIVE mode with the live price/link before any real
      customer.

### 7. Customer rollout
- [ ] Flip the payment link + price id from test to live values in config,
      redeploy.
- [ ] Announce to the pilot list (email template in the outreach queue;
      keep the CAN-SPAM footer).
- [ ] Watch `GET /api/admin/recovery` daily for the first week:
      entitlements, `past_due`/`grace` states, audit trail.

### Cron (when activated)

```
# usage sync — VM cron, every 15 minutes
*/15 * * * * cd ~/workspace/goals/build-my-ai-automation-company/hidden_files/recovery-metering && python3 sync_runner.py --all --live >> sync_runner.log 2>&1
```

`sync_runner.py` defaults to DRY-RUN (prints payloads, no POST). `--live`
is required to POST. Key resolution: `INTAKE_INTERNAL_KEY` env, else
`--key-file`, else the 600-perm creds file. The key is never logged.

## Rollback

- Disable the Stripe payment link (stops new purchases).
- `POST /api/internal/recovery-admin` `{action:"set_status", status:"paused"}`
  per customer, or kill-switch the worker cron. Billing-side state is
  untouched by pausing; already-paid periods are unaffected.
