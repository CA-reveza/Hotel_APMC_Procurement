// supabase/functions/motor-status-webhook/index.ts
//
// Receives a push from MoveIT's own Supabase Database Webhook (configured on
// MoveIT's project, not OrderIt's) every time a booking row changes — most
// importantly, when a driver accepts one. Updates OrderIt's own `deliveries`
// row (and, once the delivery has actually started moving, the parent
// order's own status too) so both show up immediately in the Hotel and
// Supplier order lists, without the browser needing to be looking at that
// specific order or have MoveIT's anon key configured.
//
// This is the server-to-server counterpart to src/components/MotorStatus.jsx
// (which does a lighter client-side live subscription when configured) —
// this webhook is what makes status show up in the compact order-list
// Delivery column reliably, for every viewer, all the time.
//
// Deploy:
//   supabase functions deploy motor-status-webhook --no-verify-jwt
// (--no-verify-jwt because MoveIT's webhook caller has no OrderIt user JWT —
// instead we verify a shared secret header below.)
//
// Secrets (set once, on the OrderIt project):
//   supabase secrets set MOTOR_WEBHOOK_SECRET=some-long-random-string
//
// Then, on the MoveIT project: Database → Webhooks → Create a new webhook
//   Table: bookings   Events: Update
//   Type: HTTP Request → URL: <this function's URL>
//   HTTP Headers: add `x-webhook-secret: <same value as MOTOR_WEBHOOK_SECRET>`
// (Env var / secret names below still say MOTOR since that's what's already
// configured in both Supabase projects — renaming those needs a coordinated
// change on both sides, not just this file.)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MOTOR_WEBHOOK_SECRET = Deno.env.get('MOTOR_WEBHOOK_SECRET')

Deno.serve(async (req) => {
  try {
    // Verify this really came from the MOTOR webhook, not a random caller —
    // this function is deployed with --no-verify-jwt (public URL) since
    // MOTOR has no OrderIt session to send.
    if (MOTOR_WEBHOOK_SECRET) {
      const provided = req.headers.get('x-webhook-secret')
      if (provided !== MOTOR_WEBHOOK_SECRET) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
      }
    }

    const payload = await req.json()
    // Supabase Database Webhooks send { type, table, record, old_record }
    const booking = payload.record
    if (!booking?.id) return new Response(JSON.stringify({ error: 'No booking record in payload' }), { status: 400 })

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    const update: Record<string, unknown> = { motor_status: booking.status }
    if (booking.status === 'accepted' && booking.driver_id) {
      // Note: this is MoveIT's driver id, in MoveIT's own auth system —
      // stored here only for display, not linked to an OrderIt profile.
      update.motor_driver_id = booking.driver_id
    }
    if (booking.status === 'picked_up') update.picked_up_at = new Date().toISOString()
    if (booking.status === 'in_transit') update.in_transit_at = new Date().toISOString()
    if (booking.status === 'completed') update.delivered_at = new Date().toISOString()

    const { data: updatedDelivery, error } = await admin
      .from('deliveries')
      .update(update)
      .eq('motor_booking_id', booking.id)
      .select('order_id')
      .maybeSingle()

    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })

    // Also advance the parent order's own tracking status, so the
    // Placed→Accepted→Packed→"In MoveIT"→Delivered stepper moves forward
    // automatically instead of needing a separate manual "Mark Out for
    // delivery" click once a MoveIT driver has actually picked the order up.
    // Only ever moves forward — never overwrites a later manual state like
    // 'rejected' or 'cancelled'.
    if (updatedDelivery?.order_id) {
      const orderStatus =
        booking.status === 'completed'
          ? 'delivered'
          : ['picked_up', 'in_transit'].includes(booking.status)
            ? 'out_for_delivery'
            : null
      if (orderStatus) {
        await admin
          .from('orders')
          .update({ status: orderStatus })
          .eq('id', updatedDelivery.order_id)
          .in('status', ['packed', 'out_for_delivery'])
      }
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 })
  }
})
