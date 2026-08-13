import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../supabaseClient'

export default function OpenRequests({ supplier }) {
  const [requests, setRequests] = useState([])
  const [myQuotes, setMyQuotes] = useState({}) // request_id -> quote

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('quote_requests')
      .select('*, products(*), hotels(name, address), supplier_quotes(*)')
      .eq('status', 'open')
      .order('created_at', { ascending: false })
    setRequests(data || [])
    const mine = {}
    for (const r of data || []) {
      const own = r.supplier_quotes?.find((q) => q.supplier_id === supplier?.id)
      if (own) mine[r.id] = own
    }
    setMyQuotes(mine)
  }, [supplier])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const channel = supabase
      .channel('supplier-open-requests')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quote_requests' }, () => load())
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [load])

  if (!requests.length) return <p className="muted">No open requests from hotels right now.</p>

  return (
    <div>
      {requests.map((r) => (
        <QuoteRow key={r.id} request={r} supplier={supplier} existing={myQuotes[r.id]} onSaved={load} />
      ))}
    </div>
  )
}

function QuoteRow({ request, supplier, existing, onSaved }) {
  const [price, setPrice] = useState(existing?.price ?? '')
  const [grade, setGrade] = useState(existing?.grade ?? 'A')
  const [qty, setQty] = useState(existing?.available_qty ?? '')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!price) return
    setBusy(true)
    await supabase.from('supplier_quotes').upsert(
      {
        request_id: request.id,
        supplier_id: supplier.id,
        price: parseFloat(price),
        grade,
        available_qty: qty ? parseFloat(qty) : null
      },
      { onConflict: 'request_id,supplier_id' }
    )
    setBusy(false)
    onSaved?.()
  }

  return (
    <div className="card order-card">
      <div className="order-card-header">
        <div>
          <strong>{request.hotels?.name}</strong> wants {request.products?.name} × {request.quantity} {request.products?.unit}
          {request.notes && <div className="muted small">{request.notes}</div>}
        </div>
      </div>
      <div className="form-row" style={{ marginTop: 10 }}>
        <input type="number" min="0" step="0.5" placeholder="Your price" value={price} onChange={(e) => setPrice(e.target.value)} />
        <select value={grade} onChange={(e) => setGrade(e.target.value)}>
          <option value="A">Grade A</option>
          <option value="B">Grade B</option>
        </select>
        <input type="number" min="0" placeholder="Available qty" value={qty} onChange={(e) => setQty(e.target.value)} />
        <button className="btn btn-primary" disabled={busy} onClick={submit}>
          {busy ? 'Saving…' : existing ? 'Update quote' : 'Submit quote'}
        </button>
      </div>
    </div>
  )
}
