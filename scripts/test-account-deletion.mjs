import { randomUUID } from 'node:crypto'
import process from 'node:process'
import { config } from 'dotenv'

config({ path: '.env', quiet: true })

const url = process.env.VITE_SUPABASE_URL?.replace(/\/$/, '')
const publicKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
const serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !publicKey || !serviceKey) {
  throw new Error('Konto kustutamise E2E jaoks puuduvad Supabase’i keskkonnamuutujad.')
}

const runId = randomUUID()
const email = `account-delete-e2e-${runId}@example.invalid`
const password = `Delete-E2E-${runId}!`
let userId = null
let storeId = null
let retainedStoreId = null
let retainedOrderId = null

const request = async (path, init, expected = [200]) => {
  const response = await fetch(`${url}${path}`, init)
  if (!expected.includes(response.status)) {
    const details = await response.text()
    throw new Error(`${path} vastas ${response.status}: ${details}`)
  }
  return response
}

const serviceHeaders = {
  apikey: serviceKey,
  authorization: `Bearer ${serviceKey}`,
  'content-type': 'application/json',
}

try {
  const createdUser = await request('/auth/v1/admin/users', {
    method: 'POST',
    headers: serviceHeaders,
    body: JSON.stringify({ email, password, email_confirm: true }),
  })
  userId = (await createdUser.json()).id

  const tokenResponse = await request('/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: serviceHeaders,
    body: JSON.stringify({ email, password }),
  })
  const { access_token: accessToken } = await tokenResponse.json()

  const storeResponse = await request('/rest/v1/stores', {
    method: 'POST',
    headers: { ...serviceHeaders, Prefer: 'return=representation' },
    body: JSON.stringify({
      owner_id: userId,
      name: 'Account deletion E2E',
      slug: `delete-e2e-${runId}`,
      settings: { businessName: 'Must be deleted', contactEmail: email },
    }),
  }, [201])
  storeId = (await storeResponse.json())[0].id

  const retainedStoreResponse = await request('/rest/v1/stores', {
    method: 'POST',
    headers: { ...serviceHeaders, Prefer: 'return=representation' },
    body: JSON.stringify({
      owner_id: userId,
      name: 'Account deletion retained E2E',
      slug: `delete-retained-e2e-${runId}`,
      settings: { businessName: 'Must be anonymized', contactEmail: email },
    }),
  }, [201])
  retainedStoreId = (await retainedStoreResponse.json())[0].id

  const retainedOrderResponse = await request('/rest/v1/orders', {
    method: 'POST',
    headers: { ...serviceHeaders, Prefer: 'return=representation' },
    body: JSON.stringify({
      store_id: retainedStoreId,
      order_number: `E2E-${runId}`,
      items: [{ name: 'Accounting record', quantity: 1, price: 1 }],
      customer_name: 'Synthetic Buyer',
      customer_email: email,
      delivery: 'pickup',
      product_subtotal: 1,
      total: 1,
    }),
  }, [201])
  retainedOrderId = (await retainedOrderResponse.json())[0].id

  await request('/rest/v1/products', {
    method: 'POST',
    headers: serviceHeaders,
    body: JSON.stringify({
      id: `delete-e2e-${runId}`,
      store_id: storeId,
      name: 'Must be deleted',
      image_url: 'https://example.invalid/deleted.png',
    }),
  }, [201])

  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
  await request(`/storage/v1/object/product-images/${storeId}/delete-e2e.png`, {
    method: 'POST',
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, 'content-type': 'image/png' },
    body: png,
  })
  await request(`/storage/v1/object/support-attachments/${userId}/delete-e2e.pdf`, {
    method: 'POST',
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/pdf' },
    body: Buffer.from('%PDF-1.4\n%%EOF'),
  })

  const deletion = await request('/functions/v1/delete-account', {
    method: 'POST',
    headers: {
      apikey: publicKey,
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ confirmation: 'KUSTUTA' }),
  })
  const result = await deletion.json()
  if (result.success !== true) throw new Error('Kustutusfunktsioon ei tagastanud success=true.')

  await request(`/auth/v1/admin/users/${userId}`, { headers: serviceHeaders }, [404])
  const stores = await request(`/rest/v1/stores?id=eq.${storeId}&select=id`, { headers: serviceHeaders })
  if ((await stores.json()).length !== 0) throw new Error('Sünteetiline pood jäi pärast konto kustutamist alles.')

  const retainedStores = await request(
    `/rest/v1/stores?id=eq.${retainedStoreId}&select=owner_id,name,slug,is_published,settings,deleted_at,stripe_account_id,stripe_customer_id,stripe_subscription_id`,
    { headers: serviceHeaders },
  )
  const retainedStore = (await retainedStores.json())[0]
  if (!retainedStore
    || retainedStore.owner_id !== null
    || retainedStore.name !== 'Kustutatud pood'
    || retainedStore.slug !== `deleted-${retainedStoreId}`
    || retainedStore.is_published !== false
    || Object.keys(retainedStore.settings ?? {}).length !== 0
    || !retainedStore.deleted_at
    || retainedStore.stripe_account_id !== null
    || retainedStore.stripe_customer_id !== null
    || retainedStore.stripe_subscription_id !== null
  ) {
    throw new Error('Tellimusega poe anonüümne tombstone ei vasta nõuetele.')
  }
  const retainedOrders = await request(
    `/rest/v1/orders?id=eq.${retainedOrderId}&select=id,customer_name,customer_email,delivery,retention_expires_at`,
    { headers: serviceHeaders },
  )
  const retainedOrder = (await retainedOrders.json())[0]
  if (!retainedOrder
    || retainedOrder.customer_name !== 'Kustutatud klient'
    || retainedOrder.customer_email !== `deleted+${retainedOrderId.replaceAll('-', '')}@invalid.poeruum.ee`
    || retainedOrder.delivery !== 'Tarneandmed eemaldatud konto kustutamisel'
    || !retainedOrder.retention_expires_at
  ) {
    throw new Error('Raamatupidamislik tellimus ei säilinud anonüümitud kujul.')
  }

  for (const [bucket, prefix] of [['product-images', storeId], ['support-attachments', userId]]) {
    const listed = await request(`/storage/v1/object/list/${bucket}`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({ prefix, limit: 10 }),
    })
    if ((await listed.json()).length !== 0) throw new Error(`${bucket} sisaldab pärast kustutamist faile.`)
  }

  console.log('Konto kustutamise E2E läbis: Auth, poe sisu ja failid eemaldati; tellimus anonüümiti ja säilis tähtajaga poe all.')
  userId = null
  storeId = null
} finally {
  if (userId) {
    await fetch(`${url}/auth/v1/admin/users/${userId}`, { method: 'DELETE', headers: serviceHeaders })
  }
  if (storeId) {
    await fetch(`${url}/rest/v1/stores?id=eq.${storeId}`, { method: 'DELETE', headers: serviceHeaders })
  }
  if (retainedOrderId) {
    await fetch(`${url}/rest/v1/orders?id=eq.${retainedOrderId}`, { method: 'DELETE', headers: serviceHeaders })
  }
  if (retainedStoreId) {
    await fetch(`${url}/rest/v1/stores?id=eq.${retainedStoreId}`, { method: 'DELETE', headers: serviceHeaders })
  }
}
