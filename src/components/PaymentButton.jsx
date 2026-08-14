import { useState } from 'react'
import { supabase } from '../supabaseClient'

// Loads Razorpay Checkout for a single order. The key SECRET never touches
// this file — order creation and signature verification both happen inside
// Supabase Edge Functions (see supabase/functions/).
export default function PaymentButton({ order, onPaid }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const payNow = async () => {
    setBusy(true)
    setError('')
    try {
      const { data, error: fnError } = await supabase.functions.invoke('create-razorpay-order', {
        body: { order_id: order.id }
      })
      if (fnError) throw new Error(fnError.message)
      if (data?.error) throw new Error(data.error)

      if (!window.Razorpay) throw new Error('Payment SDK failed to load. Check your connection and try again.')

      const rzp = new window.Razorpay({
        key: data.key_id,
        amount: data.amount,
        currency: data.currency,
        order_id: data.razorpay_order_id,
        name: 'OrderIt',
        description: `Order #${order.id.slice(0, 8)}`,
        handler: async (response) => {
          const { data: verifyData, error: verifyError } = await supabase.functions.invoke('verify-razorpay-payment', {
            body: {
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
              order_id: order.id
            }
          })
          if (verifyError || !verifyData?.verified) {
            setError('Payment could not be verified. If money was deducted, contact support.')
          } else {
            onPaid?.()
          }
        },
        modal: { ondismiss: () => setBusy(false) },
        theme: { color: '#1c6e4a' }
      })
      rzp.open()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <div>
      <button className="btn btn-primary" disabled={busy} onClick={payNow}>
        {busy ? 'Opening payment…' : `Pay ₹${Number(order.order_total).toFixed(2)}`}
      </button>
      {error && <div className="alert alert-error">{error}</div>}
    </div>
  )
}
