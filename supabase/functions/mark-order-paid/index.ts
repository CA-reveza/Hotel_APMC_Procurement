// supabase/functions/mark-order-paid/index.ts
//
// Called by the supplier (APMC) dashboard's "Mark as paid" button, for
// payments collected outside Razorpay (cash on delivery, direct bank
// transfer, etc). Kept as an Edge Function rather than a plain client-side
// update so every "paid" transition — Razorpay or manual — leaves a matching
// row in the payments audit table.
//
// Deploy with: supabase functions deploy mark-order-paid
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { corsHeaders } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { order_id } = await req.json()
    if (!order_id) throw new Error('order_id is required')

    const authHeader = req.headers.get('Authorization') ?? ''
    const callerClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: order, error: orderErr } = await callerClient
      .from('orders')
      .select('id, order_total, payment_status')
      .eq('id', order_id)
      .single()

    if (orderErr || !order) throw new Error('Order not found or access denied')
    if (order.payment_status === 'paid') throw new Error('Order is already paid')

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Cancel any outstanding Razorpay payment link for this order so the
    // hotel can't pay a second time on a link that's now moot.
    const { data: pendingLink } = await adminClient
      .from('payments')
      .select('link_id')
      .eq('order_id', order.id)
      .eq('method', 'razorpay')
      .eq('status', 'created')
      .not('link_id', 'is', null)
      .maybeSingle()

    if (pendingLink?.link_id) {
      const keyId = Deno.env.get('RAZORPAY_KEY_ID')
      const keySecret = Deno.env.get('RAZORPAY_KEY_SECRET')
      if (keyId && keySecret) {
        await fetch(`https://api.razorpay.com/v1/payment_links/${pendingLink.link_id}/cancel`, {
          method: 'POST',
          headers: { Authorization: 'Basic ' + btoa(`${keyId}:${keySecret}`) }
        }).catch(() => null) // best-effort — don't block marking paid on this
      }
    }

    await adminClient.from('payments').insert({
      order_id: order.id,
      amount: order.order_total,
      status: 'paid',
      method: 'manual'
    })
    await adminClient.from('orders').update({ payment_status: 'paid' }).eq('id', order.id)

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
