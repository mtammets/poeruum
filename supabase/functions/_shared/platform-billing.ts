import type Stripe from 'npm:stripe@^22'
import type { InvoiceBuyer } from '../../../shared/order-invoice.ts'
import { PLATFORM_BUSINESS } from '../../../shared/platform-business.mjs'

export async function platformAccountTaxId(stripe: Stripe) {
  const account = await stripe.accounts.retrieve(null)
  const defaults = (account.settings?.invoices?.default_account_tax_ids ?? []).map((item) => typeof item === 'string' ? item : item.id)
  for await (const taxId of stripe.taxIds.list({ limit: 100 })) {
    if (taxId.owner?.type === 'self' && taxId.type === 'eu_vat' && taxId.value === PLATFORM_BUSINESS.vatNumber && defaults.includes(taxId.id)) return taxId.id
  }
  throw new Error('Poeruumi KMKR number puudub Stripe’i vaikimisi arveandmetest.')
}

export async function syncBillingCustomer(stripe: Stripe, input: {
  storeId: string; customerId: string | null; buyer: InvoiceBuyer; mode: 'test' | 'live'
}) {
  const { buyer } = input
  const values: Stripe.CustomerUpdateParams = {
    name: buyer.name, email: buyer.email,
    address: { country: 'EE', line1: buyer.address },
    tax_exempt: 'none',
    invoice_settings: {
      custom_fields: buyer.registryCode ? [{ name: 'Registrikood', value: buyer.registryCode }] : [],
      footer: platformInvoiceFooter(),
    },
    metadata: { store_id: input.storeId, stripe_mode: input.mode },
  }
  const customer = input.customerId
    ? await stripe.customers.update(input.customerId, values)
    : await stripe.customers.create({ metadata: { store_id: input.storeId, stripe_mode: input.mode } }, { idempotencyKey: `poeruum-billing-customer-${input.mode}-${input.storeId}` })
  // A creation retry can return the original response after the merchant has
  // edited their billing identity. Synchronize the current data explicitly.
  if (!input.customerId) await stripe.customers.update(customer.id, values)
  let found = false
  for await (const tax of stripe.customers.listTaxIds(customer.id, { limit: 100 })) {
    if (tax.type !== 'eu_vat') continue
    if (buyer.vatNumber && tax.value === buyer.vatNumber) found = true
    else await stripe.customers.deleteTaxId(customer.id, tax.id)
  }
  if (buyer.vatNumber && !found) await stripe.customers.createTaxId(customer.id, { type: 'eu_vat', value: buyer.vatNumber })
  return customer.id
}

export const platformInvoiceFooter = () => `${PLATFORM_BUSINESS.name} · Registrikood ${PLATFORM_BUSINESS.registryCode} · KMKR ${PLATFORM_BUSINESS.vatNumber}\n${PLATFORM_BUSINESS.address}\n${PLATFORM_BUSINESS.email}`

export async function prepareSubscriptionInvoice(stripe: Stripe, input: {
  invoiceId: string; storeId: string; customerId: string; buyer: InvoiceBuyer; mode: 'test' | 'live'
}) {
  // A delayed invoice.created event must not change already finalised invoices.
  const invoice = await stripe.invoices.retrieve(input.invoiceId)
  if (invoice.status !== 'draft') return
  const customer = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id
  if (customer !== input.customerId || invoice.livemode !== (input.mode === 'live')) throw new Error('Subscription invoice identity mismatch')
  const taxId = await platformAccountTaxId(stripe)
  await syncBillingCustomer(stripe, input)
  await stripe.invoices.update(invoice.id, {
    account_tax_ids: [taxId], footer: platformInvoiceFooter(),
    custom_fields: input.buyer.registryCode ? [{ name: 'Registrikood', value: input.buyer.registryCode }] : [],
  })
}
