export type CaptureState = { productId: string; imageIndex: number; search: { query: string; selectedProductId?: string } | null }
declare global {
  interface Window { campaignCapture?: (state: CaptureState) => Promise<HTMLCanvasElement> }
}
