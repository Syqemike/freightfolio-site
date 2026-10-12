/**
 * lib/recovery-entitlements.js — entitlement CONFIG for sellable products.
 *
 * This is the ONLY place product/price configuration lives. Nothing else in
 * the codebase hardcodes a product name, price id, or allowance.
 *
 * ---------------------------------------------------------------------------
 * STRIPE PRICE SETUP (Mike does this in the Stripe DASHBOARD — test mode
 * first, then live):
 *   1. Create a $99.00/month recurring product "Missing-Document Recovery".
 *   2. Copy the real price id (starts with "price_...").
 *   3. Replace RECOVERY_ADDON.priceId below with the real id.
 *
 * RULES (do not break these):
 *   - NEVER guess a price id. Until the real id is pasted in, the placeholder
 *     below matches NOTHING in Stripe's systems — only synthetic test events.
 *   - NEVER create products/prices/charges through the API. The Stripe
 *     connection available to this project is live-only; the price does not
 *     exist yet, so there is nothing safe to call.
 *   - Entitlement ALWAYS comes from verified webhook events -> KV records.
 *     A checkout-success page or any browser flag must NEVER enable service.
 * ---------------------------------------------------------------------------
 */

/**
 * The $99/month Missing-Document Recovery paid add-on.
 * Attaches to a customer record as customer.recovery (see lib/customer.js).
 */
export const RECOVERY_ADDON = {
  // PLACEHOLDER — see setup instructions above. Replace with the real
  // Stripe price id once Mike creates it in the dashboard.
  priceId: "price_TBD_CREATE_IN_STRIPE_DASHBOARD",
  name: "Missing-Document Recovery",
  amountCents: 9900,
  /** Chase requests included per billing month. */
  monthlyAllowance: 50,
  /** Per-request overage when the allowance is exhausted. */
  overageCentsPerRequest: 200,
  /** Default overage cap (0 = overage disabled; engine stops at allowance). */
  defaultOverageCapCents: 0,
};

/**
 * Registry of known Stripe price ids. Future products get entries here so
 * entitlementForPriceId() can classify them without touching call sites.
 *
 * Base plans are NOT listed yet: they are sold via payment links and are
 * identified by amount_cents via planForAmountCents() (see lib/customer.js).
 * Catalog their price ids here if/when fixed prices are created.
 */
const BASE_PRICE_IDS = {
  // "price_...": "starter" | "business" | "premium",
};

/** True only for the Missing-Document Recovery add-on price id. */
export function isRecoveryAddonPrice(priceId) {
  return (
    typeof priceId === "string" &&
    priceId.length > 0 &&
    priceId === RECOVERY_ADDON.priceId
  );
}

/**
 * Classify a Stripe price id.
 * Returns { kind: "recovery_addon" | "base" | "unknown", ... }.
 * "unknown" means: not a cataloged product — never grant service for it.
 */
export function entitlementForPriceId(priceId) {
  if (isRecoveryAddonPrice(priceId)) {
    return { kind: "recovery_addon", addon: RECOVERY_ADDON };
  }
  if (typeof priceId === "string" && BASE_PRICE_IDS[priceId]) {
    return { kind: "base", plan: BASE_PRICE_IDS[priceId] };
  }
  return { kind: "unknown", priceId: priceId || null };
}
