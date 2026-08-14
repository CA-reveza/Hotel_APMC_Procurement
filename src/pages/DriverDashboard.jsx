import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../supabaseClient'
import { vehicleById } from '../lib/vehiclePricing'

export default function DriverDashboard({ profile, driver }) {
  const [tab, setTab] = useState('available')
  const [available, setAvailable] = useState([])
  const [mine, setMine] = useState([])
  const [busy, setBusy] = useState('')

  const loadAvailable = useCallback(async () => {
    const { data } = await supabase
      .from('deliveries')
      .select('*, orders(id, order_total, delivery_address, hotels(name, address), suppliers(name, apmc_yard))')
      .is('driver_id', null)
      .not('vehicle_type', 'is', null)
      .order('requested_at', { ascending: true })
    setAvailable(data || [])
  }, [])

  const loadMine = useCallback(async () => {
    const { data } = await supabase
      .from('deliveries')
      .select('*, orders(id, order_total, delivery_address, hotels(name, address), suppliers(name, apmc_yard))')
      .eq('driver_id', profile.id)
      .order('accepted_at', { ascending: false })
    setMine(data || [])
  }, [profile.id])

  useEffect(() => { loadAvailable() }, [loadAvailable])
  useEffect(() => { loadMine() }, [loadMine])

  useEffect(() => {
    const channel = supabase
      .channel(`driver-deliveries-${profile.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deliveries' }, () => {
        loadAvailable()
        loadMine()
      })
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [profile.id, loadAvailable, loadMine])

  const accept = async (deliveryId) => {
    setBusy(deliveryId)
    const { error } = await supabase
      .from('deliveries')
      .update({ driver_id: profile.id, accepted_at: new Date().toISOString() })
      .eq('id', deliveryId)
      .is('driver_id', null) // guard against a race with another driver
    setBusy('')
    if (error) return
    loadAvailable()
    loadMine()
  }

  const advance = async (delivery, field) => {
    setBusy(delivery.id)
    await supabase.from('deliveries').update({ [field]: new Date().toISOString() }).eq('id', delivery.id)
    setBusy('')
    loadMine()
  }

  return (
    <div>
      <h2>{driver?.name}</h2>
      <p className="muted small">
        {driver?.vehicle_type ? vehicleById(driver.vehicle_type)?.label : ''} {driver?.vehicle_number ? `· ${driver.vehicle_number}` : ''}
      </p>

      <div className="tabs">
        <button className={tab === 'available' ? 'tab active' : 'tab'} onClick={() => setTab('available')}>Available ({available.length})</button>
        <button className={tab === 'mine' ? 'tab active' : 'tab'} onClick={() => setTab('mine')}>My deliveries ({mine.length})</button>
      </div>

      {tab === 'available' && (
        available.length
          ? available.map((d) => (
            <div key={d.id} className="card order-card">
              <DeliveryInfo delivery={d} />
              <div className="order-card-actions">
                <button className="btn btn-primary" disabled={busy === d.id} onClick={() => accept(d.id)}>
                  {busy === d.id ? 'Accepting…' : 'Accept'}
                </button>
              </div>
            </div>
          ))
          : <p className="muted">No open delivery requests right now.</p>
      )}

      {tab === 'mine' && (
        mine.length
          ? mine.map((d) => (
            <div key={d.id} className="card order-card">
              <DeliveryInfo delivery={d} />
              <div className="order-card-actions">
                {!d.picked_up_at && (
                  <button className="btn btn-primary" disabled={busy === d.id} onClick={() => advance(d, 'picked_up_at')}>Mark picked up</button>
                )}
                {d.picked_up_at && !d.in_transit_at && (
                  <button className="btn btn-primary" disabled={busy === d.id} onClick={() => advance(d, 'in_transit_at')}>Mark in transit</button>
                )}
                {d.picked_up_at && !d.delivered_at && (
                  <button className="btn btn-primary" disabled={busy === d.id} onClick={() => advance(d, 'delivered_at')}>Mark delivered</button>
                )}
                {d.delivered_at && <span className="status-badge status-delivered">Delivered</span>}
              </div>
            </div>
          ))
          : <p className="muted">You haven't accepted any deliveries yet.</p>
      )}
    </div>
  )
}

function DeliveryInfo({ delivery }) {
  const vehicle = delivery.vehicle_type ? vehicleById(delivery.vehicle_type) : null
  return (
    <div className="order-card-meta">
      <div><strong>Pick up:</strong> {delivery.orders?.suppliers?.name} {delivery.orders?.suppliers?.apmc_yard ? `(${delivery.orders.suppliers.apmc_yard})` : ''}</div>
      <div><strong>Drop:</strong> {delivery.orders?.hotels?.name} — {delivery.orders?.delivery_address || delivery.orders?.hotels?.address || 'address not provided'}</div>
      <div>{vehicle?.label} · {delivery.distance_km} km · Fare ≈ ₹{delivery.fare_estimate}</div>
      <div className="muted small">Order total: ₹{Number(delivery.orders?.order_total).toFixed(2)}</div>
    </div>
  )
}
