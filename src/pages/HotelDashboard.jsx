import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { supabase } from '../supabaseClient'
import HotelOrderTable from '../components/HotelOrderTable'
import QuoteRequests from '../components/QuoteRequests'
import { downloadHotelOrderTemplate, parseHotelOrderTemplate } from '../lib/excelTemplates'
import { CATEGORY_TILES, categoryTileFor } from '../lib/categoryTiles'

export default function HotelDashboard({ hotel }) {
  const [tab, setTab] = useState('order') // 'order' | 'orders' | 'bidding'
  const [suppliers, setSuppliers] = useState([])
  const [supplierId, setSupplierId] = useState('')
  const [priceRows, setPriceRows] = useState([]) // supplier_prices joined with products
  const [categoryFilter, setCategoryFilter] = useState('All')
  const [cart, setCart] = useState({}) // product_id -> qty
  const [orders, setOrders] = useState([])
  const [allProducts, setAllProducts] = useState([])
  const [placing, setPlacing] = useState(false)
  const [message, setMessage] = useState('')
  const [bulkMessage, setBulkMessage] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)
  const fileInputRef = useRef(null)

  const loadSuppliers = useCallback(async () => {
    const { data } = await supabase.from('suppliers').select('*').order('name')
    setSuppliers(data || [])
    if (data?.length && !supplierId) setSupplierId(data[0].id)
  }, [supplierId])

  const loadPrices = useCallback(async (sId) => {
    if (!sId) return
    const { data } = await supabase
      .from('supplier_prices')
      .select('*, products(*)')
      .eq('supplier_id', sId)
      .order('price_date', { ascending: false })
    // Keep only the latest price row per product
    const latestByProduct = {}
    for (const row of data || []) {
      if (!latestByProduct[row.product_id]) latestByProduct[row.product_id] = row
    }
    setPriceRows(Object.values(latestByProduct))
  }, [])

  const loadOrders = useCallback(async () => {
    if (!hotel?.id) return
    const { data } = await supabase
      .from('orders')
      .select('*, order_items(*, products(*)), suppliers(name, apmc_yard), hotels(name, address), deliveries(*)')
      .eq('hotel_id', hotel.id)
      .order('created_at', { ascending: false })
    setOrders(data || [])
  }, [hotel])

  const loadProducts = useCallback(async () => {
    const { data } = await supabase.from('products').select('*').eq('active', true).order('name')
    setAllProducts(data || [])
  }, [])

  useEffect(() => { loadSuppliers() }, [loadSuppliers])
  useEffect(() => { loadPrices(supplierId) }, [supplierId, loadPrices])
  useEffect(() => { loadOrders() }, [loadOrders])
  useEffect(() => { loadProducts() }, [loadProducts])

  // Realtime: refresh orders whenever this hotel's orders change (e.g. supplier accepts/updates)
  useEffect(() => {
    if (!hotel?.id) return
    const channel = supabase
      .channel(`hotel-orders-${hotel.id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `hotel_id=eq.${hotel.id}` },
        () => loadOrders()
      )
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [hotel, loadOrders])

  // Realtime: deliveries has no hotel_id to filter on, so just refresh on any
  // change — this is what makes a MOTOR driver's status update (pushed via
  // the motor-status-webhook Edge Function) show up live without a reload.
  useEffect(() => {
    if (!hotel?.id) return
    const channel = supabase
      .channel(`hotel-deliveries-${hotel.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deliveries' }, () => loadOrders())
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [hotel, loadOrders])

  const cartLines = useMemo(() => {
    return priceRows
      .filter((row) => cart[row.product_id] > 0 && row.in_stock !== false)
      .map((row) => ({
        product_id: row.product_id,
        name: row.products?.name,
        unit: row.products?.unit,
        qty: cart[row.product_id],
        price: row.price,
        lineTotal: cart[row.product_id] * row.price
      }))
  }, [cart, priceRows])

  const cartTotal = cartLines.reduce((sum, l) => sum + l.lineTotal, 0)
  const selectedSupplierName = suppliers.find((s) => s.id === supplierId)?.name

  const setQty = (productId, qty) => {
    setCart((prev) => ({ ...prev, [productId]: qty }))
  }

  const handleDownloadOrderTemplate = () => {
    downloadHotelOrderTemplate(priceRows, selectedSupplierName)
  }

  const handleUploadOrderTemplate = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setBulkBusy(true)
    setBulkMessage('')
    try {
      const { cart: parsedCart, skippedOutOfStock, unmatched } = await parseHotelOrderTemplate(file, priceRows)
      const count = Object.keys(parsedCart).length
      if (!count) {
        setBulkMessage('No orderable quantities found in that file. Fill in the Qty column and try again.')
      } else {
        setCart((prev) => ({ ...prev, ...parsedCart }))
        let msg = `Added ${count} item${count === 1 ? '' : 's'} to the cart from the file.`
        if (skippedOutOfStock.length) msg += ` Skipped out-of-stock: ${skippedOutOfStock.join(', ')}.`
        if (unmatched.length) msg += ` Not found in this supplier's list: ${unmatched.join(', ')}.`
        setBulkMessage(msg)
      }
    } catch (err) {
      setBulkMessage(`Couldn't read that file: ${err.message}`)
    }
    setBulkBusy(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const placeOrder = async () => {
    if (!cartLines.length) return
    setPlacing(true)
    setMessage('')

    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .insert({ hotel_id: hotel.id, supplier_id: supplierId, delivery_address: hotel.address })
      .select()
      .single()

    if (orderErr) {
      setMessage(`Order failed: ${orderErr.message}`)
      setPlacing(false)
      return
    }

    const items = cartLines.map((l) => ({
      order_id: order.id,
      product_id: l.product_id,
      quantity: l.qty,
      unit_price: l.price
    }))

    const { error: itemsErr } = await supabase.from('order_items').insert(items)
    if (itemsErr) {
      setMessage(`Order created but items failed: ${itemsErr.message}`)
    } else {
      setMessage(`Order placed! Total ₹${cartTotal.toFixed(2)}.`)
      setCart({})
      loadOrders()
    }
    setPlacing(false)
  }

  return (
    <div>
      <h2>{hotel?.name}</h2>
      <div className="tabs">
        <button className={tab === 'order' ? 'tab active' : 'tab'} onClick={() => setTab('order')}>Place order</button>
        <button className={tab === 'orders' ? 'tab active' : 'tab'} onClick={() => setTab('orders')}>My orders ({orders.length})</button>
        <button className={tab === 'bidding' ? 'tab active' : 'tab'} onClick={() => setTab('bidding')}>Request quotes</button>
      </div>

      {tab === 'order' && (
        <div className="grid-2">
          <div className="card">
            <label>Supplier</label>
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}{s.apmc_yard ? ` — ${s.apmc_yard}` : ''}</option>
              ))}
            </select>

            <div className="category-tiles">
              {['All', ...CATEGORY_TILES].map((tile) => (
                <button
                  key={tile}
                  type="button"
                  className={`category-tile ${categoryFilter === tile ? 'active' : ''}`}
                  onClick={() => setCategoryFilter(tile)}
                >
                  {tile}
                </button>
              ))}
            </div>

            {priceRows.length > 0 && (
              <div className="bulk-bar">
                <button className="btn btn-ghost-dark" onClick={handleDownloadOrderTemplate}>⬇ Download order sheet (.xlsx)</button>
                <label className="btn btn-ghost-dark upload-label">
                  {bulkBusy ? 'Uploading…' : '⬆ Upload filled sheet'}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={handleUploadOrderTemplate}
                    disabled={bulkBusy}
                    hidden
                  />
                </label>
              </div>
            )}
            {bulkMessage && <div className="alert alert-info">{bulkMessage}</div>}

            <table className="table">
              <thead>
                <tr><th>Product</th><th>Price</th><th>Grade</th><th>Stock</th><th>Qty</th></tr>
              </thead>
              <tbody>
                {priceRows
                  .filter((row) => categoryFilter === 'All' || categoryTileFor(row.products?.category) === categoryFilter)
                  .map((row) => {
                  const outOfStock = row.in_stock === false
                  const isLowStock = !outOfStock && row.available_qty > 0 && row.available_qty <= (row.low_stock_threshold || 5)
                  return (
                    <tr key={row.id} className={outOfStock ? 'row-disabled' : ''}>
                      <td>{row.products?.name}</td>
                      <td>₹{row.price} / {row.products?.unit}</td>
                      <td>{row.grade}</td>
                      <td>
                        <span className={`stock-badge ${outOfStock ? 'out-of-stock' : 'in-stock'}`}>
                          {outOfStock ? 'Out of stock' : 'In stock'}
                        </span>
                        {isLowStock && (
                          <div className="delivery-badge delivery-requested" style={{ marginTop: 4 }}>
                            Only {row.available_qty} {row.products?.unit} left
                          </div>
                        )}
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="0.5"
                          className="qty-input"
                          disabled={outOfStock}
                          value={outOfStock ? '' : (cart[row.product_id] || '')}
                          onChange={(e) => setQty(row.product_id, parseFloat(e.target.value) || 0)}
                        />
                      </td>
                    </tr>
                  )
                })}
                {!priceRows.length && (
                  <tr><td colSpan={5} className="muted">No prices published by this supplier yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="card">
            <h3>Cart</h3>
            {!cartLines.length && <p className="muted">No items yet.</p>}
            {cartLines.map((l) => (
              <div key={l.product_id} className="cart-line">
                <span>{l.name} × {l.qty} {l.unit}</span>
                <span>₹{l.lineTotal.toFixed(2)}</span>
              </div>
            ))}
            {cartLines.length > 0 && (
              <>
                <div className="cart-total">Total: ₹{cartTotal.toFixed(2)}</div>
                <button className="btn btn-primary" disabled={placing} onClick={placeOrder}>
                  {placing ? 'Placing order…' : 'Place order'}
                </button>
              </>
            )}
            {message && <div className="alert alert-info">{message}</div>}
          </div>
        </div>
      )}

      {tab === 'orders' && <HotelOrderTable orders={orders} onChanged={loadOrders} />}

      {tab === 'bidding' && (
        <QuoteRequests hotel={hotel} products={allProducts} onOrderPlaced={loadOrders} />
      )}
    </div>
  )
}
