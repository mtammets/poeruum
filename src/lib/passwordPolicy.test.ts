import { describe, expect, it } from 'vitest'
import {
  getPasswordPolicyError,
  PASSWORD_MIN_LENGTH,
  PASSWORD_REQUIREMENTS_TEXT,
} from './passwordPolicy'

describe('password policy', () => {
  it('accepts a password that satisfies every production requirement', () => {
    expect(getPasswordPolicyError('Turvaline-123!')).toBeNull()
  })

  it.each([
    ['Liiga-1!', 'vähemalt'],
    ['AINULT-SUURED-123!', 'väiketähte'],
    ['ainult-vaikesed-123!', 'suurtähte'],
    ['Puudub-Number!', 'numbrit'],
    ['PuudubSymbol123', 'erimärki'],
  ])('rejects %s', (password, expectedMessage) => {
    expect(getPasswordPolicyError(password)).toContain(expectedMessage)
  })

  it('keeps the UI description aligned with the configured minimum', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(12)
    expect(PASSWORD_REQUIREMENTS_TEXT).toContain(String(PASSWORD_MIN_LENGTH))
  })
})
