// supabase/functions/book-motor-delivery/index.ts
//
// Bridges an OrderIt delivery to a real booking in the separate MOTOR app.
// MOTOR is a different Supabase project with its own auth — OrderIt users
// don't have MOTOR accounts, so this Edge Function uses MOTOR's
// *service-role* key (bypassing MOTOR's RLS) to insert the booking directly.
// MOTOR's existing driver console then picks it up exactly like any other
// pending booking — no changes needed on the MOTOR side beyond the
// RUN_ON_MOTOR_PROJECT_bridge.sql migration.
//
// Deploy:
//   supabase functions deploy book-motor-delivery
// Secrets (set once, on the OrderIt project):
//   supabase secrets set MOTOR_SUPABASE_URL=https://xxxx.supabase.co MOTOR_SERVICE_ROLE_KEY=xxx

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MOTOR_SUPABASE_URL = Deno.env.get('MOTOR_SUPABASE_URL')!
const MOTOR_SERVICE_ROLE_KEY = Deno.env.get('MOTOR_SERVICE_ROLE_KEY')!

// Same catalog/formula as src/lib/vehiclePricing.js — duplicated here since
// Edge Functions can't import from the app's src/ tree, and re-computing the
// fare server-side (rather than trusting whatever the client sent) keeps the
// number honest.
const VEHICLE_TYPES: Record<string, { base: number; perKm: number }> = {
  bike: { base: 30, perKm: 6 },
  three_wheeler: { base: 60, perKm: 11 },
  pickup: { base: 120, perKm: 16 },
  mini_truck: { base: 220, perKm: 22 },
  large_truck: { base: 450, perKm: 34 }
}
function estimateFare(vehicleType: string, km: number) {
  const v = VEHICLE_TYPES[vehicleType]
  if (!v || !km || km <= 0) return 0
  return Math.round(v.base + v.perKm * Math.max(km, 1))
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { order_id, vehicle_type, distance_km } = await req.json()
    if (!order_id || !vehicle_type || !distance_km) {
      return json({ error: 'order_id, vehicle_type and distance_km are required' }, 400)
    }
    if (!VEHICLE_TYPES[vehicle_type]) return json({ error: 'Unknown vehicle_type' }, 400)

    // Act as the calling user (respects OrderIt's RLS) to confirm they can
    // actually see this order before we book anything on their behalf.
    const authHeader = req.headers.get('Authorization') ?? ''
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } }
    })
    const { data: order, error: orderErr } = await userClient
      .from('orders')
      .select('id, status, payment_status, delivery_address, hotels(name, address), suppliers(name, apmc_yard, address)')
      .eq('id', order_id)
      .single()
    if (orderErr || !order) return json({ error: 'Order not found or not accessible' }, 404)

    // Same gate as DeliveryPanel.jsx enforces in the UI — checked again here
    // server-side so this can't be bypassed by calling the function directly.
    if (order.payment_status !== 'paid') {
      return json({ error: 'Order must be paid before a delivery can be booked' }, 400)
    }
    if (!['packed', 'out_for_delivery', 'delivered'].includes(order.status)) {
      return json({ error: 'Order must be packed before a delivery can be booked' }, 400)
    }

    const fare = estimateFare(vehicle_type, Number(distance_km))
    const pickup = order.suppliers?.address || order.suppliers?.apmc_yard || order.suppliers?.name || 'Supplier'
    const drop = order.delivery_address || order.hotels?.address || order.hotels?.name || 'Hotel'

    // Insert the real booking into MOTOR's own database with MOTOR's
    // service-role key — this is what makes it show up in MOTOR's driver
    // console exactly like any other job.
    const motorClient = createClient(MOTOR_SUPABASE_URL, MOTOR_SERVICE_ROLE_KEY)
    const { data: booking, error: motorErr } = await motorClient
      .from('bookings')
      .insert({
        customer_id: null,
        pickup_address: pickup,
        drop_address: drop,
        distance_km: Number(distance_km),
        vehicle_type,
        fare_estimate: fare,
        status: 'pending',
        notes: `OrderIt order #${order.id.slice(0, 8)}`,
        source: 'orderit',
        external_order_id: order.id
      })
      .select()
      .single()

    if (motorErr) return json({ error: `MOTOR booking failed: ${motorErr.message}` }, 502)

    // Mirror the booking back onto OrderIt's own deliveries row so the
    // OrderIt UI has something to query without hitting MOTOR every time.
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    await adminClient.from('deliveries').upsert(
      {
        order_id: order.id,
        delivery_type: 'direct',
        fulfilled_via: 'motor',
        vehicle_type,
        distance_km: Number(distance_km),
        fare_estimate: fare,
        motor_booking_id: booking.id,
        motor_status: booking.status,
        requested_at: new Date().toISOString()
      },
      { onConflict: 'order_id' }
    )

    // Replace the checkout-time delivery estimate with the real fare now
    // that an actual distance/vehicle has been booked — the grand_total sync
    // trigger (schema_grand_total_sync_trigger.sql) recomputes the order's
    // total automatically from this.
    await adminClient.from('orders').update({ delivery_charge: fare }).eq('id', order.id)

    return json({ motor_booking_id: booking.id, fare_estimate: fare, status: booking.status })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}
