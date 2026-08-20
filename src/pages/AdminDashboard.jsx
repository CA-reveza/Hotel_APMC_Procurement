import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../supabaseClient'
import AdminOrderTable from '../components/AdminOrderTable'
import { vehicleById } from '../lib/vehiclePricing'

export default function AdminDashboard() {
  const [tab, setTab] = useState('overview')
  const [hotels, setHotels] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [drivers, setDrivers] = useState([])
  const [orders, setOrders] = useState([])
  const [deliveries, setDeliveries] = useState([])

  const loadAll = useCallback(async () => {
    const [{ data: h }, { data: s }, { data: dr }, { data: o }, { data: d }] = await Promise.all([
      supabase.from('hotels').select('*').order('created_at', { ascending: false }),
      supabase.from('suppliers').select('*').order('created_at', { ascending: false }),
      supabase.from('drivers').select('*').order('created_at', { ascending: false }),
      supabase.from('orders').select('*, order_items(*, products(*)), hotels(name), suppliers(name, apmc_yard), deliveries(*)').order('created_at', { ascending: false }),
      supabase.from('deliveries').select('*, orders(id, hotels(name), suppliers(name))').order('created_at', { ascending: false })
    ])
    setHotels(h || [])
    setSuppliers(s || [])
    setDrivers(dr || [])
    setOrders(o || [])
    setDeliveries(d || [])
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  useEffect(() => {
    const channel = supabase
      .channel('admin-orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => loadAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'drivers' }, () => loadAll())
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [loadAll])

  const gmv = orders.reduce((sum, o) => sum + Number(o.order_total || 0), 0)
  const commissionEarned = orders.reduce((sum, o) => sum + Number(o.commission_amount || 0), 0)
  const deliveryContribution = orders.reduce((sum, o) => sum + Number(o.delivery_contribution || 0), 0)
  const activeOrders = orders.filter((o) => !['delivered', 'rejected', 'cancelled'].includes(o.status)).length
  const paidOrders = orders.filter((o) => o.payment_status === 'paid').length
  const whatsappOrders = orders.filter((o) => o.source === 'whatsapp').length

  return (
    <div>
      <h2>Admin overview</h2>
      <div className="tabs">
        <button className={tab === 'overview' ? 'tab active' : 'tab'} onClick={() => setTab('overview')}>Overview</button>
        <button className={tab === 'orders' ? 'tab active' : 'tab'} onClick={() => setTab('orders')}>All orders ({orders.length})</button>
        <button className={tab === 'hotels' ? 'tab active' : 'tab'} onClick={() => setTab('hotels')}>Hotels ({hotels.length})</button>
        <button className={tab === 'suppliers' ? 'tab active' : 'tab'} onClick={() => setTab('suppliers')}>Suppliers ({suppliers.length})</button>
        <button className={tab === 'deliveries' ? 'tab active' : 'tab'} onClick={() => setTab('deliveries')}>Deliveries ({deliveries.length})</button>
        <button className={tab === 'drivers' ? 'tab active' : 'tab'} onClick={() => setTab('drivers')}>Drivers ({drivers.length})</button>
      </div>

      {tab === 'overview' && (
        <div className="stat-grid">
          <StatCard label="Total GMV" value={`₹${gmv.toLocaleString('en-IN')}`} />
          <StatCard label="Commission earned" value={`₹${commissionEarned.toLocaleString('en-IN')}`} />
          <StatCard label="Delivery contribution" value={`₹${deliveryContribution.toLocaleString('en-IN')}`} />
          <StatCard label="Gross contribution" value={`₹${(commissionEarned + deliveryContribution).toLocaleString('en-IN')}`} />
          <StatCard label="Active orders" value={activeOrders} />
          <StatCard label="Paid orders" value={paidOrders} />
          <StatCard label="Orders via WhatsApp" value={whatsappOrders} />
          <StatCard label="Hotels onboarded" value={hotels.length} />
          <StatCard label="Suppliers onboarded" value={suppliers.length} />
          <StatCard label="Total orders" value={orders.length} />
        </div>
      )}

      {tab === 'orders' && <AdminOrderTable orders={orders} onChanged={loadAll} />}

      {tab === 'hotels' && (
        <table className="table">
          <thead><tr><th>Name</th><th>City</th><th>Address</th><th>GST</th><th>Credit allowed</th></tr></thead>
          <tbody>
            {hotels.map((h) => (
              <tr key={h.id}>
                <td>{h.name}</td><td>{h.city}</td><td>{h.address}</td><td>{h.gst_number}</td>
                <td>{h.credit_allowed ? 'Yes' : 'No'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {tab === 'suppliers' && (
        <table className="table">
          <thead><tr><th>Name</th><th>APMC yard</th><th>Address</th><th>GST</th><th>Rating</th></tr></thead>
          <tbody>
            {suppliers.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td><td>{s.apmc_yard}</td><td>{s.address}</td><td>{s.gst_number}</td><td>{s.rating}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {tab === 'deliveries' && (
        <table className="table">
          <thead><tr><th>Order</th><th>Hotel</th><th>Supplier</th><th>Type</th><th>Hub / Partner / Vehicle</th><th>Fare</th><th>Picked up</th><th>Delivered</th></tr></thead>
          <tbody>
            {deliveries.map((d) => (
              <tr key={d.id}>
                <td>#{d.order_id.slice(0, 8)}</td>
                <td>{d.orders?.hotels?.name}</td>
                <td>{d.orders?.suppliers?.name}</td>
                <td>{d.delivery_type}</td>
                <td>
                  {d.vehicle_type
                    ? `${vehicleById(d.vehicle_type)?.label || d.vehicle_type}${d.driver_id ? ' · driver assigned' : ' · waiting for driver'}`
                    : (d.delivery_type === 'hub' ? d.hub_name : d.partner_name)}
                </td>
                <td>{d.fare_estimate ? `₹${d.fare_estimate}` : '—'}</td>
                <td>{d.picked_up_at ? new Date(d.picked_up_at).toLocaleString('en-IN') : '—'}</td>
                <td>{d.delivered_at ? new Date(d.delivered_at).toLocaleString('en-IN') : '—'}</td>
              </tr>
            ))}
            {!deliveries.length && <tr><td colSpan={8} className="muted">No deliveries set up yet.</td></tr>}
          </tbody>
        </table>
      )}

      {tab === 'drivers' && (
        <table className="table">
          <thead><tr><th>Name</th><th>Phone</th><th>Vehicle</th><th>Vehicle no.</th><th>Status</th></tr></thead>
          <tbody>
            {drivers.map((d) => (
              <tr key={d.id}>
                <td>{d.name}</td><td>{d.phone}</td>
                <td>{vehicleById(d.vehicle_type)?.label || d.vehicle_type}</td>
                <td>{d.vehicle_number}</td>
                <td>
                  <span className={`status-badge ${d.is_online ? 'status-online' : 'status-offline'}`}>
                    {d.is_online ? 'Online' : 'Offline'}
                  </span>
                </td>
              </tr>
            ))}
            {!drivers.length && <tr><td colSpan={5} className="muted">No delivery partners registered yet.</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  )
}

function StatCard({ label, value }) {
  return (
    <div className="card stat-card">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  )
}
