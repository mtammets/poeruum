import { describe, expect, it } from 'vitest'
import { createSharedAuthStorage } from './sharedAuthStorage'

const createJar = () => {
  const values = new Map<string, string>()
  const writes: string[] = []
  return {
    values,
    writes,
    get cookie() { return [...values].map(([name, value]) => `${name}=${value}`).join('; ') },
    set cookie(cookie: string) {
      writes.push(cookie)
      const pair = cookie.split(';')[0]
      const separator = pair.indexOf('=')
      const name = pair.slice(0, separator)
      if (cookie.includes('Max-Age=0;')) values.delete(name)
      else values.set(name, pair.slice(separator + 1))
    },
  }
}

const createLegacy = () => {
  const values = new Map<string, string>()
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => { values.delete(key) },
  }
}

describe('shared merchant authentication storage', () => {
  it('shares a large Unicode session between the platform and a shop, then removes obsolete chunks', () => {
    const jar = createJar()
    const platform = createSharedAuthStorage(new URL('https://poeruum.ee'), jar, createLegacy())!
    const shop = createSharedAuthStorage(new URL('https://urgits.poeruum.ee'), jar, createLegacy())!
    const value = JSON.stringify({ user: { name: 'Jüri '.repeat(1200) }, access_token: 'test' })
    platform.setItem('session', value)
    expect(shop.getItem('session')).toBe(value)
    expect(jar.values.size).toBeGreaterThan(2)
    expect(jar.writes.every((cookie) => cookie.length < 4096)).toBe(true)
    expect(jar.writes.every((cookie) => cookie.includes('; Domain=poeruum.ee; SameSite=Lax; Secure'))).toBe(true)
    shop.setItem('session', 'refreshed-session')
    expect(platform.getItem('session')).toBe('refreshed-session')
    expect([...jar.values.keys()]).toEqual(['session.0', 'session'])
  })

  it('migrates existing localStorage login and prevents stale sessions returning after logout elsewhere', () => {
    const jar = createJar()
    const oldPlatform = createLegacy()
    const oldShop = createLegacy()
    oldPlatform.values.set('session', 'previous-login')
    oldShop.values.set('session', 'stale-login')
    const platform = createSharedAuthStorage(new URL('https://poeruum.ee'), jar, oldPlatform)!
    const shop = createSharedAuthStorage(new URL('https://urgits.poeruum.ee'), jar, oldShop)!
    expect(platform.getItem('session')).toBe('previous-login')
    expect(oldPlatform.values.size).toBe(0)
    shop.removeItem('session')
    // An origin that has not yet run the new app must also discard its old login.
    oldPlatform.values.set('session', 'another-stale-login')
    expect(platform.getItem('session')).toBeNull()
    expect(shop.getItem('session')).toBeNull()
    expect(oldPlatform.values.size).toBe(0)
    expect(oldShop.values.size).toBe(0)
    expect([...jar.values.values()]).toEqual(['0'])
  })

  it('fails closed when a session chunk is missing or malformed', () => {
    const jar = createJar()
    const storage = createSharedAuthStorage(new URL('https://poeruum.ee'), jar, createLegacy())!
    storage.setItem('session', 'x'.repeat(5000))
    jar.values.delete('session.1')
    expect(storage.getItem('session')).toBeNull()
    jar.values.set('session.1', '%invalid')
    expect(storage.getItem('session')).toBeNull()
  })

  it.each(['https://poeruum.ee.example.com', 'https://minupood.ee', 'https://nested.urgits.poeruum.ee', 'http://localhost:4185'])(
    'keeps authentication isolated on %s', (origin) => {
      expect(createSharedAuthStorage(new URL(origin), createJar(), createLegacy())).toBeUndefined()
    },
  )
})
