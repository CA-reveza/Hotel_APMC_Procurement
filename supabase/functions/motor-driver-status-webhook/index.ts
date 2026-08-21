// supabase/functions/motor-driver-status-webhook/index.ts
//
// Receives a push from MoveIT's own Supabase Database Webhook (configured on
// the MOTOR project, not OrderIT's) whenever a driver's `profiles` row is
// inserted or updated there — a new driver signing up, or an existing one
// updating their vehicle info or toggling online/offline from MoveIT's
// console. Mirrors the whole driver record into OrderIT's `drivers` table
// automatically: creates it the first time a MOTOR driver is seen, and
// keeps name/phone/vehicle/online-status in sync after that. No manual
// admin linking step — drivers who only ever use MoveIT still show up
// correctly in OrderIT's admin fleet view and driver-pool matching.
//
// Matched via drivers.motor_driver_id = MOTOR profiles.id. OrderIT's
// `drivers.id` is its own separate uuid (not tied to any OrderIT auth
// account) for these synced-in rows — see schema_motor_driver_link.sql for
// why that FK was relaxed.
//
// This is the driver-presence counterpart to motor-status-webhook (which
// syncs booking/delivery status, not driver records).
//
// Deploy:
//   supabase functions deploy motor-driver-status-webhook --no-verify-jwt
// (--no-verify-jwt because MOTOR's webhook caller has no OrderIT user JWT —
// instead we verify a shared secret header below.)
//
// Secrets (reuses the same secret as motor-status-webhook — set once, on
// the OrderIT project, if not already set):
//   supabase secrets set MOTOR_WEBHOOK_SECRET=some-long-random-string
//
// Then, on the MOTOR project: Database → Webhooks → Create a new webhook
//   Name:    orderit-driver-sync
//   Table:   profiles
//   Events:  Insert, Update   <- both, so new driver signups sync too
//   Type:    HTTP Request → URL: <this function's URL>
//   HTTP Headers: add `x-webhook-secret: <same value as MOTOR_WEBHOOK_SECRET>`
//
// Note: this fires on every profiles insert/update in MOTOR (customers
// included) — the function below just ignores anything that isn't a driver
// row, so that's harmless.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MOTOR_WEBHOOK_SECRET = Deno.env.get('MOTOR_WEBHOOK_SECRET')

Deno.serve(async (req) => {
  try {
    if (MOTOR_WEBHOOK_SECRET) {
      const provided = req.headers.get('x-webhook-secret')
      if (provided !== MOTOR_WEBHOOK_SECRET) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
      }
    }

    const payload = await req.json()
    // Supabase Database Webhooks send { type, table, record, old_record }
    const profile = payload.record
    if (!profile?.id) return new Response(JSON.stringify({ error: 'No profile record in payload' }), { status: 400 })
    if (profile.role !== 'driver') return new Response(JSON.stringify({ ok: true, skipped: 'not a driver' }), { status: 200 })

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    const fields = {
      name: profile.full_name || 'Driver',
      phone: profile.phone ?? null,
      vehicle_type: profile.vehicle_type ?? null,
      vehicle_number: profile.vehicle_number ?? null,
      is_online: typeof profile.is_online === 'boolean' ? profile.is_online : false,
    }

    // vehicle_type is not-null on OrderIT's drivers table — a brand new
    // MOTOR driver who hasn't set up their vehicle yet has no row worth
    // creating in OrderIT until they do (an Update will arrive once they
    // do, and create it then).
    const { data: existing, error: findErr } = await admin
      .from('drivers')
      .select('id')
      .eq('motor_driver_id', profile.id)
      .maybeSingle()

    if (findErr) return new Response(JSON.stringify({ error: findErr.message }), { status: 500 })

    if (existing) {
      const { error } = await admin.from('drivers').update(fields).eq('id', existing.id)
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })
      return new Response(JSON.stringify({ ok: true, action: 'updated' }), { status: 200 })
    }

    if (!fields.vehicle_type) {
      return new Response(JSON.stringify({ ok: true, skipped: 'no vehicle_type yet' }), { status: 200 })
    }

    const { error } = await admin.from('drivers').insert({ ...fields, motor_driver_id: profile.id })
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })
    return new Response(JSON.stringify({ ok: true, action: 'created' }), { status: 200 })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 })
  }
})
