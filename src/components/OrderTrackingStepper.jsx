const STEPS = [
  { key: 'pending', label: 'Placed' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'packed', label: 'Packed' },
  { key: 'out_for_delivery', label: 'Out for delivery' },
  { key: 'delivered', label: 'Delivered' }
]
const STEP_INDEX = Object.fromEntries(STEPS.map((s, i) => [s.key, i]))

// A compact horizontal tracker for the order detail view — the doc's
// "Confirmed → Paid → In MOTOR → Delivered" idea, adapted to this app's
// actual order.status values plus a separate payment badge (payment isn't
// strictly sequential here — an order can be paid before or after packing).
export default function OrderTrackingStepper({ order, delivery }) {
  if (order.status === 'rejected' || order.status === 'cancelled') {
    return (
      <div className="tracking-stepper">
        <span className={`status-badge status-${order.status}`}>{order.status === 'rejected' ? 'Rejected' : 'Cancelled'}</span>
      </div>
    )
  }

  const currentIndex = STEP_INDEX[order.status] ?? 0
  const viaMotor = delivery?.fulfilled_via === 'motor'

  return (
    <div className="tracking-stepper">
      <div className="tracking-steps">
        {STEPS.map((step, i) => {
          const done = i <= currentIndex
          const isOutForDelivery = step.key === 'out_for_delivery'
          return (
            <div key={step.key} className={`tracking-step ${done ? 'done' : ''}`}>
              <div className="tracking-dot">{done ? '✓' : i + 1}</div>
              <div className="tracking-label">
                {isOutForDelivery && viaMotor ? 'In MOTOR' : step.label}
              </div>
              {i < STEPS.length - 1 && <div className={`tracking-line ${i < currentIndex ? 'done' : ''}`} />}
            </div>
          )
        })}
      </div>
      <span className={`pay-badge pay-${order.payment_status === 'paid' ? 'paid' : 'unpaid'}`}>
        {order.payment_status === 'paid' ? '✓ Paid' : 'Payment pending'}
      </span>
    </div>
  )
}
