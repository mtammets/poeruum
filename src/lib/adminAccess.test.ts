import { describe, expect, it } from 'vitest'
import { hasAdminRole } from './adminAccess'

describe('hasAdminRole', () => {
  it('allows the server-managed admin role', () => {
    expect(hasAdminRole({ app_metadata: { role: 'admin' } })).toBe(true)
  })

  it('rejects missing and non-admin roles', () => {
    expect(hasAdminRole({ app_metadata: {} })).toBe(false)
    expect(hasAdminRole({ app_metadata: { role: 'merchant' } })).toBe(false)
  })
})
