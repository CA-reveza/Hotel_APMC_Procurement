import { useState } from 'react'
import { supabase } from '../supabaseClient'

const STATUS_FLOW = {
  pending: ['accepted', 'rejected'],
  accepted: ['packed'],
  packed: ['out_for_delivery'],
  out_for_delivery: ['delivered'],
  delivered: [],
  rejected: [],
  cancelled: []
}

const STATUS_LABEL = {
  pending: 'Pending',
  accepted: 'Accepted',
  rejected: 'Rejected',
  packed: 'Packed',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled'
}

export default function OrderCard({ order, viewerRole, onChanged }) {
  const [busy, setBusy] = useState(false)

  const updateStatus = async (status) => {
    setBusy(true)
    const { error } = await supabase.from('orders').update({ status }).eq('id', order.id)
    setBusy(false)
    if (!error) onChanged?.()
  }

  const nextOptions = viewerRole === 'supplier' ? STATUS_FLOW[order.status] || [] : []

  return (
    <div className="card order-card">
      <div className="order-card-header">
        <div>
          <strong>Order #{order.id.slice(0, 8)}</strong>
          <div className="muted small">{new Date(order.created_at).toLocaleString('en-IN')}</div>
        </div>
        <span className={`status-badge status-${order.status}`}>{STATUS_LABEL[order.status]}</span>
      </div>

      <div className="order-card-meta">
        {order.hotels?.name && <div>Hotel: {order.hotels.name}</div>}
        {order.suppliers?.name && <div>Supplier: {order.suppliers.name} {order.suppliers.apmc_yard ? `(${order.suppliers.apmc_yard})` : ''}</div>}
        {order.delivery_address && <div>Deliver to: {order.delivery_address}</div>}
      </div>

      <table className="table small">
        <thead><tr><th>Item</th><th>Qty</th><th>Rate</th><th>Total</th></tr></thead>
        <tbody>
          {order.order_items?.map((it) => (
            <tr key={it.id}>
              <td>{it.products?.name}</td>
              <td>{it.quantity} {it.products?.unit}</td>
              <td>₹{it.unit_price}</td>
              <td>₹{it.line_total ?? (it.quantity * it.unit_price).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="order-card-footer">
        <div>Order total: <strong>₹{Number(order.order_total).toFixed(2)}</strong></div>
        {viewerRole !== 'hotel' && (
          <div className="muted small">
            Commission ({order.commission_pct}%): ₹{Number(order.commission_amount).toFixed(2)} · Delivery: ₹{Number(order.delivery_contribution).toFixed(2)}
          </div>
        )}
      </div>

      {nextOptions.length > 0 && (
        <div className="order-card-actions">
          {nextOptions.map((status) => (
            <button
              key={status}
              className={status === 'rejected' ? 'btn btn-danger' : 'btn btn-primary'}
              disabled={busy}
              onClick={() => updateStatus(status)}
            >
              {busy ? '…' : `Mark ${STATUS_LABEL[status]}`}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
