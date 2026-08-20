// supabase/functions/razorpay-webhook/index.ts
//
// Payment Links (unlike Checkout) are completed on Razorpay's own hosted
// page, outside the app — there's no client-side "handler" callback to catch
// success like PaymentButton.jsx has for the hotel's in-app flow. This
// webhook is what actually marks the order paid when a supplier's requested
// payment link gets paid.
//
// Setup (once, in the Razorpay Dashboard → Settings → Webhooks):
//   URL: https://<project-ref>.supabase.co/functions/v1/razorpay-webhook
//   Active events: payment_link.paid
//   Copy the generated "Webhook Secret" and set it below.
// Deploy with:
//   supabase functions deploy razorpay-webhook --no-verify-jwt
//   supabase secrets set RAZORPAY_WEBHOOK_SECRET=whsec_xxx
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

async function hmacSha256Hex(secret: string, message: string) {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('ok')

  // Verify against the RAW body — parsing to JSON first and re-stringifying
  // would change byte-for-byte formatting and break the signature check.
  const rawBody = await req.text()
  const signature = req.headers.get('x-razorpay-signature') ?? ''
  const webhookSecret = Deno.env.get('RAZORPAY_WEBHOOK_SECRET')!

  const expected = await hmacSha256Hex(webhookSecret, rawBody)
  if (expected !== signature) {
    return new Response(JSON.stringify({ error: 'Invalid webhook signature' }), { status: 400 })
  }

  const event = JSON.parse(rawBody)
  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  if (event.event === 'payment_link.paid') {
    const linkEntity = event.payload?.payment_link?.entity
    const paymentEntity = event.payload?.payment?.entity
    const linkId = linkEntity?.id
    const orderId = linkEntity?.reference_id || linkEntity?.notes?.order_id

    if (linkId) {
      await adminClient
        .from('payments')
        .update({
          status: 'paid',
          razorpay_payment_id: paymentEntity?.id || null,
          updated_at: new Date().toISOString()
        })
        .eq('link_id', linkId)
    }
    if (orderId) {
      await adminClient.from('orders').update({ payment_status: 'paid' }).eq('id', orderId)
    }
  }

  // Always 200 — Razorpay retries on non-2xx, and unrecognised event types
  // (link expired, cancelled, etc) don't need any action here.
  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' }
  })
})
