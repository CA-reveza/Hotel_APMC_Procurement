// Delivery charge: ₹140 flat for up to 5 km, then +₹20 for every km beyond
// that. Partial km beyond the base are rounded up (e.g. 5.5km extra -> 6km
// worth of per-km charge), so the charge never falls short of actual
// distance covered.
export const BASE_DELIVERY_KM = 5
export const BASE_DELIVERY_CHARGE = 140
export const PER_KM_CHARGE = 20

export function deliveryCharge(km) {
  const distance = Number(km)
  // No such thing as free delivery — a missing/invalid/zero distance still
  // charges the base rate rather than defaulting to ₹0.
  if (!distance || distance <= BASE_DELIVERY_KM) return BASE_DELIVERY_CHARGE
  return BASE_DELIVERY_CHARGE + Math.ceil(distance - BASE_DELIVERY_KM) * PER_KM_CHARGE
}

export const PLATFORM_FEE_PCT = 3

export function platformFee(subtotal) {
  return Math.round(Number(subtotal) * PLATFORM_FEE_PCT) / 100
}
