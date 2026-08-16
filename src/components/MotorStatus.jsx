import { useEffect, useState } from 'react'
import { motorSupabase } from '../motorClient'
import { supabase } from '../supabaseClient'

const MOTOR_STATUS_LABEL = {
  pending: 'Waiting for a driver to accept',
  accepted: 'Driver assigned',
  picked_up: 'Picked up',
  in_transit: 'In transit',
  completed: 'Delivered',
  cancelled: 'Cancelled'
}

// Subscribes directly to MoveIT's own Realtime feed for this one booking (if
// VITE_MOTOR_SUPABASE_URL/ANON_KEY are configured), and mirrors any change
// back onto OrderIt's own deliveries row — both `motor_status` (for this
// badge) AND the picked_up_at/in_transit_at/delivered_at timestamps (which
// DeliveryPanel's summary line and manual-button visibility actually read),
// so the two don't drift out of sync with each other. This is a second,
// independent path to the same data the motor-status-webhook Edge Function
// writes — whichever one fires first wins, and both writing the same values
// again later is harmless.
export default function MotorStatus({ orderId, motorBookingId, fallbackStatus }) {
  const [status, setStatus] = useState(fallbackStatus)

  useEffect(() => { setStatus(fallbackStatus) }, [fallbackStatus])

  useEffect(() => {
    if (!motorSupabase || !motorBookingId) return

    const mirror = (newStatus) => {
      const patch = { motor_status: newStatus }
      const now = new Date().toISOString()
      if (newStatus === 'picked_up') patch.picked_up_at = now
      if (newStatus === 'in_transit') patch.in_transit_at = now
      if (newStatus === 'completed') patch.delivered_at = now
      supabase.from('deliveries').update(patch).eq('order_id', orderId)
    }

    motorSupabase
      .from('bookings')
      .select('status')
      .eq('id', motorBookingId)
      .maybeSingle()
      .then(({ data }) => { if (data?.status) { setStatus(data.status); mirror(data.status) } })

    const channel = motorSupabase
      .channel(`motor-booking-${motorBookingId}`)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'bookings', filter: `id=eq.${motorBookingId}` },
        (payload) => { setStatus(payload.new.status); mirror(payload.new.status) }
      )
      .subscribe()

    return () => motorSupabase.removeChannel(channel)
  }, [motorBookingId, orderId])

  return (
    <span className="muted small">
      🏍️ MoveIT: {MOTOR_STATUS_LABEL[status] || status || 'Booked'}
      {!motorSupabase && ' (live tracking not configured — see README)'}
    </span>
  )
}
