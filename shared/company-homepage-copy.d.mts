export type CompanyCopy = Partial<Record<string, string>>
export const companyCopyFields: Record<string, [label: string, limit: number]>
export function normalizeCompanyCopy(value: unknown): CompanyCopy
export function companyCopyDefaults(settings?: Record<string, unknown>, name?: string, product?: { slug?: string; name: string; description?: string }): Record<string, string>
export function companyCopyEqual(a: unknown, b: unknown): boolean
