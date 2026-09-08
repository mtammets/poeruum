import { useEffect, useRef, useState } from 'react'
import { generateProductDescription } from './lib/productDescription'

type ProductDetails = { name: string; description: string }

export default function ProductDescriptionGenerator({ storeId, imageUrl, disabled, getDetails, onGenerated, onNotice, onBusyChange }: {
  storeId: string
  imageUrl: string
  disabled?: boolean
  getDetails: () => ProductDetails
  onGenerated: (description: string) => void
  onNotice: (message: string) => void
  onBusyChange: (busy: boolean) => void
}) {
  const [busy, setBusy] = useState(false)
  const [previousDescription, setPreviousDescription] = useState<string | null>(null)
  const request = useRef<AbortController | null>(null)

  useEffect(() => () => { request.current?.abort(); onBusyChange(false) }, [onBusyChange])

  const generate = async () => {
    if (request.current || disabled) return
    const details = getDetails()
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    onBusyChange(true)
    try {
      const description = await generateProductDescription({ storeId, imageUrl, ...details }, controller.signal)
      if (controller.signal.aborted) return
      const current = getDetails()
      if (current.name !== details.name || current.description !== details.description) {
        onNotice('Tekst muutus vahepeal. Proovi uuesti.')
        return
      }
      setPreviousDescription(details.description)
      onGenerated(description)
      onNotice('Mustand valmis. Vaata tekst üle.')
    } catch (error) {
      if (!controller.signal.aborted) onNotice(error instanceof Error ? error.message : 'Kirjelduse loomine ebaõnnestus.')
    } finally {
      if (!controller.signal.aborted) { request.current = null; setBusy(false); onBusyChange(false) }
    }
  }

  return <div className="product-description-generator">
    {previousDescription !== null && <button type="button" disabled={busy} onClick={() => {
      onGenerated(previousDescription)
      setPreviousDescription(null)
      onNotice('Eelmine kirjeldus taastatud.')
    }}>Taasta eelmine</button>}
    <button type="button" onClick={generate} disabled={disabled || busy || !imageUrl} aria-busy={busy}
      title="Koosta valitud tootepildi ja toote andmete põhjal kirjelduse mustand">
      {busy ? 'Genereerin…' : 'Genereeri kirjeldus'}
    </button>
  </div>
}
