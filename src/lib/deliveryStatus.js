// Single source of truth for "what stage is this delivery at", used by both
// the compact order-list Delivery column and the full DeliveryPanel summary.
export function getDeliveryStatus(delivery) {
  if (!delivery) return { label: 'Not set up', className: 'muted' }

  if (delivery.delivered_at) return { label: 'Delivered', className: 'delivered' }
  if (delivery.in_transit_at) return { label: 'In transit', className: 'in-transit' }
  if (delivery.picked_up_at) return { label: 'Picked up', className: 'picked-up' }

  if (delivery.fulfilled_via === 'motor') {
    const s = delivery.motor_status
    if (s === 'in_transit') return { label: 'MOTOR: in transit', className: 'in-transit' }
    if (s === 'picked_up') return { label: 'MOTOR: picked up', className: 'picked-up' }
    if (s === 'accepted') return { label: 'MOTOR: driver assigned', className: 'assigned' }
    if (s === 'completed') return { label: 'MOTOR: delivered', className: 'delivered' }
    if (s === 'cancelled') return { label: 'MOTOR: cancelled', className: 'cancelled' }
    return { label: 'MOTOR: waiting for driver', className: 'requested' }
  }

  if (delivery.vehicle_type) {
    return delivery.driver_id
      ? { label: 'Driver assigned', className: 'assigned' }
      : { label: 'Waiting for driver', className: 'requested' }
  }

  if (delivery.partner_name) return { label: 'Assigned', className: 'assigned' }

  return { label: 'Not set up', className: 'muted' }
}
