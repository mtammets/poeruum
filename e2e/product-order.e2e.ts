import { expect, test, type Page } from '@playwright/test'

test('new products lead immediately and after reloading; cancelling and editing keep existing products intact', async ({ page }) => {
  const storeId = 'c7190001-0000-4000-8000-000000000001'
  const user = { id: 'c7190000-0000-4000-8000-000000000001', email: 'order@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() }
  const expires = Math.floor(Date.now() / 1000) + 3600
  const token = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify({ sub: user.id, aud: 'authenticated', role: 'authenticated', exp: expires })).toString('base64url'), 'test'].join('.')
  const session = { access_token: token, refresh_token: 'test', token_type: 'bearer', expires_in: 3600, expires_at: expires, user }
  await page.addInitScript(value => localStorage.setItem('sb-localhost-auth-token', JSON.stringify(value)), session)
  const products: Record<string, any>[] = ['Vanem toode', 'Uuem toode'].map((name, index) => ({
    id: `existing-${index}`, store_id: storeId, name, alt: name, price: 20, search_visible: true, sort_order: 0,
    image_url: `http://localhost:4174/storage/v1/object/public/product-images/${storeId}/${index}.webp`,
    created_at: `2026-01-0${index + 1}T00:00:00Z`,
  }))
  await page.route('**/storage/v1/object/public/product-images/**', route => route.fulfill({ contentType: 'image/webp', path: 'public/images/kaubamaja-example-ceramics.webp' }))
  await page.route('**/__e2e_supabase/**', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.pathname.endsWith('/auth/v1/user')) return route.fulfill({ json: user })
    if (url.pathname.endsWith('/auth/v1/token')) return route.fulfill({ json: session })
    if (url.pathname.includes('/storage/v1/object/')) {
      if (request.method() === 'GET') return route.fulfill({ contentType: 'image/webp', path: 'public/images/kaubamaja-example-ceramics.webp' })
      return route.fulfill({ json: { Key: url.pathname.split('/storage/v1/object/')[1] } })
    }
    if (url.pathname.endsWith('/rest/v1/products')) {
      if (request.method() === 'POST') {
        const incoming = request.postDataJSON(), existing = products.find(product => product.id === incoming.id)
        if (existing) Object.assign(existing, incoming)
        else products.push({ ...incoming, sort_order: 0, created_at: new Date().toISOString() })
        return route.fulfill({ json: products.find(product => product.id === incoming.id) })
      }
      const order = (url.searchParams.get('order') || '').split(',').map(part => part.split('.'))
      return route.fulfill({ json: [...products].sort((a, b) => {
        for (const [key, direction] of order) {
          const result = a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0
          if (result) return direction === 'desc' ? -result : result
        }
        return 0
      }) })
    }
    return route.fulfill({ json: url.pathname.includes('/rpc/') || url.pathname.endsWith('/platform_settings') ? null : [] })
  })
  const open = async () => {
    await page.goto('http://localhost:4174/')
    const loaded = page.waitForResponse(response => response.url().includes('/rest/v1/products'))
    await page.evaluate(async () => { const { mountProductOrderHarness } = await import('/e2e/product-order-harness.tsx'); mountProductOrderHarness() })
    await loaded
  }
  const heading = page.locator('.product-details h1')
  await open()
  await expect(heading).toHaveText('Uuem toode')
  await page.getByRole('button', { name: 'Toode 2', exact: true }).click()
  await expect(heading).toHaveText('Vanem toode')
  await uploadDraft(page)
  await page.getByRole('button', { name: 'Loobu muudatustest' }).click()
  await expect(heading).toHaveText('Uuem toode')
  expect(products).toHaveLength(2)
  for (const name of ['Uus toode', 'Kõige uuem toode']) {
    await uploadDraft(page)
    await page.getByRole('textbox', { name: 'Toote nimi', exact: true }).fill(name)
    await page.getByRole('textbox', { name: 'Toote tavahind' }).fill('25')
    await page.getByRole('button', { name: 'Salvesta muudatused' }).click()
    await expect(page.getByRole('button', { name: 'Muuda toodet' })).toBeVisible()
    await expect(heading).toHaveText(name)
    await expect(page.getByRole('button', { name: 'Toode 1', exact: true })).toHaveClass('is-active')
  }
  await page.getByRole('button', { name: 'Toode 4', exact: true }).click()
  await expect(heading).toHaveText('Vanem toode')
  await page.getByRole('button', { name: 'Muuda toodet' }).click()
  await page.getByRole('textbox', { name: 'Toote nimi', exact: true }).fill('Muudetud vanem toode')
  await page.getByRole('button', { name: 'Salvesta muudatused' }).click()
  await expect(page.getByRole('button', { name: 'Toode 4', exact: true })).toHaveClass('is-active')
  expect(products).toHaveLength(4)
  expect(products.find(product => product.id === 'existing-0')?.created_at).toBe('2026-01-01T00:00:00Z')
  await open()
  await expect(heading).toHaveText('Kõige uuem toode')
  await page.getByRole('button', { name: 'Toode 2', exact: true }).click()
  await expect(heading).toHaveText('Uus toode')
  await page.getByRole('button', { name: 'Toode 4', exact: true }).click()
  await expect(heading).toHaveText('Muudetud vanem toode')
})

async function uploadDraft(page: Page) {
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Lisa toode', exact: true }).click()
  await (await chooser).setFiles('public/images/kaubamaja-example-ceramics.webp')
  await expect(page.getByRole('textbox', { name: 'Toote nimi', exact: true })).toBeVisible()
}
