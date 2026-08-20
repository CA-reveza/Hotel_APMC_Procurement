import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../supabaseClient'
import { VEHICLE_TYPES, estimateFare } from '../lib/vehiclePricing'
import MotorStatus from './MotorStatus'

// Editable by supplier/admin (direct supplier→hotel delivery, or routed via a
// consolidation hub per plan §7). Hotels and drivers see relevant parts
// read-only. Two ways to fulfil a delivery: type in a partner's name/phone
// manually, or book it out to the separate MOTOR app.
//
// Booking a delivery — either way — is only allowed once the order has been
// paid AND packed. Skipping straight from "accepted" to booking a vehicle
// let a delivery get marked complete on an order that was never packed or
// paid, which is exactly the mistake this gate exists to prevent.
export default function DeliveryPanel({ orderId, viewerRole, orderStatus, paymentStatus }) {
  const [delivery, setDelivery] = useState(null)
  const [editing, setEditing] = useState(false)
  const [bookingMode, setBookingMode] = useState(null)
  const [form, setForm] = useState({ delivery_type: 'direct', hub_name: '', partner_name: '', partner_phone: '' })
  const [vehicleType, setVehicleType] = useState(VEHICLE_TYPES[0].id)
  const [distanceKm, setDistanceKm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const { data } = await supabase.from('deliveries').select('*').eq('order_id', orderId).maybeSingle()
    setDelivery(data || null)
    if (data) setForm(data)
  }, [orderId])

  useEffect(() => { load() }, [load])

  const isStaff = viewerRole === 'supplier' || viewerRole === 'admin'
  const isPacked = ['packed', 'out_for_delivery', 'delivered'].includes(orderStatus)
  const isPaid = paymentStatus === 'paid'
  const bookingAllowed = isStaff && isPaid && isPacked
  // Staff can still edit an already-existing delivery record (e.g. update
  // partner phone, advance status) even if these flip later — the gate is
  // only on *starting* a new booking.
  const canEdit = isStaff && (delivery ? true : bookingAllowed)

  const save = async () => {
    setBusy(true)
    const { error } = await supabase
      .from('deliveries')
      .upsert({ order_id: orderId, ...form }, { onConflict: 'order_id' })
    setBusy(false)
    if (!error) { setEditing(false); load() }
  }

  const requestMotorVehicle = async () => {
    const km = parseFloat(distanceKm)
    if (!km || km <= 0) return
    setBusy(true)
    setError('')
    const { error } = await supabase.functions.invoke('book-motor-delivery', {
      body: { order_id: orderId, vehicle_type: vehicleType, distance_km: km }
    })
    setBusy(false)
    if (error) {
      setError(error.message || 'Failed to book via MOTOR. Check that the Edge Function is deployed and MOTOR secrets are set.')
    } else {
      setBookingMode(null)
      load()
    }
    // Note: book-motor-delivery itself updates orders.delivery_charge to the
    // real computed fare (replacing the checkout estimate) — the grand_total
    // sync trigger picks that up automatically, no extra write needed here.
  }

  const markPicked = () => supabase.from('deliveries').upsert(
    { order_id: orderId, ...form, picked_up_at: new Date().toISOString() }, { onConflict: 'order_id' }
  ).then(load)

  const markInTransit = () => supabase.from('deliveries').upsert(
    { order_id: orderId, ...form, in_transit_at: new Date().toISOString() }, { onConflict: 'order_id' }
  ).then(load)

  const markDelivered = () => supabase.from('deliveries').upsert(
    { order_id: orderId, ...form, delivered_at: new Date().toISOString() }, { onConflict: 'order_id' }
  ).then(load)

  if (!isStaff && !delivery) return null

  const vehicleLabel = delivery?.vehicle_type ? VEHICLE_TYPES.find((v) => v.id === delivery.vehicle_type)?.label : null
  const isMotor = delivery?.fulfilled_via === 'motor'

  return (
    <div className="delivery-panel">
      {!editing && !bookingMode && (
        <div className="delivery-summary">
          <span className="muted small">
            🚚 {summaryText(delivery, vehicleLabel)}
          </span>
          {isMotor && delivery.motor_booking_id && (
            <MotorStatus orderId={orderId} motorBookingId={delivery.motor_booking_id} fallbackStatus={delivery.motor_status} />
          )}
          {isStaff && !delivery && !bookingAllowed && (
            <span className="muted small">
              {!isPaid ? 'Payment required before delivery can be booked.' : 'Order must be packed before delivery can be booked.'}
            </span>
          )}
          {canEdit && (
            <span className="delivery-actions-inline">
              {delivery && (
                <button className="btn-link" onClick={() => setEditing(true)}>
                  {delivery?.partner_name ? 'Edit partner' : 'Set partner manually'}
                </button>
              )}
              {!delivery && bookingAllowed && (
                <>
                  <button className="btn-link" onClick={() => setEditing(true)}>Set partner manually</button>
                  <button className="btn-link" onClick={() => setBookingMode('motor')}>Book via MOTOR</button>
                </>
              )}
            </span>
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

      {bookingMode && (
        <div className="delivery-form">
          <div className="muted small">Booking via MOTOR</div>
          <select value={vehicleType} onChange={(e) => setVehicleType(e.target.value)}>
            {VEHICLE_TYPES.map((v) => (
              <option key={v.id} value={v.id}>{v.label} — {v.desc} (up to {v.capacityKg}kg)</option>
            ))}
          </select>
          <input
            type="number" min="0" step="0.5" placeholder="Distance (km)"
            value={distanceKm} onChange={(e) => setDistanceKm(e.target.value)}
          />
          {distanceKm > 0 && (
            <div className="muted small">Estimated fare: ₹{estimateFare(vehicleType, parseFloat(distanceKm))}</div>
          )}
          {error && <div className="alert alert-error">{error}</div>}
          <div className="delivery-form-actions">
            <button className="btn btn-primary" disabled={busy || !distanceKm} onClick={requestMotorVehicle}>
              {busy ? 'Requesting…' : 'Book via MOTOR'}
            </button>
            <button className="btn-link" onClick={() => { setBookingMode(null); setError('') }}>Cancel</button>
          </div>
        </div>
      )}

      {canEdit && delivery && !editing && !bookingMode && !isMotor && (
        <div className="delivery-form-actions">
          {!delivery.picked_up_at && <button className="btn-link" onClick={markPicked}>Mark picked up</button>}
          {delivery.picked_up_at && !delivery.in_transit_at && <button className="btn-link" onClick={markInTransit}>Mark in transit</button>}
          {delivery.picked_up_at && !delivery.delivered_at && <button className="btn-link" onClick={markDelivered}>Mark delivered</button>}
        </div>
      )}

      {canEdit && delivery && !editing && !bookingMode && isMotor && !delivery.delivered_at && (
        <div className="delivery-form-actions">
          <button className="btn-link" onClick={markDelivered}>Force mark delivered (if MOTOR sync is stuck)</button>
        </div>
      )}
    </div>
  )
}

function summaryText(delivery, vehicleLabel) {
  if (!delivery) return 'Delivery not set up yet'

  const parts = []
  parts.push(delivery.delivery_type === 'hub' ? `Via hub: ${delivery.hub_name || '—'}` : 'Direct delivery')

  if (delivery.vehicle_type) {
    parts.push(vehicleLabel || delivery.vehicle_type)
    if (delivery.distance_km) parts.push(`${delivery.distance_km} km`)
    if (delivery.fare_estimate) parts.push(`≈₹${delivery.fare_estimate}`)
    if (delivery.fulfilled_via === 'motor') parts.push('via MOTOR')
    else parts.push(delivery.driver_id ? 'Driver assigned' : 'Waiting for a driver to accept')
  } else if (delivery.partner_name) {
    parts.push(delivery.partner_name)
    if (delivery.partner_phone) parts.push(`(${delivery.partner_phone})`)
  }

  if (delivery.in_transit_at) parts.push('In transit')
  else if (delivery.picked_up_at) parts.push('Picked up')
  if (delivery.delivered_at) parts.push('Delivered')

  return parts.join(' · ')
}
