import { useEffect, useRef, useState } from 'react'
import { BusinessCardEditor } from './businessCard/BusinessCardEditor'
import { createDefaultCard, type CardDocument } from './businessCard/model'
import { CardDraftConflictError, loadCloudCardDraft, loadLocalCardDraft, saveCloudCardDraft, saveLocalCardDraft, type CloudCardDraft } from './businessCard/storage'

export { BusinessCardEditor } from './businessCard/BusinessCardEditor'

export default function AdminBusinessCard({ userId }: { userId: string }) {
  const [initialDocument, setInitialDocument] = useState<CardDocument | null>(null)
  const [editorKey, setEditorKey] = useState(0)
  const [status, setStatus] = useState('Avan…')
  const [notice, setNotice] = useState('')
  const [localError, setLocalError] = useState('')
  const [conflict, setConflict] = useState<CloudCardDraft | null>(null)
  const latest = useRef<CardDocument | null>(null)
  const localSaved = useRef<CardDocument | null>(null)
  const revision = useRef<number | null>(null)
  const cloudKnown = useRef(false)
  const dirty = useRef(false)
  const blocked = useRef(false)
  const saving = useRef(false)
  const mounted = useRef(true)
  const timer = useRef<number | undefined>(undefined)
  const queue = useRef<Promise<void>>(Promise.resolve())
  const operations = useRef({ save: async () => {}, retry: async () => {} })

  const saveLocal = (document: CardDocument, isDirty: boolean) => {
    const draft = { document, baseRevision: revision.current, updatedAt: new Date().toISOString(), dirty: isDirty }
    queue.current = queue.current.catch(() => {}).then(() => saveLocalCardDraft(userId, draft)).then(() => {
      localSaved.current = document
      if (mounted.current) setLocalError('')
    }).catch((cause: unknown) => {
      if (mounted.current) setLocalError(cause instanceof Error ? cause.message : 'Brauseri mustandit ei saanud salvestada.')
      throw cause
    })
    // Keep the queue recoverable and the caller's rejection handled.
    return queue.current.catch(() => {})
  }

  const scheduleSave = () => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => { void operations.current.save() }, 1000)
  }

  const save = async () => {
    if (!latest.current || !dirty.current || saving.current || blocked.current || !cloudKnown.current) return
    saving.current = true
    const document = latest.current
    setStatus('Salvestan…')
    let successful = false
    try {
      const saved = await saveCloudCardDraft(document, revision.current)
      revision.current = saved.revision
      dirty.current = latest.current !== document
      await saveLocal(latest.current!, dirty.current)
      successful = true
      if (mounted.current) { setNotice(''); setStatus(dirty.current ? 'Salvestan…' : 'Salvestatud') }
    } catch (cause) {
      if (cause instanceof CardDraftConflictError) {
        blocked.current = true
        try {
          const remote = await loadCloudCardDraft(userId)
          if (mounted.current) setConflict(remote)
        } catch { cloudKnown.current = false }
        if (mounted.current) setNotice('Kaarti muudeti teises aknas. Vali, millise kujundusega jätkad.')
      } else if (mounted.current) setNotice('Pilve salvestamine ebaõnnestus. Sinu muudatused on brauseri mustandis.')
      if (mounted.current) setStatus(localSaved.current === latest.current ? 'Brauseris salvestatud' : 'Salvestamata')
    } finally {
      saving.current = false
      if (successful && dirty.current && mounted.current) scheduleSave()
    }
  }

  const retry = async () => {
    if (saving.current || !latest.current) return
    try {
      const remote = await loadCloudCardDraft(userId)
      cloudKnown.current = true
      if ((remote?.revision ?? null) !== revision.current && dirty.current) {
        blocked.current = true; setConflict(remote)
        setNotice('Kaarti muudeti teises aknas. Vali, millise kujundusega jätkad.')
        return
      }
      if (!dirty.current && remote && remote.revision !== revision.current) {
        latest.current = remote.document; setInitialDocument(remote.document); setEditorKey((key) => key + 1)
      }
      revision.current = remote?.revision ?? null
      blocked.current = false; setConflict(null); setNotice('')
      if (dirty.current) await operations.current.save()
      else { await saveLocal(latest.current, false); setStatus(dirty.current ? 'Salvestan…' : 'Salvestatud') }
    } catch { setNotice('Pilv pole praegu kättesaadav. Proovi uuesti.'); setStatus(localSaved.current === latest.current ? 'Brauseris salvestatud' : 'Salvestamata') }
  }
  operations.current = { save, retry }

  useEffect(() => {
    let canceled = false
    mounted.current = true
    void Promise.allSettled([loadCloudCardDraft(userId), loadLocalCardDraft(userId)]).then(([cloudResult, localResult]) => {
      if (canceled) return
      const cloud = cloudResult.status === 'fulfilled' ? cloudResult.value : null
      const local = localResult.status === 'fulfilled' ? localResult.value : null
      cloudKnown.current = cloudResult.status === 'fulfilled'
      const restoreLocal = local && (local.dirty || !cloudKnown.current)
      revision.current = restoreLocal ? local.baseRevision : cloud?.revision ?? null
      const document = restoreLocal ? local.document : cloud?.document ?? createDefaultCard()
      latest.current = document
      localSaved.current = restoreLocal ? document : null
      dirty.current = restoreLocal ? local.dirty : !cloud
      blocked.current = Boolean(cloudKnown.current && local?.dirty && local.baseRevision !== (cloud?.revision ?? null))
      if (blocked.current) { setConflict(cloud); setNotice('Kaarti muudeti teises aknas. Vali, millise kujundusega jätkad.') }
      else if (!cloudKnown.current) setNotice('Pilv pole kättesaadav. Mustand salvestub selles brauseris.')
      if (localResult.status === 'rejected') setLocalError('Brauseri taastekoopiat ei saanud avada.')
      setStatus(cloudKnown.current && !dirty.current ? 'Salvestatud' : restoreLocal ? 'Brauseris salvestatud' : 'Salvestan…')
      setInitialDocument(document)
      if (localResult.status === 'fulfilled') void saveLocal(document, dirty.current).then(() => { if (!canceled && !cloudKnown.current) setStatus(localSaved.current === latest.current ? 'Brauseris salvestatud' : 'Salvestamata') })
      if (dirty.current && cloudKnown.current && !blocked.current) scheduleSave()
    })
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty.current && latest.current !== localSaved.current) { event.preventDefault(); event.returnValue = '' }
    }
    const online = () => { void operations.current.retry() }
    window.addEventListener('beforeunload', beforeUnload)
    window.addEventListener('online', online)
    return () => { canceled = true; mounted.current = false; window.clearTimeout(timer.current); window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('online', online) }
  }, [userId])

  const changed = (document: CardDocument) => {
    latest.current = document; dirty.current = true
    setStatus('Salvestan…')
    void saveLocal(document, true).then(() => {
      if (mounted.current && (!cloudKnown.current || blocked.current)) setStatus(localSaved.current === latest.current ? 'Brauseris salvestatud' : 'Salvestamata')
    })
    scheduleSave()
  }

  const resolveConflict = (useCloud: boolean) => {
    if (useCloud && conflict) {
      latest.current = conflict.document; dirty.current = false
      setInitialDocument(conflict.document); setEditorKey((key) => key + 1)
    }
    revision.current = conflict?.revision ?? null
    blocked.current = false; cloudKnown.current = true
    setConflict(null); setNotice('')
    if (latest.current) void saveLocal(latest.current, dirty.current)
    if (dirty.current) void operations.current.save()
    else setStatus('Salvestatud')
  }

  if (!initialDocument) return <div className="business-card-editor bc-loading" aria-busy="true"><span className="bc-spinner" /><span>Avan visiitkaarti…</span></div>
  return <BusinessCardEditor key={editorKey} initialDocument={initialDocument} onDocumentChange={changed} onSave={() => void operations.current.retry()} saveStatus={localError && status !== 'Salvestatud' ? 'Salvestamata' : status} storageNotice={<>
    {notice && <div className="bc-notice" role="status"><span>{notice}</span>{blocked.current && cloudKnown.current ? <div>{conflict && <button type="button" onClick={() => resolveConflict(true)}>Ava pilveversioon</button>}<button type="button" onClick={() => resolveConflict(false)}>Salvesta see versioon</button></div> : <button type="button" onClick={() => void operations.current.retry()}>Proovi uuesti</button>}</div>}
    {localError && <div className="bc-notice is-error" role="alert">{localError}</div>}
  </>} />
}
