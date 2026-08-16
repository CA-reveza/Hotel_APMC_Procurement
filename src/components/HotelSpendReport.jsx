import { useMemo, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { filterCompleted, filterByRange, groupByMonth, topProducts, topCounterparties, sum } from '../lib/reportUtils'

const RANGE_OPTIONS = [
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
  { label: 'Last 12 months', days: 365 },
  { label: 'All time', days: null }
]

export default function HotelSpendReport({ orders }) {
  const [rangeDays, setRangeDays] = useState(90)

  const inRange = useMemo(
    () => filterCompleted(filterByRange(orders, rangeDays)),
    [orders, rangeDays]
  )

  const totalSpend = sum(inRange, 'order_total')
  const orderCount = inRange.length
  const avgOrder = orderCount ? totalSpend / orderCount : 0
  const monthly = useMemo(() => groupByMonth(inRange, 'order_total'), [inRange])
  const bySupplier = useMemo(() => topCounterparties(inRange, (o) => o.suppliers?.name), [inRange])
  const byProduct = useMemo(() => topProducts(inRange), [inRange])

  return (
    <div>
      <div className="report-toolbar">
        <h3 style={{ margin: 0 }}>Spend report</h3>
        <select value={rangeDays ?? ''} onChange={(e) => setRangeDays(e.target.value ? Number(e.target.value) : null)}>
          {RANGE_OPTIONS.map((opt) => (
            <option key={opt.label} value={opt.days ?? ''}>{opt.label}</option>
          ))}
        </select>
      </div>

      <div className="stat-grid">
        <div className="card stat-card">
          <div className="stat-value">₹{totalSpend.toLocaleString('en-IN')}</div>
          <div className="stat-label">Total spend</div>
        </div>
        <div className="card stat-card">
          <div className="stat-value">{orderCount}</div>
          <div className="stat-label">Orders</div>
        </div>
        <div className="card stat-card">
          <div className="stat-value">₹{avgOrder.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
          <div className="stat-label">Average order value</div>
        </div>
      </div>

      {monthly.length > 0 && (
        <div className="card">
          <h4 style={{ marginTop: 0 }}>Spend by month</h4>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={monthly}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef0f3" />
              <XAxis dataKey="month" fontSize={12} />
              <YAxis fontSize={12} />
              <Tooltip formatter={(v) => `₹${Number(v).toLocaleString('en-IN')}`} />
              <Bar dataKey="total" fill="#1c6e4a" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="grid-2">
        <div className="card">
          <h4 style={{ marginTop: 0 }}>Top suppliers by spend</h4>
          {!bySupplier.length && <p className="muted small">No data in this range.</p>}
          <table className="table small">
            <tbody>
              {bySupplier.map((row) => (
                <tr key={row.name}>
                  <td>{row.name}</td>
                  <td style={{ textAlign: 'right' }}>₹{row.total.toLocaleString('en-IN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h4 style={{ marginTop: 0 }}>Top products by spend</h4>
          {!byProduct.length && <p className="muted small">No data in this range.</p>}
          <table className="table small">
            <tbody>
              {byProduct.map((row) => (
                <tr key={row.name}>
                  <td>{row.name}</td>
                  <td style={{ textAlign: 'right' }}>₹{row.total.toLocaleString('en-IN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
