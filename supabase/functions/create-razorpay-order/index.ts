// supabase/functions/create-razorpay-order/index.ts
//
// Called by the hotel app when the person taps "Pay now" on an order.
// Runs server-side inside Supabase so the Razorpay key SECRET never reaches
// the browser. Deploy with:
//   supabase functions deploy create-razorpay-order
// Secrets required (set once):
//   supabase secrets set RAZORPAY_KEY_ID=rzp_test_xxx RAZORPAY_KEY_SECRET=xxx
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { corsHeaders } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { order_id } = await req.json()
    if (!order_id) throw new Error('order_id is required')

    const authHeader = req.headers.get('Authorization') ?? ''

    // Client scoped to the caller's own JWT — RLS makes sure they can only
    // read an order that belongs to them (their hotel).
    const callerClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: order, error: orderErr } = await callerClient
      .from('orders')
      .select('id, order_total, grand_total, payment_status')
      .eq('id', order_id)
      .single()

    if (orderErr || !order) throw new Error('Order not found or access denied')
    if (order.payment_status === 'paid') throw new Error('Order is already paid')
    if (!order.order_total || order.order_total <= 0) throw new Error('Order has no items yet')

    const keyId = Deno.env.get('RAZORPAY_KEY_ID')!
    const keySecret = Deno.env.get('RAZORPAY_KEY_SECRET')!
    // grand_total (items + 3% platform fee + delivery charge) is what the
    // hotel actually owes — fall back to order_total only for orders that
    // predate the platform-fee migration and never got a grand_total set.
    const chargeAmount = order.grand_total || order.order_total
    const amountPaise = Math.round(chargeAmount * 100)

    const rpRes = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Basic ' + btoa(`${keyId}:${keySecret}`)
      },
      body: JSON.stringify({
        amount: amountPaise,
        currency: 'INR',
        receipt: order.id,
        notes: { order_id: order.id }
      })
    })

    const rpOrder = await rpRes.json()
    if (!rpRes.ok) throw new Error(rpOrder?.error?.description || 'Razorpay order creation failed')

    // Service-role client bypasses RLS to write the payments audit row.
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )
    await adminClient.from('payments').insert({
      order_id: order.id,
      razorpay_order_id: rpOrder.id,
      amount: chargeAmount,
      status: 'created'
    })

    return new Response(
      JSON.stringify({
        razorpay_order_id: rpOrder.id,
        amount: amountPaise,
        currency: 'INR',
        key_id: keyId
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
