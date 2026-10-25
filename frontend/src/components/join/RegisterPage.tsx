import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Check, CheckCheck, CreditCard, FileText, LoaderCircle, ShieldCheck, Upload, Waves } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BandMark, CoverSlip } from '@/components/cover/CoverSlip'
import { MOCK_BANDS, type MockBand } from '@/mock/bands'
import { fieldClass } from '@/cover/fields'
import { blankRegistration, getSavedRegistration, saveRegistration, type Registration } from '@/cover/registry'
import { useRoute } from '@/cover/route'
import { useWallClock } from '@/hooks/useWallClock'
import { useSession, type MedicalCardView } from '@/stdb/session'
import { validateMedicalFile, type MedicalDocumentKind } from '@/stdb/uploads'

const BRANDS = ['Visa', 'Mastercard', 'Amex']

function bandFromLocation(search: string) {
  const id = new URLSearchParams(search).get('band')
  return MOCK_BANDS.find((band) => band.deviceId === id) ?? null
}

function NightHeader() {
  const { go } = useRoute()
  return (
    <header className="flex flex-wrap items-baseline justify-between gap-4">
      <button type="button" onClick={() => go('/join')} className="font-display text-[30px] leading-none text-ink">BandIt</button>
      <nav aria-label="Night" className="flex items-baseline gap-5 text-[14px]">
        <button type="button" onClick={() => go('/')} className="text-ink-dim hover:text-ink">Map</button>
        <button type="button" onClick={() => go('/claims')} className="text-ink-dim hover:text-ink">Claims</button>
      </nav>
    </header>
  )
}

function errorsFor(draft: Registration): Record<string, string> {
  const errors: Record<string, string> = {}
  if (!draft.name.trim()) errors.name = 'Name the person wearing it.'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())) errors.email = 'Use an email address.'
  if (!draft.emergencyName.trim()) errors.emergencyName = 'Name someone to call.'
  if (!draft.emergencyPhone.trim()) errors.emergencyPhone = 'Give a phone number.'
  if (!BRANDS.includes(draft.cardBrand)) errors.cardBrand = 'Choose a card brand.'
  if (!/^\d{4}$/.test(draft.last4.trim())) errors.last4 = 'Last four is four digits.'
  if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(draft.exp.trim())) errors.exp = 'Use MM/YY, like 09/28.'
  return errors
}

function Field({ id, label, value, onChange, error, type = 'text', autoComplete, inputMode, maxLength }: {
  id: string; label: string; value: string; onChange: (value: string) => void; error?: string
  type?: string; autoComplete?: string; inputMode?: 'text' | 'email' | 'tel' | 'numeric'; maxLength?: number
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-[14px] font-medium text-ink">{label}</label>
      <input id={id} type={type} value={value} autoComplete={autoComplete} inputMode={inputMode} maxLength={maxLength}
        aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => onChange(event.target.value)} className={fieldClass} />
      {error && <p id={`${id}-error`} className="mt-1.5 text-[13px] text-signal">{error}</p>}
    </div>
  )
}

function Step({ number, title, note, children }: { number: string; title: string; note: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`step-${number}`} className="border-t border-line pt-7">
      <div className="mb-6 flex items-start gap-4">
        <span aria-hidden="true" className="pt-1 font-mono text-[11px] text-champagne">{number}</span>
        <div>
          <h2 id={`step-${number}`} className="font-display text-[30px] leading-none">{title}</h2>
          <p className="mt-2 text-[14px] leading-6 text-ink-dim">{note}</p>
        </div>
      </div>
      {children}
    </section>
  )
}

interface LocalUpload {
  id: number
  file: File
  kind: MedicalDocumentKind
  hash?: string
  status: 'uploading' | 'reading' | 'failed'
  error?: string
}

const reason = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.'

