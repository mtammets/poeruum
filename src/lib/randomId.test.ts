import { describe, expect, it } from 'vitest'
import { createRandomId } from './randomId'

describe('createRandomId', () => {
  it('uses randomUUID when the browser exposes it', () => {
    expect(createRandomId({ randomUUID: () => 'native-uuid' })).toBe('native-uuid')
  })

  it('uses getRandomValues on non-secure LAN origins', () => {
    const value = createRandomId({
      getRandomValues: (bytes) => {
        bytes.fill(0xab)
        return bytes
      },
    })
    expect(value).toBe('ab'.repeat(16))
  })

  it('still returns an identifier when Web Crypto is unavailable', () => {
    expect(createRandomId({})).toMatch(/^[a-z0-9]+-[a-z0-9]+$/)
  })
})
