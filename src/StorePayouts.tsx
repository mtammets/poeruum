import { useEffect, useState } from 'react'
import { loadConnectAndInitialize, type StripeConnectInstance } from '@stripe/connect-js'
import { ConnectComponentsProvider, ConnectPayouts } from '@stripe/react-connect-js'
import { createPayoutSession } from './lib/payouts'

export default function StorePayouts({ storeId }: { storeId: string }) {
  const [attempt, setAttempt] = useState(0)
  const [connection, setConnection] = useState<StripeConnectInstance | null>(null)
  const [dashboardUrl, setDashboardUrl] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    let instance: StripeConnectInstance | null = null
    const open = async () => {
      try {
        const session = await createPayoutSession(storeId)
        if (!active) return
        if (session.kind === 'dashboard') { setDashboardUrl(session.dashboardUrl); setLoading(false); return }
        const publishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY?.trim()
        if (!publishableKey?.startsWith(`pk_${session.mode}_`)) throw new Error('Stripe’i ühendus vajab uuendamist. Võta ühendust toega.')
        let firstSecret: string | null = session.clientSecret
        instance = loadConnectAndInitialize({
          publishableKey, locale: 'et-EE',
          fetchClientSecret: async () => {
            if (!active) throw new Error('Väljamaksete vaade on suletud.')
            if (firstSecret) { const secret = firstSecret; firstSecret = null; return secret }
            const renewed = await createPayoutSession(storeId)
            if (!active || renewed.kind !== 'embedded' || renewed.mode !== session.mode) throw new Error('Ava väljamaksete vaade uuesti.')
            return renewed.clientSecret
          },
          appearance: {
            overlays: 'dialog',
            variables: {
              colorPrimary: '#e5f25a', colorBackground: '#11130f', colorText: '#f5f6ef',
              colorSecondaryText: '#a4aa9e', colorBorder: '#34372f', colorDanger: '#ffaba3',
              formBackgroundColor: '#181b16', formAccentColor: '#e5f25a',
              buttonPrimaryColorBackground: '#e5f25a', buttonPrimaryColorBorder: '#e5f25a', buttonPrimaryColorText: '#171b0b',
              buttonSecondaryColorBackground: '#181b16', buttonSecondaryColorText: '#f5f6ef',
              fontFamily: 'Manrope, system-ui, sans-serif', fontSizeBase: '14px',
              headingXlFontSize: '22px', headingLgFontSize: '20px', headingMdFontSize: '17px',
              borderRadius: '10px', spacingUnit: '8px',
            },
          },
        })
        setConnection(instance)
        setLoading(false)
      } catch (cause) {
        if (active) { setError(cause instanceof Error ? cause.message : 'Väljamaksete laadimine ebaõnnestus.'); setLoading(false) }
      }
    }
    void open()
    return () => { active = false; void instance?.logout().catch(() => undefined) }
  }, [storeId, attempt])

  return <div className="settings-payouts">
    {loading && <p className="settings-intro" role="status">Laadin väljamakseid…</p>}
    {error ? <div className="settings-payouts__error" role="alert"><p>{error}</p><button className="settings-secondary-action" type="button" onClick={() => {
      setConnection(null); setError(''); setDashboardUrl(''); setLoading(true); setAttempt(value => value + 1)
    }}>Proovi uuesti</button></div>
      : dashboardUrl ? <a className="settings-secondary-action" href={dashboardUrl} target="_blank" rel="noopener noreferrer">Ava väljamaksed Stripe’is ↗</a>
        : connection && <ConnectComponentsProvider connectInstance={connection}><ConnectPayouts onLoadError={() => setError('Stripe’i väljamaksevaate laadimine ebaõnnestus. Proovi uuesti.')} /></ConnectComponentsProvider>}
    {!loading && !error && <details className="settings-payouts__help"><summary>Millal raha pangakontole jõuab?</summary><p>Automaatne graafik määrab, millal vabanenud raha pangakontole saadetakse. Raha vabanemise aja määrab Stripe. Kiirväljamakse korral kuvatakse tasu enne kinnitamist.</p></details>}
  </div>
}
