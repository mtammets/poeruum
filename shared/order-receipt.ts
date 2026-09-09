export type ReceiptStatus = 'pending' | 'unpaid' | 'paid' | 'failed' | 'expired' | 'refunded'
export type ReceiptAccess = { token: string } | { sessionId: string }
export type OrderReceipt = {
  status: ReceiptStatus
  orderNumber: string
  storeName: string
  createdAt: string
  currency: 'eur'
  total: number
  deliveryTotal: number
  delivery: string
  items: Array<{ name: string; quantity: number; unitPrice: number; options: Record<string, string> }>
  resumeUrl: string | null
}
