# Customer workspace — live verification checklist

Deployed: 2026-10-10 ~11:30pm CDT. Merge commit `99aece6` on main.
Live: https://freightfolio.net/login · https://freightfolio.net/workspace · https://freightfolio.net/admin

## BLOCKER (parent must do first)
Set `SESSION_SECRET` in the Cloudflare dashboard:
Pages project `freightfolio` → Settings → Environment variables → Production
(and Preview). Value: the 64-hex string in
`~/workspace/goals/build-my-ai-automation-company/hidden_files/backblaze-b2-credentials.txt`
(600-perm, "Customer workspace secrets" section). Redeploy after adding
(or it picks up on the next deploy). Until then, /api/auth/* and /api/me
return 503/500 `not_configured` — graceful, old flows unaffected.

## Ready-made synthetic fixture (already in production KV)
- Test order: `ord_f8c71a67da6f4f9ff3c5a3328e8bf5dd` (test: namespace)
- Test email: `freightfolio.ops+workspacetest@gmail.com`
- Status: `received` (set via live /api/internal/status test)
- No real payment, no real emails sent.

## Live test script (after SESSION_SECRET is set)
1. POST /api/auth/request {email: test address} → 200 generic.
2. Read the magic link from Gmail (Freightfolio account only).
3. Open the link → /api/auth/verify → 200, cookie set → redirected to /workspace/.
4. /api/me → 200, current_order = ord_f8c71a67…, allowance 10, remaining 10.
5. Upload a synthetic PDF via the workspace (session cookie, no token).
6. POST /api/internal/status (real INTAKE_INTERNAL_KEY) → status
   `processing`, then with a report_files entry → `delivered`.
7. /api/reports → lists it; download → 302 to a 15-min presigned URL.
8. Second test customer (create another via /api/internal/test-order):
   verify A cannot read B's order/files/reports (403/empty).
9. Sign out → /api/me → 401. Expired token → 410. Forged cookie → 401.
10. Admin: magic link for freightfolio.ops@gmail.com → /admin → batches
    list shows the test order (badged "test"); set status; add note/issue;
    check the audit log entry; resend notification on a REAL order only.

## Mobile viewport pass (could NOT verify as subagent — no browser tools)
Check live at 360 / 390 / 768 px widths:
- https://freightfolio.net/login (form)
- https://freightfolio.net/workspace (all 6 tabs, esp. Uploads dropzone + tables)
- https://freightfolio.net/admin (batch table)
- Header "Customer login" link visible in the mobile hamburger menu
Responsive CSS was verified statically only (workspace.css media queries).

## Notes
- Bridge status sync is live in process_orders.py; next 15-min poll will push
  statuses for any orders it processes. INTAKE_INTERNAL_KEY is read from the
  local 600-perm credentials file (verified it loads).
- Rollback: `git revert -m 1 99aece6` on main, push. Old token-link upload
  flow was never modified in behavior (only extended with a session fallback).
