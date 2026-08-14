import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../supabaseClient'

export default function OpenRequests({ supplier }) {
  const [requests, setRequests] = useState([])
  const [myQuotes, setMyQuotes] = useState({}) // request_id -> quote header (with items)

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('quote_requests')
      .select(`
        *,
        quote_request_items(*, products(*)),
        hotels(name, address),
        supplier_quotes(*, supplier_quote_items(*))
      `)
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quote_request_items' }, () => load())
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [load])

  if (!requests.length) return <p className="muted">No open requests from hotels right now.</p>

  return (
    <div>
      {requests.map((r) => (
        <QuoteForm key={r.id} request={r} supplier={supplier} existing={myQuotes[r.id]} onSaved={load} />
      ))}
    </div>
  )
}

function QuoteForm({ request, supplier, existing, onSaved }) {
  const items = request.quote_request_items || []
  const existingItems = existing?.supplier_quote_items || []

  const [rows, setRows] = useState(() => buildInitialRows(items, existingItems))
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    setRows(buildInitialRows(items, existingItems))
    setNotes(existing?.notes ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing?.id])

  const setRow = (productId, field, value) => {
    setRows((prev) => ({ ...prev, [productId]: { ...prev[productId], [field]: value } }))
  }

  const submit = async () => {
    const priced = items.filter((it) => parseFloat(rows[it.product_id]?.price) > 0)
    if (!priced.length) {
      setMessage('Enter a price for at least one item.')
      return
    }
    setBusy(true)
    setMessage('')

    const { data: quote, error: quoteErr } = await supabase
      .from('supplier_quotes')
      .upsert(
        { request_id: request.id, supplier_id: supplier.id, notes },
        { onConflict: 'request_id,supplier_id' }
      )
      .select()
      .single()

    if (quoteErr) {
      setMessage(`Failed: ${quoteErr.message}`)
      setBusy(false)
      return
    }

    const itemPayload = priced.map((it) => ({
      quote_id: quote.id,
      product_id: it.product_id,
      price: parseFloat(rows[it.product_id].price),
      grade: rows[it.product_id]?.grade || 'A',
      available_qty: rows[it.product_id]?.qty ? parseFloat(rows[it.product_id].qty) : null
    }))
    const { error: itemsErr } = await supabase
      .from('supplier_quote_items')
      .upsert(itemPayload, { onConflict: 'quote_id,product_id' })

    setBusy(false)
    if (itemsErr) {
      setMessage(`Quote saved but items failed: ${itemsErr.message}`)
    } else {
      setMessage(`Quote submitted for ${priced.length} item${priced.length === 1 ? '' : 's'}.`)
    }
    onSaved?.()
  }

  return (
    <div className="card order-card">
      <div className="order-card-header">
        <div>
          <strong>{request.hotels?.name}</strong> wants {items.length} item{items.length === 1 ? '' : 's'}
          {request.notes && <div className="muted small">{request.notes}</div>}
        </div>
      </div>

      <table className="table small">
        <thead><tr><th>Product</th><th>Qty needed</th><th>Your price</th><th>Grade</th><th>Available</th></tr></thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.product_id}>
              <td>{it.products?.name} <span className="muted small">/ {it.products?.unit}</span></td>
              <td>{it.quantity} {it.products?.unit}</td>
              <td>
                <input
                  type="number" min="0" step="0.5" className="qty-input"
                  value={rows[it.product_id]?.price ?? ''}
                  onChange={(e) => setRow(it.product_id, 'price', e.target.value)}
                />
              </td>
              <td>
                <select
                  value={rows[it.product_id]?.grade ?? 'A'}
                  onChange={(e) => setRow(it.product_id, 'grade', e.target.value)}
                >
                  <option value="A">A</option>
                  <option value="B">B</option>
                </select>
              </td>
              <td>
                <input
                  type="number" min="0" className="qty-input"
                  value={rows[it.product_id]?.qty ?? ''}
                  onChange={(e) => setRow(it.product_id, 'qty', e.target.value)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="form-row" style={{ marginTop: 10 }}>
        <input placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <button className="btn btn-primary" disabled={busy} onClick={submit}>
          {busy ? 'Saving…' : existing ? 'Update quote' : 'Submit quote'}
        </button>
      </div>
      {message && <div className="alert alert-info">{message}</div>}
    </div>
  )
}

function buildInitialRows(items, existingItems) {
  const byProduct = {}
  for (const ei of existingItems) byProduct[ei.product_id] = ei
  const rows = {}
  for (const it of items) {
    const ex = byProduct[it.product_id]
    rows[it.product_id] = { price: ex?.price ?? '', grade: ex?.grade ?? 'A', qty: ex?.available_qty ?? '' }
  }
  return rows
}
