import StoreDirectoryCardContent from './StoreDirectoryCardContent'

export default function StoreDirectorySettings({ storeName, logo, cover, productImage, description, storeDescription, published, visible, onVisibilityChange, onDescriptionChange, onCoverChange, onCoverRemove }: {
  storeName: string
  logo: string | null
  cover: string | null
  productImage?: string | null
  description: string
  storeDescription: string
  published: boolean
  visible: boolean
  onVisibilityChange: (value: boolean) => void
  onDescriptionChange: (value: string) => void
  onCoverChange: (file: File | undefined) => void
  onCoverRemove: () => void
}) {
  const image = cover || productImage || logo
  const previewDescription = (description.trim() || storeDescription).replace(/\s+/g, ' ').trim().slice(0, 140)
  return <div className="settings-panel settings-directory">
    <label className="settings-toggle settings-directory__visibility">
      <span><strong>Nähtav Kaubamajas</strong>{visible && !published && <small>Rakendub pärast poe avaldamist.</small>}</span>
      <input type="checkbox" role="switch" aria-label="Nähtav Kaubamajas" checked={visible} onChange={(event) => onVisibilityChange(event.target.checked)} /><i />
    </label>
    <div className="store-directory__card settings-directory__preview" aria-label="Poekaardi eelvaade">
      <StoreDirectoryCardContent store={{ name: storeName, description: previewDescription, imageUrl: image, logoUrl: logo }} mediaActions={<div className="settings-directory__cover-actions">
        <label className="settings-directory__upload" title={cover ? 'Vaheta kaanepilti' : 'Lisa kaanepilt'}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h4l2-3h4l2 3h4v13H4Z" /><circle cx="12" cy="13" r="4" /></svg>
          <span>{cover ? 'Vaheta pilti' : 'Lisa kaanepilt'}</span>
          <input type="file" accept="image/png,image/jpeg,image/webp" aria-label="Kaubamaja kaanepilt" onChange={(event) => { onCoverChange(event.target.files?.[0]); event.target.value = '' }} />
        </label>
        {cover && <button type="button" onClick={onCoverRemove} aria-label="Eemalda Kaubamaja kaanepilt" title="Eemalda kaanepilt"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" /></svg></button>}
      </div>} />
    </div>
    <a className="settings-directory__open" href="https://kaubamaja.poeruum.ee/" target="_blank" rel="noreferrer">Ava Kaubamaja <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M7 7h10v10" /></svg></a>
    <div className="settings-fields">
      <label>Lühitutvustus<textarea rows={3} maxLength={140} value={description} aria-label="Kaubamaja lühitutvustus" onChange={(event) => onDescriptionChange(event.target.value)} placeholder={storeDescription || 'Mida sinu poest leiab?'} /></label>
      <div className="settings-directory__field-meta"><span>{description.trim() ? '' : 'Vaikimisi poe tutvustus'}</span><span>{description.length}/140</span></div>
    </div>
    <details className="settings-disclosure"><summary>Nähtavus ja pildid <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg></summary><div>
      <p>Lüliti peidab Kaubamajast poe ja selle tooted. Poe enda aadress jääb avatuks. Kaubamajas kuvatakse ainult avaldatud poode.</p>
      <p>Kaanepildi puudumisel kasutame esimese otsingus nähtava toote pilti või poe logo. Kaanepilt: JPG, PNG või WebP.</p>
    </div></details>
  </div>
}
