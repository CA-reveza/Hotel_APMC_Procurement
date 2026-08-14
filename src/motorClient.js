import { createClient } from '@supabase/supabase-js'

// MOTOR is a separate Supabase project/app. This client is only used to
// read back live status for bookings OrderIt itself created there (see
// supabase/functions/book-motor-delivery and RUN_ON_MOTOR_PROJECT_bridge.sql)
// — OrderIt users never log into MOTOR, so this always uses MOTOR's anon key
// with no session, relying on MOTOR's "source = 'orderit'" read policy.
// Integration is optional: if these env vars aren't set, motorSupabase is
// null and the app just shows whatever status it last mirrored locally.
const motorUrl = import.meta.env.VITE_MOTOR_SUPABASE_URL
const motorAnonKey = import.meta.env.VITE_MOTOR_SUPABASE_ANON_KEY

export const motorSupabase = motorUrl && motorAnonKey ? createClient(motorUrl, motorAnonKey) : null
