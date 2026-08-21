import { useState, Fragment } from 'react'
import OrderCard from './OrderCard'
import { getDeliveryStatus } from '../lib/deliveryStatus'

const STATUS_LABEL = {
  pending: 'Pending',
  accepted: 'Accepted',
  rejected: 'Rejected',
  packed: 'Packed',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled'
}

function orderDelivery(order) {
  return Array.isArray(order.deliveries) ? order.deliveries[0] : order.deliveries
}

// Same compact scan-and-expand pattern as SupplierOrderTable.jsx, but with
// both Hotel and Supplier columns since admin sees every order, not just
// their own side of it.
export default function AdminOrderTable({ orders, onChanged }) {
  const [expandedId, setExpandedId] = useState(null)

  if (!orders.length) return <p className="muted">No orders yet.</p>

  return (
    <div className="card">
      <table className="table">
        <thead>
          <tr>
            <th>Hotel</th>
            <th>Supplier</th>
            <th>Order</th>
            <th>Amount</th>
            <th>Status</th>
            <th>Delivery</th>
            <th>Payment</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => {
            const isExpanded = expandedId === order.id
            const deliveryStatus = getDeliveryStatus(orderDelivery(order))
            const isPaid = order.payment_status === 'paid'
            const grandTotal = Number(order.grand_total) || Number(order.order_total)
            return (
              <Fragment key={order.id}>
                <tr>
                  <td>{order.hotels?.name || '—'}</td>
                  <td>{order.suppliers?.name || '—'}</td>
                  <td>
                    <button
                      type="button"
                      className="btn-link"
                      onClick={() => setExpandedId(isExpanded ? null : order.id)}
                    >
                      #{order.id.slice(0, 8)} {isExpanded ? '▲' : '▼'}
                    </button>
                  </td>
                  <td>₹{grandTotal.toFixed(2)}</td>
                  <td><span className={`status-badge status-${order.status}`}>{STATUS_LABEL[order.status]}</span></td>
                  <td><span className={`delivery-badge delivery-${deliveryStatus.className}`}>{deliveryStatus.label}</span></td>
                  <td>
                    <span className={`pay-badge pay-${isPaid ? 'paid' : 'unpaid'}`}>
                      {isPaid ? '✓ Paid' : 'Unpaid'}
                    </span>
                  </td>
                </tr>
                {isExpanded && (
                  <tr>
                    <td colSpan={7} className="order-detail-cell">
                      <OrderCard order={order} viewerRole="admin" onChanged={onChanged} onBack={() => setExpandedId(null)} />
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
