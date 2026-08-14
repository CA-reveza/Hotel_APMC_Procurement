import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../supabaseClient'
import { VEHICLE_TYPES, estimateFare } from '../lib/vehiclePricing'
import MotorStatus from './MotorStatus'

// Editable by supplier/admin (direct supplier→hotel delivery, or routed via a
// consolidation hub per plan §7). Hotels and drivers see relevant parts
// read-only. Three ways to fulfil a delivery: type in a partner's name/phone
// manually, book a vehicle from OrderIt's own in-house driver pool (see
// DriverDashboard.jsx), or book it out to the separate MOTOR app.
export default function DeliveryPanel({ orderId, viewerRole }) {
  const [delivery, setDelivery] = useState(null)
  const [editing, setEditing] = useState(false)
  const [bookingMode, setBookingMode] = useState(null) // null | 'internal' | 'motor'
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

  const canEdit = viewerRole === 'supplier' || viewerRole === 'admin'

  const save = async () => {
    setBusy(true)
    const { error } = await supabase
      .from('deliveries')
      .upsert({ order_id: orderId, ...form }, { onConflict: 'order_id' })
    setBusy(false)
    if (!error) { setEditing(false); load() }
  }

  const requestInternalVehicle = async () => {
    const km = parseFloat(distanceKm)
    if (!km || km <= 0) return
    setBusy(true)
    const fare = estimateFare(vehicleType, km)
    const { error } = await supabase.from('deliveries').upsert(
      {
        order_id: orderId,
        delivery_type: form.delivery_type || 'direct',
        fulfilled_via: 'internal',
        vehicle_type: vehicleType,
        distance_km: km,
        fare_estimate: fare,
        requested_at: new Date().toISOString(),
        driver_id: null
      },
      { onConflict: 'order_id' }
    )
    setBusy(false)
    if (!error) { setBookingMode(null); load() }
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

  if (!canEdit && !delivery) return null

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
          {canEdit && (
            <span className="delivery-actions-inline">
              <button className="btn-link" onClick={() => setEditing(true)}>
                {delivery?.partner_name ? 'Edit partner' : 'Set partner manually'}
              </button>
              {!delivery?.vehicle_type && (
                <>
                  <button className="btn-link" onClick={() => setBookingMode('internal')}>Book in-house vehicle</button>
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
          <div className="muted small">{bookingMode === 'motor' ? 'Booking via MOTOR' : 'Booking an in-house vehicle'}</div>
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
            <button
              className="btn btn-primary"
              disabled={busy || !distanceKm}
              onClick={bookingMode === 'motor' ? requestMotorVehicle : requestInternalVehicle}
            >
              {busy ? 'Requesting…' : bookingMode === 'motor' ? 'Book via MOTOR' : 'Request vehicle'}
            </button>
            <button className="btn-link" onClick={() => { setBookingMode(null); setError('') }}>Cancel</button>
          </div>
        </div>
      )}

      {canEdit && delivery && !editing && !bookingMode && (
        <div className="delivery-form-actions">
          {!delivery.picked_up_at && <button className="btn-link" onClick={markPicked}>Mark picked up</button>}
          {delivery.picked_up_at && !delivery.in_transit_at && <button className="btn-link" onClick={markInTransit}>Mark in transit</button>}
          {delivery.picked_up_at && !delivery.delivered_at && <button className="btn-link" onClick={markDelivered}>Mark delivered</button>}
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