function UploadArea({ kind, title, note, disabled, onFiles, error }: {
  kind: MedicalDocumentKind; title: string; note: string; disabled: boolean
  onFiles: (files: File[]) => void; error?: string
}) {
  const [dragging, setDragging] = useState(false)
  return (
    <div>
      <label htmlFor={`upload-${kind}`} className={`relative flex flex-col items-start gap-3 rounded border border-dashed p-5 transition-colors ${disabled ? 'border-line opacity-60' : dragging ? 'border-champagne bg-champagne/5' : 'border-line-strong bg-raised/40 hover:border-champagne/60'}`}
        onDragOver={(event) => { event.preventDefault(); if (!disabled) setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => { event.preventDefault(); setDragging(false); if (!disabled) onFiles(Array.from(event.dataTransfer.files)) }}>
        <Upload size={20} strokeWidth={1.5} className="text-champagne" aria-hidden="true" />
        <span className="text-[15px] font-medium">{title}</span>
        <span id={`upload-${kind}-help`} className="text-[13px] leading-5 text-ink-dim">{note} PDF for now · up to 10 MB per file.</span>
        <input id={`upload-${kind}`} type="file" accept="image/*,application/pdf" multiple disabled={disabled}
          aria-describedby={`upload-${kind}-help${error ? ` upload-${kind}-error` : ''}`} aria-invalid={error ? true : undefined}
          onChange={(event) => { onFiles(Array.from(event.target.files ?? [])); event.target.value = '' }}
          className="block w-full min-w-0 text-[12px] text-ink-dim file:mr-3 file:cursor-pointer file:rounded file:border file:border-line-strong file:bg-raised file:px-3 file:py-2 file:text-[13px] file:text-ink disabled:file:cursor-default" />
      </label>
      {error && <p role="alert" id={`upload-${kind}-error`} className="mt-2 text-[13px] leading-5 text-signal">{error}</p>}
    </div>
  )
}

function MedicalReview({ card, confirming, blocked, onConfirm }: { card: MedicalCardView; confirming: boolean; blocked: boolean; onConfirm: () => void }) {
  const facts = [
    ['Blood type', card.bloodType], ['Allergies', card.allergies], ['Conditions', card.conditions], ['Medications', card.medications],
    ['Emergency contact', card.emergencyContact], ['Insurer', card.insurer], ['Plan', card.plan], ['Member ID', card.memberId],
    ['Group number', card.groupNumber], ['Insurer phone', card.insurerPhone],
  ]
  return (
    <div className="rounded border border-line bg-raised/40 p-5">
      <dl className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-x-4 gap-y-3 text-[14px] leading-6">
        {facts.map(([label, value]) => <div key={label} className="contents"><dt className="text-ink-dim">{label}</dt><dd className="break-words">{value || 'Not found in documents'}</dd></div>)}
      </dl>
      {card.status === 'confirmed' && !blocked ? (
        <p role="status" className="mt-6 flex items-center gap-2 text-[14px] text-teal"><CheckCheck size={17} aria-hidden="true" /> You confirmed this card.</p>
      ) : (
        <Button type="button" className="mt-6 h-11" disabled={confirming || blocked} onClick={onConfirm}>
          {confirming ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}
          {confirming ? 'Confirming…' : 'This is right'}
        </Button>
      )}
      <p className="mt-3 text-[12px] leading-5 text-ink-dim">Something missing or incorrect? Upload a corrected document before confirming.</p>
    </div>
  )
}

function withMedicalCard(registration: Registration, card: MedicalCardView | null): Registration {
  if (!card) return registration
  return { ...registration, bloodType: card.bloodType, allergies: card.allergies, conditions: card.conditions,
    medications: card.medications, carrier: card.insurer, memberId: card.memberId, groupId: card.groupNumber,
    emergencyName: registration.emergencyName || card.emergencyContact,
    emergencyPhone: registration.emergencyPhone }
}

function RegistrationForm({ band }: { band: MockBand }) {
  const { go } = useRoute()
  const now = useWallClock()
  const session = useSession()
  const { myBand, medicalCard, medicalDocuments, myBandReady, claimBand } = session
  const [draft, setDraft] = useState(() => getSavedRegistration(band.deviceId) ?? blankRegistration(band.deviceId))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState<Registration | null>(null)
  const [saving, setSaving] = useState(false)
  const [claiming, setClaiming] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [uploads, setUploads] = useState<LocalUpload[]>([])
  const [uploadErrors, setUploadErrors] = useState<Partial<Record<MedicalDocumentKind, string>>>({})
  const [retrying, setRetrying] = useState<string[]>([])
  const uploadId = useRef(0)
  const attemptedClaim = useRef(false)
  const mine = myBand?.bandId === Number(band.label) ? myBand : null
  const owned = mine?.status === 'claimed'
  const expired = mine?.expiresAt != null && mine.expiresAt <= now
  const waitingForPress = mine?.status === 'waiting_for_press' && !expired
  const connected = session.phase === 'live'
  // A retry creates a new row: show the newest attempt for a given document.
  const documents = [...medicalDocuments].sort((a, b) => b.uploadedAt - a.uploadedAt || Number(BigInt(b.id) - BigInt(a.id)))
    .filter((doc, index, all) => all.findIndex((item) => item.fileHash === doc.fileHash && item.kind === doc.kind) === index)
  const outstanding = uploads.some((item) => item.status !== 'failed' && (!item.hash || !documents.some((doc) => doc.fileHash === item.hash && doc.kind === item.kind)))
    || documents.some((doc) => doc.status !== 'read' && doc.status !== 'failed') || retrying.length > 0
  const reviewBlocked = !owned || !connected || outstanding || !session.medicalDocumentsReady
  const confirmed = session.medicalCardReady && medicalCard?.status === 'confirmed' && !reviewBlocked
  const uploadingKind = (kind: MedicalDocumentKind) => uploads.some((item) => item.kind === kind && item.status === 'uploading')
    || documents.some((doc) => doc.kind === kind && doc.status === 'reading')

  const claim = async () => {
    setClaiming(true)
    setErrors((current) => ({ ...current, form: '' }))
    try { await claimBand(`BANDIT-${band.label}`) }
    catch (error) { setErrors((current) => ({ ...current, form: reason(error) })) }
    finally { setClaiming(false) }
  }

  useEffect(() => {
    if (!connected || !myBandReady || attemptedClaim.current) return
    attemptedClaim.current = true
    if (owned || waitingForPress) return
    void Promise.resolve().then(() => {
      setClaiming(true)
      return claimBand(`BANDIT-${band.label}`)
    })
      .catch((error: unknown) => setErrors((current) => ({ ...current, form: reason(error) })))
      .finally(() => setClaiming(false))
  }, [connected, myBandReady, claimBand, band.label, owned, waitingForPress])

  const set = (key: keyof Registration) => (value: string) => setDraft((current) => ({ ...current, [key]: value }))

  const sendFile = async (upload: LocalUpload) => {
    setUploads((current) => current.map((item) => item.id === upload.id ? { ...item, status: 'uploading', error: undefined } : item))
    try {
      const { hash } = await session.submitMedicalDocument(upload.file, upload.kind)
      setUploads((current) => current.map((item) => item.id === upload.id ? { ...item, hash, status: 'reading' } : item))
    } catch (error) {
      setUploads((current) => current.map((item) => item.id === upload.id ? { ...item, status: 'failed', error: reason(error) } : item))
    }
  }

  const addFiles = (kind: MedicalDocumentKind, files: File[]) => {
    if (!owned || !connected || !files.length) return
    const rejected = files.map((file) => { const error = validateMedicalFile(file); return error ? `${file.name}: ${error}` : '' }).filter(Boolean)
    if (rejected.length) { setUploadErrors((current) => ({ ...current, [kind]: rejected.join(' ') })); return }
    // The current backend always feeds bytes to a PDF reader and replaces same-kind fields.
    // Keep unsupported selections local until that contract supports images and merging.
    if (files.some((file) => file.type !== 'application/pdf')) {
      setUploadErrors((current) => ({ ...current, [kind]: 'Photo reading is not available yet. Please use a PDF for now; no files were uploaded.' }))
      return
    }
    if (files.length > 1) {
      setUploadErrors((current) => ({ ...current, [kind]: 'Please combine these pages into one PDF. This reader currently replaces earlier documents of the same type; no files were uploaded.' }))
      return
    }
    setUploadErrors((current) => ({ ...current, [kind]: '' }))
    const added = files.map((file) => ({ id: ++uploadId.current, kind, file, status: 'uploading' as const }))
    setUploads((current) => [...current, ...added])
    for (const upload of added) void sendFile(upload)
  }

  const retryDocument = async (id: string) => {
    setRetrying((current) => [...current, id])
    try { await session.retryMedicalDocument(id) }
    catch (error) { setErrors((current) => ({ ...current, form: reason(error) })) }
    finally { setRetrying((current) => current.filter((value) => value !== id)) }
  }

  const confirm = async () => {
    if (reviewBlocked) return
    setConfirming(true)
    setErrors((current) => ({ ...current, form: '' }))
    try { await session.confirmMedicalCard() }
    catch (error) { setErrors((current) => ({ ...current, form: reason(error) })) }
    finally { setConfirming(false) }
  }

  const save = async (event: FormEvent) => {
    event.preventDefault()
    const next = { ...draft, bandId: band.deviceId, name: draft.name.trim(), email: draft.email.trim(),
      emergencyName: draft.emergencyName.trim(), emergencyPhone: draft.emergencyPhone.trim(), last4: draft.last4.trim(), exp: draft.exp.trim() }
    const found = errorsFor(next)
    if (!owned) found.form = 'Press the button on your band to confirm it belongs to you.'
    else if (!confirmed) found.form = 'Review and confirm your medical card before saving.'
    setErrors(found)
    if (Object.keys(found).length) return
    setSaving(true)
    try {
      await session.registerBand(`BANDIT-${band.label}`, next.name)
      saveRegistration(next)
      setDraft(next)
      setSaved(next)
    } catch (error) { setErrors((current) => ({ ...current, form: reason(error) })) }
    finally { setSaving(false) }
  }

  if (saved) return (
    <div className="mt-14 grid items-start gap-12 pb-16 md:mt-20 md:grid-cols-2">
      <div>
        <p className="mb-5 flex items-center gap-2 text-[13px] text-teal"><ShieldCheck size={18} aria-hidden="true" /> Ready for the night</p>
        <h1 className="font-display text-[clamp(36px,4vw,56px)] leading-[0.98] tracking-[-0.02em]">Saved on band {band.label}.</h1>
        <p className="mt-5 max-w-[40ch] text-[16px] leading-7 text-ink-dim">Your band is linked and your details are saved. Your medical card is ready for review at the aid station when it’s needed.</p>
        <WalletStatus />
        <div className="mt-8 flex flex-wrap items-center gap-5">
          <Button type="button" className="h-11 px-4" onClick={() => setSaved(null)}>Edit this band</Button>
          <button type="button" onClick={() => go('/claims')} className="text-[14px]">Claims desk</button>
        </div>
      </div>
      <CoverSlip registration={withMedicalCard(saved, session.medicalCardReady ? medicalCard : null)} bandLabel={band.label} />
    </div>
  )

  return (
    <div className="mt-14 grid items-start gap-12 pb-20 md:mt-20 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] md:gap-20">
      <aside className="min-w-0 md:sticky md:top-8">
        <p className="mb-5 text-[12px] uppercase tracking-[0.16em] text-champagne">One band. Your night.</p>
        <h1 className="max-w-[9ch] font-display text-[clamp(42px,5vw,64px)] leading-[0.98] tracking-[-0.02em]">{owned ? 'Make it yours.' : 'Register this band.'}</h1>
        <p className="mt-5 max-w-[32ch] text-[16px] leading-7 text-ink-dim">A few details now. A little peace of mind for the rest of the night.</p>
        <div className="mt-8 rounded border border-line bg-raised/50 p-5">
          <div className="flex items-center justify-between gap-3"><BandMark /><span aria-hidden="true" className="font-mono text-[30px] text-champagne">{band.label}</span></div>
          <h2 className="mt-5 text-[16px]">You’re on band {band.label}</h2>
          <div role="status" className="mt-2 text-[13px] leading-6 text-ink-dim">
            {owned ? <span className="flex items-center gap-2 text-teal"><Check size={15} aria-hidden="true" /> Claimed · edit your details below.</span>
              : waitingForPress ? <span className="text-champagne">Press the button on your band to make it yours.{mine?.expiresAt != null && ` ${Math.max(0, Math.ceil((mine.expiresAt - now) / 1000))} seconds left.`}</span>
              : expired ? 'The button window expired. Try claiming your band again.'
              : claiming ? 'Claiming your band…'
              : !connected ? 'Connecting to your band…'
              : !session.myBandReady ? 'Checking your band…' : 'Your band has not been confirmed yet.'}
          </div>
          {connected && session.myBandReady && !owned && !waitingForPress && !claiming && <Button type="button" variant="outline" className="mt-4 h-10" onClick={() => void claim()}>Try claiming again</Button>}
        </div>
        <p className="mt-5 flex items-start gap-2 text-[12px] leading-5 text-ink-muted"><ShieldCheck size={16} className="mt-0.5 shrink-0" aria-hidden="true" /> Documents are read for your medical card. File contents stay out of this browser’s saved registration.</p>
      </aside>

      <form onSubmit={(event) => void save(event)} noValidate className="min-w-0 space-y-10" aria-label={`Register band ${band.label}`}>
        {(errors.form || session.signupError || session.error) && <p role="alert" className="rounded border border-signal/30 bg-signal/5 p-4 text-[14px] leading-6 text-signal">{errors.form || session.signupError || session.error}</p>}
        <Step number="01" title="The person wearing it" note="Who you are, and who we should call.">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="name" label="Name" value={draft.name} onChange={set('name')} error={errors.name} autoComplete="name" />
            <Field id="email" label="Email" type="email" value={draft.email} onChange={set('email')} error={errors.email} autoComplete="email" inputMode="email" />
            <Field id="emergency-name" label="Emergency contact" value={draft.emergencyName} onChange={set('emergencyName')} error={errors.emergencyName} autoComplete="section-emergency name" />
            <Field id="emergency-phone" label="Emergency phone" type="tel" value={draft.emergencyPhone} onChange={set('emergencyPhone')} error={errors.emergencyPhone} autoComplete="section-emergency tel" inputMode="tel" />
          </div>
        </Step>
        <Step number="02" title="Your documents" note="We’ll read the details, then you check them.">
          {!owned && <p className="mb-4 text-[13px] leading-6 text-champagne">Confirm your band with its button to unlock uploads.</p>}
          <p className="mb-5 text-[13px] leading-6 text-ink-dim">For now, use one PDF for each section. Include both sides of your insurance card in the same PDF. Photo reading and combining separate files are not available yet.</p>
          <div className="grid gap-4">
            <UploadArea kind="insurance" title="Insurance card" note="Front and back, together." disabled={!owned || !connected || uploadingKind('insurance')} onFiles={(files) => addFiles('insurance', files)} error={uploadErrors.insurance} />
            <UploadArea kind="history" title="Medical history" note="Your medical records." disabled={!owned || !connected || uploadingKind('history')} onFiles={(files) => addFiles('history', files)} error={uploadErrors.history} />
          </div>
          <ul aria-label="Document status" aria-live="polite" className="mt-4 divide-y divide-line">
            {uploads.filter((item) => !item.hash || !documents.some((doc) => doc.fileHash === item.hash && doc.kind === item.kind)).map((item) => (
              <li key={`local-${item.id}`} className="py-3 text-[13px]">
                <div className="flex items-start gap-3"><FileText size={16} className="mt-0.5 shrink-0 text-ink-dim" aria-hidden="true" /><span className="min-w-0 flex-1 break-words">{item.file.name}</span><span className={item.status === 'failed' ? 'text-signal' : 'text-champagne'}>{item.status === 'uploading' ? 'Uploading' : item.status === 'failed' ? 'Failed' : 'Reading'}</span></div>
                {item.error && <p className="mt-2 break-words text-signal">{item.error}</p>}
                {item.status === 'failed' && <button type="button" disabled={!owned || !connected} className="mt-2 min-h-10 text-champagne underline underline-offset-4" onClick={() => void sendFile(item)}>Retry {item.file.name}</button>}
              </li>
            ))}
            {documents.map((doc) => {
              const local = uploads.find((item) => item.hash === doc.fileHash && item.kind === doc.kind)
              const name = local?.file.name ?? `${doc.kind === 'insurance' ? 'Insurance card' : 'Medical history'} · document ${doc.id}`
              return <li key={doc.id} className="py-3 text-[13px]">
                <div className="flex items-start gap-3"><FileText size={16} className="mt-0.5 shrink-0 text-ink-dim" aria-hidden="true" /><span className="min-w-0 flex-1 break-words">{name}</span><span className={doc.status === 'read' ? 'text-teal' : doc.status === 'failed' ? 'text-signal' : 'text-champagne'}>{doc.status === 'read' ? 'Read' : doc.status === 'failed' ? 'Failed' : 'Reading'}</span></div>
                {doc.dropped.length > 0 && <div className="mt-3 text-ink-dim"><p>Fields left out by the reader:</p><ul className="mt-1 list-disc pl-5">{doc.dropped.map((field, index) => <li key={index} className="break-words">{field}</li>)}</ul></div>}
                {doc.status === 'failed' && <button type="button" disabled={!owned || !connected || retrying.includes(doc.id)} className="mt-2 min-h-10 text-champagne underline underline-offset-4" onClick={() => void retryDocument(doc.id)}>{retrying.includes(doc.id) ? 'Retrying…' : `Retry ${name}`}</button>}
              </li>
            })}
          </ul>
        </Step>
        <Step number="03" title="A second look" note="Check what your documents told us.">
          {!session.medicalCardReady || !session.medicalDocumentsReady || outstanding ? <p role="status" className="mb-4 flex items-center gap-2 text-[14px] text-ink-dim"><LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> Still reading your documents.</p> : !medicalCard ? <p className="text-[14px] leading-6 text-ink-dim">Your medical and insurance details will appear here after you upload your documents.</p> : null}
          {session.medicalCardReady && medicalCard && <MedicalReview card={medicalCard} confirming={confirming} blocked={reviewBlocked} onConfirm={() => void confirm()} />}
        </Step>
        <Step number="04" title="A card for the night" note="Mock payment details for this demo.">
          <div className="mb-5 flex items-center gap-2 text-[12px] uppercase tracking-wider text-champagne"><CreditCard size={16} aria-hidden="true" /> Demo payment</div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="brand" className="mb-2 block text-[14px] font-medium">Card</label>
              <select id="brand" value={draft.cardBrand} onChange={(event) => set('cardBrand')(event.target.value)} className={fieldClass} aria-invalid={errors.cardBrand ? true : undefined} aria-describedby={errors.cardBrand ? 'brand-error' : undefined}>
                {BRANDS.map((brand) => <option key={brand} value={brand}>{brand}</option>)}
              </select>
              {errors.cardBrand && <p id="brand-error" className="mt-2 text-[13px] text-signal">{errors.cardBrand}</p>}
            </div>
            <Field id="last4" label="Last four" value={draft.last4} onChange={set('last4')} error={errors.last4} inputMode="numeric" autoComplete="off" maxLength={4} />
            <Field id="exp" label="Expiry" value={draft.exp} onChange={set('exp')} error={errors.exp} autoComplete="off" maxLength={5} />
          </div>
          <p className="mt-3 text-[13px] leading-5 text-ink-dim">Last four only. The full number never lands here.</p>
          <WalletStatus />
          <Button type="submit" className="mt-6 h-12 w-full sm:w-auto sm:px-6" disabled={saving || !owned || !confirmed || !connected}>{saving ? 'Saving…' : 'Save this band'}</Button>
          {!confirmed && <p className="mt-3 text-[12px] leading-5 text-ink-muted">Confirm your band and review your medical card to finish.</p>}
        </Step>
      </form>
    </div>
  )
}

function WalletStatus() {
  const wallet = useSession((state) => state.wallet)
  const error = useSession((state) => state.walletError)
  return <p role="status" className="mt-4 break-words text-[13px] leading-5 text-ink-dim">{wallet ? `Wallet account ${wallet.accountId}` : error ? `Wallet pending: ${error} Your registration can still be saved.` : 'Your wallet account will appear here when it opens. It won’t hold up registration.'}</p>
}

export function RegisterPage() {
  const { search } = useRoute()
  const band = bandFromLocation(search)
  return (
    <div data-page className="h-full overflow-y-auto bg-ground text-ink">
      <div className="mx-auto w-full max-w-[1200px] px-5 py-6 md:px-10 md:py-8">
        <NightHeader />
        {band ? <RegistrationForm key={band.deviceId} band={band} /> : (
          <div className="mx-auto mt-24 max-w-md pb-20 text-center md:mt-32">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-line bg-raised"><Waves size={30} strokeWidth={1.25} className="text-champagne" aria-hidden="true" /></div>
            <h1 className="mt-8 font-display text-[clamp(38px,5vw,56px)] leading-none tracking-[-0.02em]">Tap your band to start.</h1>
            <p className="mt-5 text-[16px] leading-7 text-ink-dim">Hold your phone near your band’s NFC tag and open the link. We’ll take you straight to your band.</p>
          </div>
        )}
      </div>
    </div>
  )
}
