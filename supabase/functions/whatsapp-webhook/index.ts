// supabase/functions/whatsapp-webhook/index.ts
//
// WhatsApp order intake, per the plan's "Month 2: WhatsApp + simple ordering"
// approach. Point a Twilio WhatsApp Sandbox (or a Meta Cloud API webhook) at
// this function's URL and hotels can place orders by texting, e.g.:
//
//   ORDER Ramesh Traders
//   Onion:5
//   Tomato:3
//   Toor Dal:2
//
// Line 1 must start with "ORDER" followed by the supplier's name (matched
// loosely). Each following line is "Product:quantity". Unmatched products
// are skipped and reported back so the order isn't silently wrong.
//
// Setup:
//   1. supabase functions deploy whatsapp-webhook
//   2. supabase secrets set SUPABASE_SERVICE_ROLE_KEY=... (already set if
//      you deployed the Razorpay functions)
//   3. In Twilio Console → WhatsApp Sandbox Settings, set "When a message
//      comes in" to this function's URL, method POST.
//   4. A hotel's WhatsApp number must match the phone number stored on
//      their profile (Admin can set this in Table Editor → profiles.phone)
//      before WhatsApp ordering works for them.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

function twiml(message: string) {
  const escaped = message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`,
    { headers: { 'Content-Type': 'text/xml' } }
  )
}

Deno.serve(async (req) => {
  const form = await req.formData().catch(() => null)
  const body = (form?.get('Body') as string) || ''
  const from = ((form?.get('From') as string) || '').replace('whatsapp:', '')

  if (!body.trim().toUpperCase().startsWith('ORDER')) {
    return twiml('To place an order, text:\nORDER <supplier name>\n<Product>:<qty>\n<Product>:<qty>')
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // 1. Identify the hotel from the sender's WhatsApp number
  const { data: profile } = await admin
    .from('profiles')
    .select('id')
    .eq('phone', from)
    .eq('role', 'hotel')
    .maybeSingle()

  if (!profile) {
    return twiml(`This number isn't linked to a hotel account yet. Sign up on the app first, then ask admin to set your phone number to match your WhatsApp number.`)
  }

  const { data: hotel } = await admin.from('hotels').select('*').eq('profile_id', profile.id).single()
  if (!hotel) return twiml('No hotel profile found for this account yet.')

  // 2. Parse "ORDER <supplier name>" + "Product:qty" lines
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean)
  const supplierName = lines[0].replace(/^ORDER/i, '').trim()
  if (!supplierName) return twiml('Please include a supplier name, e.g. "ORDER Ramesh Traders".')

  const { data: supplier } = await admin
    .from('suppliers')
    .select('*')
    .ilike('name', `%${supplierName}%`)
    .limit(1)
    .maybeSingle()

  if (!supplier) return twiml(`No supplier found matching "${supplierName}".`)

  const itemLines = lines.slice(1)
  const matched: { product_id: string; quantity: number; unit_price: number; name: string }[] = []
  const unmatched: string[] = []

  for (const line of itemLines) {
    const [namePart, qtyPart] = line.split(':').map((s) => s?.trim())
    const qty = parseFloat(qtyPart)
    if (!namePart || !qty || qty <= 0) { unmatched.push(line); continue }

    const { data: product } = await admin.from('products').select('*').ilike('name', `%${namePart}%`).limit(1).maybeSingle()
    if (!product) { unmatched.push(namePart); continue }

    const { data: priceRow } = await admin
      .from('supplier_prices')
      .select('*')
      .eq('supplier_id', supplier.id)
      .eq('product_id', product.id)
      .order('price_date', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!priceRow) { unmatched.push(`${namePart} (no price from this supplier)`); continue }

    matched.push({ product_id: product.id, quantity: qty, unit_price: priceRow.price, name: product.name })
  }

  if (!matched.length) {
    return twiml(`Couldn't match any items. Unrecognised: ${unmatched.join(', ') || 'all lines'}`)
  }

  // 3. Create the order (service role bypasses RLS — this is a trusted server context)
  const { data: order, error: orderErr } = await admin
    .from('orders')
    .insert({ hotel_id: hotel.id, supplier_id: supplier.id, delivery_address: hotel.address, source: 'whatsapp' })
    .select()
    .single()

  if (orderErr) return twiml(`Order failed: ${orderErr.message}`)

  await admin.from('order_items').insert(
    matched.map((m) => ({ order_id: order.id, product_id: m.product_id, quantity: m.quantity, unit_price: m.unit_price }))
  )

  const total = matched.reduce((sum, m) => sum + m.quantity * m.unit_price, 0)
  const summary = matched.map((m) => `${m.name} x${m.quantity}`).join(', ')
  const skipped = unmatched.length ? `\nSkipped: ${unmatched.join(', ')}` : ''

  return twiml(`Order placed with ${supplier.name}!\n${summary}\nTotal: ₹${total.toFixed(2)}${skipped}\nTrack status in the app.`)
})
