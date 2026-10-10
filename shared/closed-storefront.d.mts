export type ClosedStore = { name: string; logo: string | null; theme: 'midnight' | 'paper' | 'pop'; accent: string }
export const closedStoreMessage: string
export const closedStoreStyles: string
export function normalizeClosedStore(value: unknown): ClosedStore | null
export function renderClosedStoreContent(value: ClosedStore): string
export function renderClosedStoreDocument(value: ClosedStore): string
