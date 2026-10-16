/**
 * Feature entitlements. Paid-tier features unlock two ways:
 *   · local mode — the operator self-hosts the instance (SELF_HOSTED=true);
 *   · a paid plan — the store row carries plan = 'pro'.
 * Billing itself is out of scope here; hosted plan changes flow in later.
 */
import { config } from '../config.js';

/** Which paid-tier features a store may use right now. */
export function entitlementsFor(store) {
  return {
    productImages: config.selfHosted || store.plan === 'pro',
  };
}

export function productImagesEnabled(store) {
  return entitlementsFor(store).productImages;
}
