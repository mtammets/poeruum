import { useEffect, useState } from 'react'
import { loadConnectAndInitialize } from '@stripe/connect-js'
import { ConnectAccountOnboarding, ConnectComponentsProvider } from '@stripe/react-connect-js'
import { invokeStripeConnect } from './lib/database'

type Props = {
  onExit: () => Promise<void>
  onClose: () => Promise<void>
  onError: (message: string) => void
}

const stripePublishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY?.trim()
const isStripeTestMode = stripePublishableKey?.startsWith('pk_test_') === true

export default function StripeEmbeddedOnboarding({ onExit, onClose, onError }: Props) {
  const [loadPhase, setLoadPhase] = useState<'connecting' | 'loading' | 'ready' | 'error'>('connecting')
  const [isClosing, setIsClosing] = useState(false)
  const [isCompleting, setIsCompleting] = useState(false)
  const [renderAttempt, setRenderAttempt] = useState(0)
  const [connectInstance] = useState(() => stripePublishableKey ? loadConnectAndInitialize({
    publishableKey: stripePublishableKey,
    locale: 'et-EE',
    appearance: {
      overlays: 'drawer',
      variables: {
        colorPrimary: '#226748',
        colorBackground: '#ffffff',
        colorText: '#14261c',
        colorSecondaryText: '#66736b',
        colorBorder: '#d7ded7',
        colorDanger: '#a4433b',
        formBackgroundColor: '#fcfdfb',
        formHighlightColorBorder: '#226748',
        formAccentColor: '#226748',
        formPlaceholderTextColor: '#7b857e',
        buttonPrimaryColorBackground: '#226748',
        buttonPrimaryColorBorder: '#226748',
        buttonPrimaryColorText: '#ffffff',
        buttonLabelFontSize: '13px',
        buttonLabelFontWeight: '700',
        buttonPaddingX: '12px',
        buttonPaddingY: '10px',
        inputFieldPaddingX: '10px',
        inputFieldPaddingY: '10px',
        fontSizeBase: '13px',
        bodyMdFontSize: '13px',
        bodySmFontSize: '12px',
        headingXlFontSize: '22px',
        headingLgFontSize: '18px',
        headingMdFontSize: '16px',
        headingSmFontSize: '15px',
        labelMdFontSize: '13px',
        labelMdFontWeight: '700',
        labelSmFontSize: '11px',
        borderRadius: '12px',
        formBorderRadius: '10px',
        buttonBorderRadius: '10px',
        fontFamily: 'DM Sans, system-ui, sans-serif',
        spacingUnit: '6px',
      },
    },
    fetchClientSecret: async () => {
      const result = await invokeStripeConnect('start')
      if (!result.clientSecret) throw new Error('Stripe ei tagastanud AccountSessioni võtit.')
      return result.clientSecret
    },
  }) : null)

  useEffect(() => {
    if (!connectInstance) onError('Stripe’i publishable key puudub.')
  }, [connectInstance, onError])

  useEffect(() => {
    if (loadPhase !== 'loading') return
    const fallback = window.setTimeout(() => setLoadPhase('ready'), 8000)
    return () => window.clearTimeout(fallback)
  }, [loadPhase])

  const closeStripeForm = async () => {
    if (isClosing) return
    setIsClosing(true)
    try {
      await onClose()
    } finally {
      setIsClosing(false)
    }
  }

  const retryStripeForm = () => {
    onError('')
    setLoadPhase('connecting')
    setRenderAttempt((attempt) => attempt + 1)
  }

  const completeStripeForm = async () => {
    if (isCompleting) return
    setIsCompleting(true)
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }))
    try {
      await onExit()
    } finally {
      setIsCompleting(false)
    }
  }

  if (!connectInstance) return null
  return <section className="stripe-embedded" aria-label="Stripe’i konto seadistamine">
    <header><div><i className="provider-logo provider-logo--stripe"><img src="/images/stripe-wordmark.svg" alt="" /></i><span><strong>Stripe’i konto seadistamine</strong><small>Maksete vastuvõtt{isStripeTestMode ? ' · Testkeskkond' : ''}</small></span></div><aside><button type="button" disabled={isClosing} onClick={() => void closeStripeForm()}>{isClosing && <i aria-hidden="true" />}<span>{isClosing ? 'Sulgen…' : 'Sulge'}</span></button></aside></header>
    <div className={`stripe-embedded__component is-${loadPhase}${isCompleting ? ' is-completing' : ''}`}>
      {isCompleting && <div className="stripe-completing" role="status" aria-live="polite">
        <span aria-hidden="true" />
        <h2>Kontrollime maksete valmisolekut</h2>
        <p>Stripe salvestas andmed. Hetk palun…</p>
      </div>}
      {loadPhase !== 'ready' && <div className={`stripe-preparing${loadPhase === 'error' ? ' is-error' : ''}`} aria-live="polite">
        {loadPhase === 'error' ? <>
          <span className="stripe-preparing__error" aria-hidden="true">!</span>
          <h2>Vormi ei õnnestunud avada</h2>
          <p>Stripe’i vormi laadimine võttis liiga kaua.</p>
          <button type="button" onClick={retryStripeForm}>Proovi uuesti</button>
        </> : <>
          <span className="stripe-preparing__loader" aria-hidden="true"><i /></span>
          <h2>{loadPhase === 'connecting' ? 'Ühendame Stripe’iga' : 'Avame Stripe’i vormi'}</h2>
          <p>Hetk palun…</p>
        </>}
      </div>}
      <ConnectComponentsProvider connectInstance={connectInstance}>
        <ConnectAccountOnboarding
          key={renderAttempt}
          collectionOptions={{ fields: 'eventually_due', futureRequirements: 'include' }}
          onExit={() => void completeStripeForm()}
          onLoaderStart={() => setLoadPhase((current) => current === 'connecting' ? 'loading' : current)}
          onStepChange={() => {
            onError('')
            setLoadPhase('ready')
          }}
          onLoadError={() => {
            setLoadPhase('error')
            onError('Stripe’i vormi avamine ebaõnnestus. Proovi uuesti.')
          }}
        />
      </ConnectComponentsProvider>
    </div>
  </section>
}
