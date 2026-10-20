import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({ requireSupabase: vi.fn() }))
import { interviewLink, readInterviewToken } from './storyInterview'

const token = 'a'.repeat(64)
const otherToken = 'b'.repeat(64)

describe('private interview links', () => {
  it('puts the invitation in the shared URL query so it does not depend on a fragment', () => {
    const url = new URL(interviewLink(token))
    expect(url.searchParams.get('token')).toBe(token)
    expect(url.hash).toBe('')
    expect(readInterviewToken(url.hash, url.search)).toBe(token)
  })

  it('accepts existing fragment links and tracking parameters on either side of the fragment', () => {
    expect(readInterviewToken(`#token=${token}`, '')).toBe(token)
    expect(readInterviewToken(`#token=${token}`, '?fbclid=example')).toBe(token)
    expect(readInterviewToken(`#token=${token}&fbclid=example`, '')).toBe(token)
    expect(readInterviewToken(`#token=${token}?fbclid=example`, '')).toBe(token)
    expect(readInterviewToken('', `?fbclid=example&token=${token}`)).toBe(token)
  })

  it('rejects missing, truncated and malformed credentials', () => {
    for (const value of ['', 'a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64), `${token}extra`, `${token}.`]) {
      expect(readInterviewToken(`#token=${value}`, '')).toBeNull()
      expect(readInterviewToken('', `?token=${value}`)).toBeNull()
    }
    expect(readInterviewToken('', '?fbclid=example')).toBeNull()
  })

  it('rejects conflicting invitations instead of silently choosing a different customer', () => {
    expect(readInterviewToken(`#token=${token}`, `?token=${otherToken}`)).toBeNull()
    expect(readInterviewToken('', `?token=${token}&token=${otherToken}`)).toBeNull()
    expect(readInterviewToken(`#token=${token}&token=${otherToken}`, '')).toBeNull()
    expect(readInterviewToken(`#token=${token}`, `?token=${token}`)).toBe(token)
  })
})
