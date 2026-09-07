import { describe, expect, it } from 'vitest'
import { getStripePrefill } from './stripe-connect-prefill.ts'

describe('Stripe account prefill', () => {
  it('preserves business identity without treating the registered address as the operating or home address', () => {
    const prefill = getStripePrefill({
      id: 'store-example',
      name: 'Näidispood',
      settings: {
        businessName: ' Näidis OÜ ',
        registryCode: '12345678',
        businessAddress: 'Registri 1, Tallinn, Harjumaa, 10111',
        contactEmail: 'ettevote@example.com',
      },
    }, 'omanik@example.com')

    expect(prefill.company.name).toBe('Näidis OÜ')
    expect(prefill.company.registration_number).toBe('12345678')
    expect(prefill.email).toBe('ettevote@example.com')
    expect(prefill.company.address).toEqual({ country: 'EE' })
    expect(prefill).not.toHaveProperty('individual')
    expect(JSON.stringify(prefill)).not.toContain('Registri 1')
  })

  it('keeps contact fallback when the store has no seller details yet', () => {
    const prefill = getStripePrefill({ id: 'store-example', name: 'Näidispood' }, 'omanik@example.com')
    expect(prefill.email).toBe('omanik@example.com')
    expect(prefill.company.name).toBe('Näidispood')
    expect(prefill.company.registration_number).toBeUndefined()
    expect(prefill.company.address).toEqual({ country: 'EE' })
  })
})
