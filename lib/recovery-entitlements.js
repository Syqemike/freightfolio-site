/**
 * lib/recovery-entitlements.js — entitlement CONFIG for sellable products.
 *
 * This is the ONLY place product/price configuration lives. Nothing else in
 * the codebase hardcodes a product name, price id, or allowance.
 *
 * ---------------------------------------------------------------------------
 * STRIPE (live, configured 2026-10-11):
 *   Product prod_VQOcL2Gq7iYqit "Missing-Document Recovery",
 *   Price   price_1UPXpPAN6U5YE12V63eLnhco ($99.00/month recurring),
 *   set as RECOVERY_ADDON.priceId below.
 *
 * RULES (do not break these):
 *   - NEVER guess a price id. Only the id above matches Stripe's systems —
 *     synthetic test events use livemode:false and never touch it.
 *   - NEVER create products/prices/charges through the API.
 *   - Entitlement ALWAYS comes from verified webhook events -> KV records.
 *     A checkout-success page or any browser flag must NEVER enable service.
 * ---------------------------------------------------------------------------
 */

/**
 * The $99/month Missing-Document Recovery paid add-on.
 * Attaches to a customer record as customer.recovery (see lib/customer.js).
 */
export const RECOVERY_ADDON = {
  // Live Stripe objects (created 2026-10-11): product prod_VQOcL2Gq7iYqit,
  // price price_1UPXpPAN6U5YE12V63eLnhco ($99/mo recurring).
  priceId: "price_1UPXpPAN6U5YE12V63eLnhco",
  name: "Missing-Document Recovery",
  amountCents: 9900,
  /** Chase requests included per billing month. */
  monthlyAllowance: 50,
  /** No overage: requests beyond the monthly allowance wait in the queue
   *  for the next billing cycle at no extra charge. */
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
