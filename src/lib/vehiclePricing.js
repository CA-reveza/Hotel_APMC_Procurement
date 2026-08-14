// Ported from the standalone "motor" app's src/lib/pricing.js — same
// Porter-style vehicle catalog and fare formula, reused here for delivery
// bookings on orders instead of a separate ride-booking flow.

export const VEHICLE_TYPES = [
  { id: 'bike', label: 'Two-Wheeler', desc: 'Small parcels, documents', capacityKg: 20, base: 30, perKm: 6 },
  { id: 'three_wheeler', label: '3-Wheeler', desc: 'Small loads, tight lanes', capacityKg: 300, base: 60, perKm: 11 },
  { id: 'pickup', label: 'Pickup Truck', desc: 'Furniture, appliances', capacityKg: 750, base: 120, perKm: 16 },
  { id: 'mini_truck', label: 'Mini Truck', desc: 'Bulk goods, house shift', capacityKg: 1500, base: 220, perKm: 22 },
  { id: 'large_truck', label: 'Large Truck', desc: 'Full house / commercial', capacityKg: 5000, base: 450, perKm: 34 }
]

export function vehicleById(id) {
  return VEHICLE_TYPES.find((v) => v.id === id)
}

// No geocoding/maps integration in this project, so distance is entered
// manually by whoever books the vehicle (supplier/admin) rather than
// computed from lat/lng like motor's Haversine helper did.
export function estimateFare(vehicleTypeId, km) {
  const v = vehicleById(vehicleTypeId)
  if (!v || !km || km <= 0) return 0
  return Math.round(v.base + v.perKm * Math.max(km, 1))
}
