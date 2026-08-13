// supabase/functions/verify-razorpay-payment/index.ts
//
// Called by the hotel app's Razorpay Checkout success handler. Verifies the
// HMAC-SHA256 signature server-side (never trust a "payment succeeded" event
// from the browser alone) then marks the order + payment as paid.
// Deploy with: supabase functions deploy verify-razorpay-payment
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { corsHeaders } from '../_shared/cors.ts'

async function hmacSha256Hex(secret: string, message: string) {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, order_id } = await req.json()
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !order_id) {
      throw new Error('Missing payment verification fields')
    }

    const keySecret = Deno.env.get('RAZORPAY_KEY_SECRET')!
    const expectedSignature = await hmacSha256Hex(keySecret, `${razorpay_order_id}|${razorpay_payment_id}`)

    if (expectedSignature !== razorpay_signature) {
      throw new Error('Signature mismatch — payment could not be verified')
    }

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    await adminClient
      .from('payments')
      .update({ razorpay_payment_id, razorpay_signature, status: 'paid', updated_at: new Date().toISOString() })
      .eq('razorpay_order_id', razorpay_order_id)

    await adminClient.from('orders').update({ payment_status: 'paid' }).eq('id', order_id)

    return new Response(JSON.stringify({ verified: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message, verified: false }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
