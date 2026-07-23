import { createClient } from 'npm:@supabase/supabase-js@2'
import Stripe from 'npm:stripe@^22'
import { assertStoredStripeMode, assertStripeMode } from '../_shared/stripe-mode.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
})

const requiredEnv = (name: string) => {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Puudub ${name}.`)
  return value
}

type CheckoutItem = { id: string; quantity: number; selectedOptions?: Record<string, string> }
type DeliveryInput = { type: 'parcel' | 'courier' | 'pickup'; provider?: 'omniva' | 'dpd' | 'smartposti'; label: string }
type CheckoutBody = {
  storeId?: string
  checkoutRequestId?: string
  returnUrl?: string
  items?: CheckoutItem[]
  customer?: { name?: string; email?: string; phone?: string }
  delivery?: DeliveryInput
}

const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {}
const moneyToCents = (value: unknown) => Math.max(0, Math.round(Number(value ?? 0) * 100))
const VAT_RATE = 0.24
const PLATFORM_FEE_RATE = 0.04
const PLATFORM_FEE_NET_CAP_CENTS = 3900
const storefrontRootDomain = (configured: string) => (Deno.env.get('STOREFRONT_ROOT_DOMAIN')?.trim()
  || new URL(configured).hostname.replace(/^www\./, '')).toLowerCase().replace(/^\.+|\.+$/g, '')

const returnBase = (
  configured: string,
  requested: string | undefined,
  testMode: boolean,
  storeSlug: string,
  customHostname?: string,
) => {
  try {
    if (customHostname) return `https://${customHostname}`
    if (testMode && requested) {
      const url = new URL(requested)
      const isPrivateTestHost = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
        || /^10\./.test(url.hostname) || /^192\.168\./.test(url.hostname)
        || /^172\.(1[6-9]|2\d|3[01])\./.test(url.hostname)
      if (isPrivateTestHost) return url.origin
    }
    if (requested) {
      const url = new URL(requested)
      const isStorefrontHost = url.protocol === 'https:'
        && url.hostname === `${storeSlug}.${storefrontRootDomain(configured)}`
      if (isStorefrontHost || url.origin === new URL(configured).origin) return url.origin
    }
    return configured
  } catch { return configured }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const body = await request.json() as CheckoutBody
    const storeId = String(body.storeId ?? '')
    const checkoutRequestId = String(body.checkoutRequestId ?? '').trim()
    const requestedItems = Array.isArray(body.items) ? body.items.slice(0, 50) : []
    const email = String(body.customer?.email ?? '').trim().toLowerCase()
    const customerName = String(body.customer?.name ?? '').trim()
    const customerPhone = String(body.customer?.phone ?? '').trim()
    if (!storeId || checkoutRequestId.length < 16 || checkoutRequestId.length > 100 || !requestedItems.length || !email || !customerName || !body.delivery) {
      return json({ error: 'Tellimuse andmed on puudulikud.' }, 400)
    }

    const admin = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('POERUUM_SUPABASE_SECRET_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const stripeSecretKey = requiredEnv('STRIPE_SECRET_KEY')
    const stripeMode = assertStripeMode(stripeSecretKey)
    const stripe = new Stripe(stripeSecretKey)
    const { data: store, error: storeError } = await admin.from('stores').select('*').eq('id', storeId).eq('is_published', true).maybeSingle()
    if (storeError) throw storeError
    if (!store) return json({ error: 'Poodi ei leitud või see pole avalik.' }, 404)
    if (store.payment_provider !== 'stripe' || store.payment_status !== 'connected' || !store.stripe_account_id) {
      return json({ error: 'Selle poe Stripe’i maksed pole veel aktiivsed.' }, 409)
    }
    assertStoredStripeMode(store.stripe_account_mode, stripeMode, 'Poe Stripe’i konto')
    if (!store.stripe_account_mode) {
      const { error: modeUpdateError } = await admin.from('stores').update({ stripe_account_mode: stripeMode }).eq('id', storeId).is('stripe_account_mode', null)
      if (modeUpdateError) throw modeUpdateError
    }

    const { data: customDomain, error: customDomainError } = await admin.from('custom_domains')
      .select('hostname')
      .eq('store_id', storeId)
      .eq('status', 'active')
      .maybeSingle()
    if (customDomainError) throw customDomainError

    const uniqueProductIds = [...new Set(requestedItems.map((item) => String(item.id)))]
    const { data: products, error: productsError } = await admin.from('products').select('*').eq('store_id', storeId).in('id', uniqueProductIds)
    if (productsError) throw productsError
    const productsById = new Map((products ?? []).map((product) => [String(product.id), product]))
    const orderItems: Record<string, unknown>[] = []
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = []
    let productSubtotalCents = 0

    for (const requested of requestedItems) {
      const product = productsById.get(String(requested.id))
      const quantity = Math.max(1, Math.min(99, Math.floor(Number(requested.quantity))))
      if (!product || !Number.isFinite(quantity)) return json({ error: 'Üks tellitud toode pole enam saadaval.' }, 409)
      const stockLimit = product.one_of_a_kind ? 1 : product.stock == null ? 99 : Number(product.stock)
      if (quantity > stockLimit) return json({ error: `${product.name}: soovitud kogus pole saadaval.` }, 409)
      const regularPrice = Number(product.price ?? 0)
      const salePrice = product.sale_price == null ? null : Number(product.sale_price)
      const unitAmount = moneyToCents(salePrice != null && salePrice < regularPrice ? salePrice : regularPrice)
      if (!unitAmount) return json({ error: `${product.name}: toote hind pole korrektne.` }, 409)
      const requestedOptions = asRecord(requested.selectedOptions)
      const selectedOptions: Record<string, string> = {}
      const optionDefinitions = Array.isArray(product.options) ? product.options : []
      for (const definitionValue of optionDefinitions) {
        const definition = asRecord(definitionValue)
        const optionName = String(definition.name ?? '')
        const allowedValues = Array.isArray(definition.values) ? definition.values.map(String) : []
        const selectedValue = String(requestedOptions[optionName] ?? '')
        if (!optionName || !allowedValues.includes(selectedValue)) return json({ error: `${product.name}: toote valik pole korrektne.` }, 409)
        selectedOptions[optionName] = selectedValue
      }
      const optionText = Object.entries(selectedOptions).map(([name, value]) => `${name}: ${String(value)}`).join(', ')
      productSubtotalCents += unitAmount * quantity
      lineItems.push({
        quantity,
        price_data: {
          currency: 'eur',
          unit_amount: unitAmount,
          product_data: { name: String(product.name), description: optionText || undefined, metadata: { product_id: String(product.id) } },
        },
      })
      orderItems.push({
        id: String(product.id), name: String(product.name), image: String(product.image_url), gallery: product.gallery,
        alt: String(product.alt ?? product.name), description: String(product.description ?? ''), price: regularPrice,
        salePrice: salePrice ?? undefined, quantity, selectedOptions, cartKey: `${product.id}:${optionText}`,
      })
    }

    const settings = asRecord(store.settings)
    const sellerVatRegistered = settings.vatRegistered === true
    const sellerVatNumber = String(settings.vatNumber ?? '').trim().toUpperCase()
    if (sellerVatRegistered && !/^EE[0-9]{9}$/.test(sellerVatNumber)) {
      return json({ error: 'Poe käibemaksukohustuslase number puudub või on vigane.' }, 409)
    }
    const deliverySettings = asRecord(settings.deliverySettings)
    const parcelProviders = asRecord(deliverySettings.parcelProviders)
    let deliveryCents = 0
    if (body.delivery.type === 'parcel') {
      const provider = String(body.delivery.provider ?? '')
      const providerSettings = asRecord(parcelProviders[provider])
      if (!provider || providerSettings.enabled !== true) return json({ error: 'Valitud pakiautomaadi tarne pole enam saadaval.' }, 409)
      deliveryCents = moneyToCents(providerSettings.price)
    } else if (body.delivery.type === 'courier') {
      if (deliverySettings.courierEnabled !== true) return json({ error: 'Kullerteenus pole enam saadaval.' }, 409)
      deliveryCents = moneyToCents(deliverySettings.courierPrice)
    } else if (body.delivery.type === 'pickup') {
      if (deliverySettings.pickupEnabled !== true) return json({ error: 'Järeletulemine pole enam saadaval.' }, 409)
    }
    const freeShippingFromCents = moneyToCents(deliverySettings.freeShippingFrom)
    if (freeShippingFromCents > 0 && productSubtotalCents >= freeShippingFromCents) deliveryCents = 0
    if (deliveryCents > 0) lineItems.push({
      quantity: 1,
      price_data: { currency: 'eur', unit_amount: deliveryCents, product_data: { name: 'Tarne', description: body.delivery.label } },
    })

    let applicationFeeNetCents = 0
    let applicationFeeVatCents = 0
    let applicationFeeCents = 0
    if (store.pricing_plan === 'flexible') {
      const monthStart = new Date()
      monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0)
      const { data: fees, error: feeError } = await admin.from('revenue_events').select('amount_cents,kind,metadata')
        .eq('store_id', storeId).gte('occurred_at', monthStart.toISOString()).in('kind', ['transaction_fee', 'transaction_fee_refund'])
      if (feeError) throw feeError
      const collectedNetThisMonth = (fees ?? []).reduce((sum, fee) => {
        const metadata = asRecord(fee.metadata)
        const recordedNet = Number(metadata.net_amount_cents)
        return sum + (Number.isFinite(recordedNet) ? recordedNet : Number(fee.amount_cents))
      }, 0)
      applicationFeeNetCents = Math.min(
        Math.round(productSubtotalCents * PLATFORM_FEE_RATE),
        Math.max(0, PLATFORM_FEE_NET_CAP_CENTS - collectedNetThisMonth),
      )
      applicationFeeVatCents = Math.round(applicationFeeNetCents * VAT_RATE)
      applicationFeeCents = applicationFeeNetCents + applicationFeeVatCents
    }

    const orderNumber = `PR-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`
    const totalCents = productSubtotalCents + deliveryCents
    const reservationExpiresAt = new Date(Date.now() + 35 * 60 * 1000).toISOString()
    const { data: order, error: orderError } = await admin.rpc('create_stripe_order_with_reservation', {
      target_store_id: storeId,
      request_id: checkoutRequestId,
      order_number_value: orderNumber,
      order_items: orderItems,
      customer_name_value: customerName,
      customer_email_value: email,
      delivery_value: body.delivery.label,
      product_subtotal_value: productSubtotalCents / 100,
      total_value: totalCents / 100,
      stripe_mode_value: stripeMode,
      reservation_expires_at_value: reservationExpiresAt,
    })
    if (orderError) {
      if (orderError.message.includes('INSUFFICIENT_STOCK:')) {
        return json({ error: `${orderError.message.split('INSUFFICIENT_STOCK:')[1]?.split(/[\n(]/)[0] ?? 'Toode'}: soovitud kogus pole enam saadaval.` }, 409)
      }
      if (orderError.message.includes('CHECKOUT_REQUEST_REUSED')) return json({ error: 'Maksepäringu andmed muutusid. Proovi uuesti.' }, 409)
      throw orderError
    }
    const sellerVatAmount = sellerVatRegistered ? Math.round(totalCents * VAT_RATE / (1 + VAT_RATE)) / 100 : 0
    const { error: vatSnapshotError } = await admin.from('orders').update({
      seller_vat_registered: sellerVatRegistered,
      seller_vat_number: sellerVatRegistered ? sellerVatNumber : null,
      seller_vat_rate: sellerVatRegistered ? VAT_RATE * 100 : null,
      seller_vat_amount: sellerVatAmount,
      stripe_platform_fee_net_cents: applicationFeeNetCents,
      stripe_platform_fee_vat_cents: applicationFeeVatCents,
    }).eq('id', order.id)
    if (vatSnapshotError) {
      await admin.rpc('release_stripe_order', { target_order_id: order.id })
      throw vatSnapshotError
    }

    if (order.stripe_checkout_session_id) {
      const existingSession = await stripe.checkout.sessions.retrieve(order.stripe_checkout_session_id)
      if (existingSession.status === 'open' && existingSession.url) return json({ url: existingSession.url })
    }

    const configuredAppUrl = requiredEnv('APP_URL').replace(/\/$/, '')
    const appUrl = returnBase(
      configuredAppUrl,
      body.returnUrl,
      stripeSecretKey.includes('_test_'),
      store.slug,
      customDomain?.hostname,
    )
    const returnsToStoreSubdomain = new URL(appUrl).hostname === `${store.slug}.${storefrontRootDomain(configuredAppUrl)}`
    const returnsToCustomDomain = customDomain?.hostname === new URL(appUrl).hostname
    const storefrontPath = returnsToStoreSubdomain || returnsToCustomDomain ? '' : `/p/${encodeURIComponent(store.slug)}`
    const paymentIntentData: Stripe.Checkout.SessionCreateParams.PaymentIntentData = {
      on_behalf_of: store.stripe_account_id,
      transfer_group: `order_${order.id}`,
      metadata: {
        store_id: storeId,
        order_id: order.id,
        order_number: order.order_number,
        stripe_mode: stripeMode,
        platform_fee_cents: String(applicationFeeCents),
        platform_fee_net_cents: String(applicationFeeNetCents),
        platform_fee_vat_cents: String(applicationFeeVatCents),
        seller_account_id: store.stripe_account_id,
      },
    }

    let session: Stripe.Checkout.Session
    try {
      session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer_email: email,
        client_reference_id: storeId,
        line_items: lineItems,
        success_url: `${appUrl}${storefrontPath}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${appUrl}${storefrontPath}?checkout=cancelled`,
        expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
        metadata: {
          store_id: storeId,
          order_id: order.id,
          order_number: order.order_number,
          customer_phone: customerPhone,
          stripe_mode: stripeMode,
          platform_fee_cents: String(applicationFeeCents),
          platform_fee_net_cents: String(applicationFeeNetCents),
          platform_fee_vat_cents: String(applicationFeeVatCents),
          seller_account_id: store.stripe_account_id,
        },
        payment_intent_data: paymentIntentData,
      }, { idempotencyKey: `poeruum-checkout-${storeId}-${checkoutRequestId}` })
    } catch (error) {
      await admin.rpc('release_stripe_order', { target_order_id: order.id })
      throw error
    }
    await admin.from('orders').update({ stripe_checkout_session_id: session.id }).eq('id', order.id)
    if (!session.url) throw new Error('Stripe ei tagastanud makselehe aadressi.')
    return json({ url: session.url })
  } catch (error) {
    console.error('Stripe poe makse algatamine ebaõnnestus.', error)
    return json({ error: error instanceof Error ? error.message : 'Makse algatamine ebaõnnestus.' }, 500)
  }
})
