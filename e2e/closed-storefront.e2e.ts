import { expect, test } from '@playwright/test'

test.use({ baseURL: 'http://poeruum.localhost:4174' })

for (const [theme, logo] of [['midnight', '/closed-logo.svg'], ['paper', '/closed-logo.svg'], ['pop', null], ['midnight', '/broken-logo.svg']] as const) {
  test(`hidden storefront uses ${theme} branding with ${logo ?? 'no logo'} and no products`, async ({ page }) => {
    let brandingRequests = 0
    let productRequests = 0
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.route('**/__e2e_supabase/**', async (route) => {
      const request = route.request()
      const path = new URL(request.url()).pathname
      let result: unknown = []
      if (path.endsWith('/rpc/closed_storefront_branding')) {
        if (request.method() !== 'OPTIONS') {
          brandingRequests += 1
          expect(request.postDataJSON()).toEqual({ requested_slug: 'hidden-shop', requested_hostname: null })
        }
        result = { name: 'Minu pood', logo, theme, accent: '#b99568' }
      }
      if (path.endsWith('/products')) productRequests += 1
      await route.fulfill({ status: 200, contentType: 'application/json', headers: {
        'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      }, body: JSON.stringify(result) })
    })
    await page.route('**/closed-logo.svg', (route) => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="112" height="112"><circle cx="56" cy="56" r="54" fill="#201e19"/><path d="m32 68 24-40 24 40Z" fill="#b99568"/></svg>' }))
    await page.route('**/broken-logo.svg', (route) => route.fulfill({ status: 404, body: '' }))
    for (const [path, width, height] of [
      ['/p/hidden-shop', 1440, 900], ['http://hidden-shop.poeruum.localhost:4174/toode/old-product/', 390, 844], ['/?store=hidden-shop', 320, 568],
    ] as const) {
      await page.setViewportSize({ width, height })
      await page.goto(path)
      const closed = page.locator('.closed-store')
      await expect(page.getByRole('heading', { name: 'Pood on hetkel suletud.', exact: true })).toBeVisible()
      await expect(closed).toHaveAttribute('data-store-theme', theme)
      await expect(closed).toHaveCSS('--closed-accent', '#b99568')
      await expect(page).toHaveTitle('Minu pood — Pood on hetkel suletud.')
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
      if (logo === '/closed-logo.svg') await expect(page.getByRole('img', { name: 'Minu pood' })).toBeVisible()
      else await expect(page.locator('.closed-store__brand')).toHaveText('Minu pood')
      await expect(page.locator('.app-shell')).toHaveCount(0)
      await expect(page.getByRole('button')).toHaveCount(0)
      await expect(page.getByText('Loodud Poeruumis')).toHaveCount(0)
      expect(await closed.evaluate((element) => {
        const bounds = element.getBoundingClientRect()
        return element.scrollWidth <= element.clientWidth && Math.abs(bounds.height - innerHeight) <= 1
      })).toBe(true)
      expect(productRequests).toBe(0)
    }
    expect(brandingRequests).toBeGreaterThanOrEqual(3)
  })
}
