import { describe, expect, it } from 'vitest'
import { sanitizeErrorUrl } from './errorMonitoring'

describe('sanitizeErrorUrl', () => {
  it('removes query parameters and fragments that can contain tokens', () => {
    expect(sanitizeErrorUrl('https://poeruum.ee/p/test?session_id=secret#checkout'))
      .toBe('https://poeruum.ee/p/test')
  })

  it('rejects invalid URLs', () => {
    expect(sanitizeErrorUrl('not-a-url')).toBe('')
  })
})
