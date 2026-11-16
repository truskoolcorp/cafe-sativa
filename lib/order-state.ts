export function orderReceiptState(order: { paid_at?: string | null; fulfillment_state?: string } | null) {
  if (!order || !order.paid_at || !Number.isFinite(Date.parse(order.paid_at))) return 'pending'
  if (order.fulfillment_state === 'refunded') return 'refunded'
  return 'confirmed'
}
