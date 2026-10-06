export type CaptureState = { productId: string; imageIndex: number; search: { query: string; selectedProductId?: string } | null }
export type StoreCapture = {
  page: HTMLCanvasElement
  carousel?: { image: HTMLCanvasElement; overlay: HTMLCanvasElement }
}
declare global {
  interface Window { campaignCapture?: (state: CaptureState) => Promise<StoreCapture> }
}
