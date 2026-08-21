import { useState, Fragment } from 'react'
import OrderCard from './OrderCard'
import PaymentButton from './PaymentButton'
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

// Mirrors SupplierOrderTable.jsx: a compact scan-friendly list for hotels,
// expanding to the full OrderCard (items, delivery tracking, payment,
// invoice) when the order number is clicked.
export default function HotelOrderTable({ orders, onChanged }) {
  const [expandedId, setExpandedId] = useState(null)

  if (!orders.length) return <p className="muted">No orders yet.</p>

  return (
    <div className="card">
      <table className="table">
        <thead>
          <tr>
            <th>Supplier</th>
            <th>APMC yard</th>
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
            const grandTotal = Number(order.grand_total) || Number(order.order_total)
            return (
              <Fragment key={order.id}>
                <tr>
                  <td>{order.suppliers?.name || '—'}</td>
                  <td>{order.suppliers?.apmc_yard || '—'}</td>
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
                    {order.payment_status === 'paid'
                      ? <span className="pay-badge pay-paid">✓ Paid</span>
                      : <PaymentButton order={order} onPaid={onChanged} label="Make Payment" compact />}
                  </td>
                </tr>
                {isExpanded && (
                  <tr>
                    <td colSpan={7} className="order-detail-cell">
                      <OrderCard order={order} viewerRole="hotel" onChanged={onChanged} onBack={() => setExpandedId(null)} />
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
