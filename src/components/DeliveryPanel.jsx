import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../supabaseClient'

// Editable by supplier/admin (direct supplier→hotel delivery, or routed via a
// consolidation hub per plan §7). Hotels see it read-only.
export default function DeliveryPanel({ orderId, viewerRole }) {
  const [delivery, setDelivery] = useState(null)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ delivery_type: 'direct', hub_name: '', partner_name: '', partner_phone: '' })
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { data } = await supabase.from('deliveries').select('*').eq('order_id', orderId).maybeSingle()
    setDelivery(data || null)
    if (data) setForm(data)
  }, [orderId])

  useEffect(() => { load() }, [load])

  const canEdit = viewerRole === 'supplier' || viewerRole === 'admin'

  const save = async () => {
    setBusy(true)
    const { error } = await supabase
      .from('deliveries')
      .upsert({ order_id: orderId, ...form }, { onConflict: 'order_id' })
    setBusy(false)
    if (!error) { setEditing(false); load() }
  }

  const markPicked = () => supabase.from('deliveries').upsert(
    { order_id: orderId, ...form, picked_up_at: new Date().toISOString() }, { onConflict: 'order_id' }
  ).then(load)

  const markDelivered = () => supabase.from('deliveries').upsert(
    { order_id: orderId, ...form, delivered_at: new Date().toISOString() }, { onConflict: 'order_id' }
  ).then(load)

  if (!canEdit && !delivery) return null

  return (
    <div className="delivery-panel">
      {!editing && (
        <div className="delivery-summary">
          <span className="muted small">
            🚚 {delivery
              ? `${delivery.delivery_type === 'hub' ? `Via hub: ${delivery.hub_name || '—'}` : 'Direct delivery'}${delivery.partner_name ? ` · ${delivery.partner_name}` : ''}${delivery.partner_phone ? ` (${delivery.partner_phone})` : ''}${delivery.picked_up_at ? ' · Picked up' : ''}${delivery.delivered_at ? ' · Delivered' : ''}`
              : 'Delivery not set up yet'}
          </span>
          {canEdit && (
            <button className="btn-link" onClick={() => setEditing(true)}>
              {delivery ? 'Edit' : 'Set up delivery'}
            </button>
          )}
        </div>
      )}

      {editing && (
        <div className="delivery-form">
          <select value={form.delivery_type} onChange={(e) => setForm({ ...form, delivery_type: e.target.value })}>
            <option value="direct">Direct supplier → hotel</option>
            <option value="hub">Via consolidation hub</option>
          </select>
          {form.delivery_type === 'hub' && (
            <input placeholder="Hub name" value={form.hub_name || ''} onChange={(e) => setForm({ ...form, hub_name: e.target.value })} />
          )}
          <input placeholder="Delivery partner name" value={form.partner_name || ''} onChange={(e) => setForm({ ...form, partner_name: e.target.value })} />
          <input placeholder="Partner phone" value={form.partner_phone || ''} onChange={(e) => setForm({ ...form, partner_phone: e.target.value })} />
          <div className="delivery-form-actions">
            <button className="btn btn-primary" disabled={busy} onClick={save}>Save</button>
            <button className="btn-link" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      )}

      {canEdit && delivery && !editing && (
        <div className="delivery-form-actions">
          {!delivery.picked_up_at && <button className="btn-link" onClick={markPicked}>Mark picked up</button>}
          {delivery.picked_up_at && !delivery.delivered_at && <button className="btn-link" onClick={markDelivered}>Mark delivered</button>}
        </div>
      )}
    </div>
  )
}
