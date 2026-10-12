# Missing-Document Recovery add-on — BLOCKERS (must be true before activation)

Last updated: 2026-10-11 (staging branch `addon-recovery-billing`).
Blunt version: the billing, metering, and UX pieces now integrate and all
tests pass, but the thing that actually SENDS EMAILS is not cleared to run.

## Hard blockers

1. **Independent engine review has NOT passed.** The 4th ChatGPT review pass
   is in flight (10 high-priority unattended-operation findings from the 3rd
   review). Do not activate the worker until the review passes AND Mike
   approves a concrete per-customer config.

2. **The $99 price and payment link do not exist.** `lib/recovery-entitlements.js`
   still holds `price_TBD_CREATE_IN_STRIPE_DASHBOARD`; `js/recovery-addon.js`
   still holds `REPLACE_ME_CREATE_IN_DASHBOARD`. Until Mike creates them in
   the Stripe dashboard (test mode first), no real purchase is possible —
   and no synthetic/placeholder value may ever be treated as real.

3. **No live email has ever been sent.** The only authorized live test is
   the allowlisted `michaelmccaryk@gmail.com` loop (synthetic order, test
   approval, chase email to his inbox only, POD reply to complete it).
   Unattended outbound email to real carrier contacts is NOT approved.

4. **Upload endpoint undeployed.** The recovery branch (`recovery-system`)
   is unmerged; the token-upload leg of the live test cannot run until it
   is deployed. The email→reply→ingest→validate→resolve path is the only
   live-tested one.

5. **No worker cron exists.** The recovery engine worker has no scheduled
   runs (the cron doc omits `--live`). Creating it is the activation
   decision itself — do not create it until blockers 1–4 clear.

6. **KV has no backup.** `customer:{hash}` records (entitlements, usage
   counters, audit) live only in Cloudflare KV. There is no automated KV
   backup; a KV loss wipes billing state. Needs the KV-read API token Mike
   must create in the Cloudflare dashboard.

7. **Single email provider.** Outbound is Resend-only. A Resend outage or
   suspension halts all chase/delivery email with no failover.

8. **Overage auto-charging has no mechanism.** There is no server-side
   Stripe key, so overage ($2/request within cap) CANNOT be charged
   automatically. Until Mike decides (server-side key vs. manual monthly
   invoices from the reconcile report), the honest posture is: keep the
   default $0 cap posture prominent in the UI and invoice any approved
   overage manually. The customer cancel endpoint likewise cannot cancel
   the Stripe subscription — ops must do it in the dashboard
   (`manual_stripe_action` is returned by the endpoint so this is visible).

9. **Pre-existing test failure (not caused by this workstream).**
   `tests/webhook-workspace.test.js` → "unknown event types are left for
   stripe-watch" fails at clean HEAD (`38523e9`) too — verified via
   `git archive HEAD`. Left alone deliberately; whoever owns that test
   should fix or update it before it masks a real regression.

## Soft blockers / known gaps

- **Metering `entitlements.json` is manual.** The VM usage-sync runner
  reads customer entitlements from a local file; there is no automated
  site→VM entitlement feed yet. Stale terms (e.g. a cap lowered on the
  site) propagate only when the file is refreshed.
- **No Stripe customer portal.** Billing changes (beyond cancel/cap, which
  have endpoints) go through email to ops.
- **Audit retention.** `recovery_audit:*` keys have no TTL; add one before
  the log grows unbounded (90 days suggested).
- **Mobile viewports** for the new Recovery tab/admin section were not
  live-verified.
- **Branch hygiene.** `addon-recovery-billing` is unmerged with uncommitted
  integrator changes; `recovery-system` is unmerged. Review-package rebuild
  was intentionally NOT run (per instructions).

## What IS done (staging-verified)

- Billing core: purchase → `awaiting_setup` (never active), grace/cancel/
  reactivation, allowance reset on period advance only, managed_included
  and pilot guards. 26 unit + 23 integration tests green.
- Customer endpoints: setup/pause/resume/overage-cap/cancel (+ admin
  read), session-authed, customer-isolated; `recovery` exposed in `/api/me`;
  reauth trigger wired into the eligibility gate.
- Metering: locked ledger, watermarked scanner (bills only
  provider-accepted initial sends, exactly once), allowance/overage gate,
  reconcile, `sync_runner.py` (dry-run default, `--live` posts with
  x-intake-key + browser User-Agent).
- Demo: `demo_addon_flow.py` runs the full synthetic loop with printed
  evidence at each step.
