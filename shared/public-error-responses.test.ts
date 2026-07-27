import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const publicFunctions = [
  'admin-homepage-seo',
  'custom-domain',
  'data-retention-reaper',
  'delete-account',
  'monitor-health',
  'stripe-billing-cancel',
  'stripe-billing-checkout',
  'stripe-billing-delinquency',
  'stripe-billing-portal',
  'stripe-connect',
  'stripe-refund-order',
  'stripe-store-checkout',
]

describe('Edge Function public error responses', () => {
  it.each(publicFunctions)('%s does not return raw caught error messages', async (functionName) => {
    const source = await readFile(
      new URL(`../supabase/functions/${functionName}/index.ts`, import.meta.url),
      'utf8',
    )

    expect(source).not.toMatch(/return\s+json\(\s*\{\s*error:\s*error\.message/)
    expect(source).not.toMatch(/return\s+json\(\s*\{\s*error:\s*error\s+instanceof\s+Error\s*\?\s*error\.message/)
  })
})
