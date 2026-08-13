import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../supabaseClient'

export default function QuoteRequests({ hotel, products, onOrderPlaced }) {
  const [requests, setRequests] = useState([])
  const [productId, setProductId] = useState(products[0]?.id || '')
  const [quantity, setQuantity] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    if (!hotel?.id) return
    const { data } = await supabase
      .from('quote_requests')
      .select('*, products(*), supplier_quotes(*, suppliers(name, apmc_yard))')
      .eq('hotel_id', hotel.id)
      .order('created_at', { ascending: false })
    setRequests(data || [])
  }, [hotel])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!hotel?.id) return
    const channel = supabase
      .channel(`hotel-quotes-${hotel.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'supplier_quotes' }, () => load())
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [hotel, load])

  const createRequest = async (e) => {
    e.preventDefault()
    if (!productId || !quantity) return
    setBusy(true)
    const { error } = await supabase.from('quote_requests').insert({
      hotel_id: hotel.id, product_id: productId, quantity: parseFloat(quantity), notes
    })
    setBusy(false)
    if (!error) { setQuantity(''); setNotes(''); load() }
  }

  const acceptQuote = async (request, quote) => {
    setMessage('')
    // Create the order directly from the accepted quote
    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .insert({ hotel_id: hotel.id, supplier_id: quote.supplier_id, delivery_address: hotel.address })
      .select()
      .single()
    if (orderErr) { setMessage(`Failed: ${orderErr.message}`); return }

    await supabase.from('order_items').insert({
      order_id: order.id, product_id: request.product_id, quantity: request.quantity, unit_price: quote.price
    })
    await supabase.from('quote_requests').update({ status: 'closed' }).eq('id', request.id)

    setMessage(`Order placed with ${quote.suppliers?.name} at ₹${quote.price}/unit.`)
    load()
    onOrderPlaced?.()
  }

  return (
    <div>
      <div className="card">
        <h3>Request quotes from suppliers</h3>
        <p className="muted small">Broadcast a requirement to every registered supplier and compare their bids.</p>
        <form onSubmit={createRequest} className="form form-row">
          <select value={productId} onChange={(e) => setProductId(e.target.value)}>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>)}
          </select>
          <input type="number" min="0" step="0.5" placeholder="Quantity" value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
          <input placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <button className="btn btn-primary" disabled={busy} type="submit">{busy ? 'Posting…' : 'Post request'}</button>
        </form>
        {message && <div className="alert alert-info">{message}</div>}
      </div>

      {requests.map((r) => (
        <div key={r.id} className="card">
          <div className="order-card-header">
            <div>
              <strong>{r.products?.name} × {r.quantity} {r.products?.unit}</strong>
              {r.notes && <div className="muted small">{r.notes}</div>}
            </div>
            <span className={`status-badge status-${r.status === 'open' ? 'pending' : 'delivered'}`}>{r.status}</span>
          </div>

          {!r.supplier_quotes?.length && <p className="muted small">No quotes yet.</p>}
          {r.supplier_quotes?.length > 0 && (
            <table className="table small">
              <thead><tr><th>Supplier</th><th>Price</th><th>Grade</th><th>Available</th><th></th></tr></thead>
              <tbody>
                {[...r.supplier_quotes].sort((a, b) => a.price - b.price).map((q) => (
                  <tr key={q.id}>
                    <td>{q.suppliers?.name} {q.suppliers?.apmc_yard ? `(${q.suppliers.apmc_yard})` : ''}</td>
                    <td>₹{q.price}</td>
                    <td>{q.grade}</td>
                    <td>{q.available_qty ?? '—'}</td>
                    <td>
                      {r.status === 'open' && (
                        <button className="btn btn-primary" onClick={() => acceptQuote(r, q)}>Accept & order</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </div>
  )
}
