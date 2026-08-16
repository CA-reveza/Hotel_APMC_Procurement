// Shared aggregation helpers for the Hotel spend report and Supplier revenue
// report. Both work off the same shape of data (orders with nested
// order_items+products) already loaded by each dashboard, so no extra
// queries are needed just to show a report.

const COMPLETED_STATUSES = ['delivered', 'out_for_delivery', 'packed', 'accepted']

// Only count orders that weren't rejected/cancelled — a pending order
// hasn't actually generated revenue/spend yet, but anything past "accepted"
// is real business, not just a request.
export function filterCompleted(orders) {
  return orders.filter((o) => COMPLETED_STATUSES.includes(o.status))
}

export function filterByRange(orders, days) {
  if (!days) return orders // 'all time'
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  return orders.filter((o) => new Date(o.created_at).getTime() >= cutoff)
}

export function monthKey(dateStr) {
  const d = new Date(dateStr)
  return `${d.toLocaleString('en-IN', { month: 'short' })} '${String(d.getFullYear()).slice(2)}`
}

// Returns [{ month, total }] in chronological order, one point per
// calendar month that actually has at least one order in range.
export function groupByMonth(orders, valueField) {
  const map = new Map()
  for (const o of orders) {
    const key = monthKey(o.created_at)
    map.set(key, (map.get(key) || 0) + Number(o[valueField] || 0))
  }
  // Re-sort by actual date, not alphabetically by label
  return [...map.entries()]
    .map(([month, total]) => ({ month, total, sortKey: orders.find((o) => monthKey(o.created_at) === month)?.created_at }))
    .sort((a, b) => new Date(a.sortKey) - new Date(b.sortKey))
    .map(({ month, total }) => ({ month, total }))
}

// Top N products by total spend/revenue across an orders array's order_items.
export function topProducts(orders, limit = 5) {
  const map = new Map()
  for (const o of orders) {
    for (const it of o.order_items || []) {
      const name = it.products?.name || 'Unknown'
      const amount = Number(it.line_total ?? it.quantity * it.unit_price)
      map.set(name, (map.get(name) || 0) + amount)
    }
  }
  return [...map.entries()]
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit)
}

// Top N counterparties (suppliers for a hotel report, hotels for a supplier
// report) by total order value.
export function topCounterparties(orders, nameFn, limit = 5) {
  const map = new Map()
  for (const o of orders) {
    const name = nameFn(o) || 'Unknown'
    map.set(name, (map.get(name) || 0) + Number(o.order_total || 0))
  }
  return [...map.entries()]
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit)
}

export function sum(orders, field) {
  return orders.reduce((s, o) => s + Number(o[field] || 0), 0)
}
