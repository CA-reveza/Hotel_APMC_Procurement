import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

export function downloadInvoice(order) {
  const doc = new jsPDF()

  doc.setFontSize(16)
  doc.text('Hotel–APMC Procurement Platform', 14, 18)
  doc.setFontSize(11)
  doc.text('Tax Invoice', 14, 26)

  doc.setFontSize(9)
  doc.text(`Invoice / Order #: ${order.id}`, 14, 36)
  doc.text(`Date: ${new Date(order.created_at).toLocaleString('en-IN')}`, 14, 42)
  doc.text(`Status: ${order.status}   Payment: ${order.payment_status || 'unpaid'}`, 14, 48)

  let y = 58
  const supplierLabel = order.suppliers?.name
    ? `${order.suppliers.name}${order.suppliers.apmc_yard ? ` (${order.suppliers.apmc_yard})` : ''}`
    : ''
  const infoLines = [
    ['Hotel', order.hotels?.name],
    ['Deliver to', order.delivery_address || order.hotels?.address],
    ['Supplier', supplierLabel]
  ].filter(([, value]) => value)

  for (const [label, value] of infoLines) {
    doc.text(`${label}: ${value}`, 14, y)
    y += 6
  }
  if (!infoLines.length) y += 2 // keep spacing sane if everything was blank

  const rows = (order.order_items || []).map((it) => [
    it.products?.name || '',
    `${it.quantity} ${it.products?.unit || ''}`,
    `Rs. ${Number(it.unit_price).toFixed(2)}`,
    `Rs. ${Number(it.line_total ?? it.quantity * it.unit_price).toFixed(2)}`
  ])

  autoTable(doc, {
    startY: y + 4,
    head: [['Item', 'Qty', 'Rate', 'Amount']],
    body: rows,
    styles: { fontSize: 9 },
    headStyles: { fillColor: [28, 110, 74] }
  })

  const finalY = doc.lastAutoTable.finalY + 8
  doc.setFontSize(10)
  doc.text(`Order total: Rs. ${Number(order.order_total).toFixed(2)}`, 14, finalY)
  doc.setFontSize(8)
  doc.setTextColor(120)
  doc.text(
    `Platform commission (${order.commission_pct}%): Rs. ${Number(order.commission_amount).toFixed(2)} · Delivery contribution: Rs. ${Number(order.delivery_contribution).toFixed(2)}`,
    14,
    finalY + 6
  )

  doc.save(`invoice-${order.id.slice(0, 8)}.pdf`)
}
