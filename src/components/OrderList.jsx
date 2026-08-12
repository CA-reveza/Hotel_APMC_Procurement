import OrderCard from './OrderCard'

export default function OrderList({ orders, viewerRole, onChanged }) {
  if (!orders.length) return <p className="muted">No orders yet.</p>

  return (
    <div className="order-list">
      {orders.map((order) => (
        <OrderCard key={order.id} order={order} viewerRole={viewerRole} onChanged={onChanged} />
      ))}
    </div>
  )
}
