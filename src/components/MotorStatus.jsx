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

// Subscribes directly to MOTOR's own Realtime feed for this one booking (if
// VITE_MOTOR_SUPABASE_URL/ANON_KEY are configured), and mirrors any change
// back onto OrderIt's own deliveries row so it's visible even when MOTOR
// integration isn't configured on other screens/sessions.
export default function MotorStatus({ orderId, motorBookingId, fallbackStatus }) {
  const [status, setStatus] = useState(fallbackStatus)

  useEffect(() => { setStatus(fallbackStatus) }, [fallbackStatus])

  useEffect(() => {
    if (!motorSupabase || !motorBookingId) return

    const mirror = (newStatus) => {
      supabase.from('deliveries').update({ motor_status: newStatus }).eq('order_id', orderId)
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
