import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../supabaseClient'
import OrderList from '../components/OrderList'

export default function SupplierDashboard({ supplier }) {
  const [tab, setTab] = useState('orders')
  const [products, setProducts] = useState([])
  const [myPrices, setMyPrices] = useState([]) // keyed by product_id
  const [orders, setOrders] = useState([])
  const [saving, setSaving] = useState('')

  const loadProducts = useCallback(async () => {
    const { data } = await supabase.from('products').select('*').eq('active', true).order('name')
    setProducts(data || [])
  }, [])

  const loadMyPrices = useCallback(async () => {
    if (!supplier?.id) return
    const { data } = await supabase
      .from('supplier_prices')
      .select('*')
      .eq('supplier_id', supplier.id)
      .eq('price_date', new Date().toISOString().slice(0, 10))
    const map = {}
    for (const row of data || []) map[row.product_id] = row
    setMyPrices(map)
  }, [supplier])

  const loadOrders = useCallback(async () => {
    if (!supplier?.id) return
    const { data } = await supabase
      .from('orders')
      .select('*, order_items(*, products(*)), hotels(name, address)')
      .eq('supplier_id', supplier.id)
      .order('created_at', { ascending: false })
    setOrders(data || [])
  }, [supplier])

  useEffect(() => { loadProducts() }, [loadProducts])
  useEffect(() => { loadMyPrices() }, [loadMyPrices])
  useEffect(() => { loadOrders() }, [loadOrders])

  useEffect(() => {
    if (!supplier?.id) return
    const channel = supabase
      .channel(`supplier-orders-${supplier.id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `supplier_id=eq.${supplier.id}` },
        () => loadOrders()
      )
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [supplier, loadOrders])

  const savePrice = async (productId, price, grade, availableQty) => {
    if (!price || price <= 0) return
    setSaving(productId)
    const today = new Date().toISOString().slice(0, 10)
    const { error } = await supabase
      .from('supplier_prices')
      .upsert(
        {
          supplier_id: supplier.id,
          product_id: productId,
          price,
          grade,
          available_qty: availableQty || 0,
          price_date: today
        },
        { onConflict: 'supplier_id,product_id,price_date' }
      )
    setSaving('')
    if (!error) loadMyPrices()
  }

  return (
    <div>
      <h2>{supplier?.name}</h2>
      <div className="tabs">
        <button className={tab === 'orders' ? 'tab active' : 'tab'} onClick={() => setTab('orders')}>Incoming orders ({orders.length})</button>
        <button className={tab === 'prices' ? 'tab active' : 'tab'} onClick={() => setTab('prices')}>Today's prices</button>
      </div>

      {tab === 'orders' && <OrderList orders={orders} viewerRole="supplier" onChanged={loadOrders} />}

      {tab === 'prices' && (
        <div className="card">
          <p className="muted">Set today's price, grade and available quantity per product. Hotels see these instantly.</p>
          <table className="table">
            <thead>
              <tr><th>Product</th><th>Price (₹)</th><th>Grade</th><th>Available qty</th><th></th></tr>
            </thead>
            <tbody>
              {products.map((p) => {
                const existing = myPrices[p.id]
                return (
                  <PriceRow
                    key={p.id}
                    product={p}
                    existing={existing}
                    saving={saving === p.id}
                    onSave={savePrice}
                  />
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function PriceRow({ product, existing, saving, onSave }) {
  const [price, setPrice] = useState(existing?.price ?? '')
  const [grade, setGrade] = useState(existing?.grade ?? 'A')
  const [qty, setQty] = useState(existing?.available_qty ?? '')

  useEffect(() => {
    setPrice(existing?.price ?? '')
    setGrade(existing?.grade ?? 'A')
    setQty(existing?.available_qty ?? '')
  }, [existing])

  return (
    <tr>
      <td>{product.name} <span className="muted small">/ {product.unit}</span></td>
      <td><input type="number" min="0" step="0.5" className="qty-input" value={price} onChange={(e) => setPrice(e.target.value)} /></td>
      <td>
        <select value={grade} onChange={(e) => setGrade(e.target.value)}>
          <option value="A">A</option>
          <option value="B">B</option>
        </select>
      </td>
      <td><input type="number" min="0" className="qty-input" value={qty} onChange={(e) => setQty(e.target.value)} /></td>
      <td>
        <button className="btn btn-primary" disabled={saving} onClick={() => onSave(product.id, parseFloat(price), grade, parseFloat(qty))}>
          {saving ? 'Saving…' : existing ? 'Update' : 'Publish'}
        </button>
      </td>
    </tr>
  )
}
