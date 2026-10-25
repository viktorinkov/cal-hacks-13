import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Check, CheckCheck, CreditCard, FileText, LoaderCircle, ShieldCheck, Sparkles, Waves } from 'lucide-react'
import { LeaveEvent } from '@/components/attendee/LeaveEvent'
import { MedicTap } from '@/components/attendee/MedicTap'
import { PlanLookup } from '@/components/attendee/PlanLookup'
import { ProfileMatch } from '@/components/attendee/ProfileMatch'
import { Socials } from '@/components/attendee/Socials'
import { CoverSlip } from '@/components/cover/CoverSlip'
import { Recap } from '@/components/recap/Recap'
import { Button } from '@/components/ui/button'
import { MOCK_BANDS, type MockBand } from '@/mock/bands'
import { blankRegistration, getSavedRegistration, saveRegistration, type Registration } from '@/cover/registry'
import { useRoute } from '@/cover/route'
import { bandIdFromSearch, rememberBand } from '@/cover/tapLink'
import { nightIsOver, nightKnown } from '@/recap/night'
import { useAttendee, useIsMedic, useMedicOnBand } from '@/stdb/attendeeOps'
import { isViewing } from '@/stdb/viewing'
import { useSession, type MedicalCardView } from '@/stdb/session'
import { validateMedicalFile, type MedicalDocumentKind } from '@/stdb/uploads'

import { ConcertLights } from './ConcertLights'
import './RegisterPage.css'

const fieldClass = 'signup-input'
const BRANDS = ['Visa', 'Mastercard', 'Amex']

function bandFromLocation(search: string) {
  const id = new URLSearchParams(search).get('band')
  return MOCK_BANDS.find((band) => band.deviceId === id) ?? null
}

function NightHeader({ lights, onToggleLights }: { lights: boolean; onToggleLights: () => void }) {
  const { go } = useRoute()
  return (
    <header className="signup-header">
      <button type="button" onClick={() => go('/join')} className="font-display text-[30px] leading-none text-ink">BandIt</button>
      <nav aria-label="Night" className="signup-nav">
        <button type="button" className="signup-light-toggle" aria-pressed={lights} aria-label="Concert lights" onClick={onToggleLights}>
          <Sparkles size={15} aria-hidden="true" /><span>Lights</span>
        </button>
        <button type="button" onClick={() => go('/wallet')} className="text-ink-dim hover:text-ink">Wallet</button>
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
  if (!draft.street.trim()) errors.street = 'Give a street address.'
  if (!draft.city.trim()) errors.city = 'Name the city.'
  if (!draft.region.trim()) errors.region = 'Name the state.'
  if (!/^\d{5}(?:-\d{4})?$/.test(draft.postalCode.trim())) errors.postalCode = 'Use a ZIP code, like 94107.'
  if (!draft.country.trim()) errors.country = 'Name the country.'
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

function Step({ sectionId, title, note, children }: { sectionId: string; title: string; note: string; children: ReactNode }) {
  return (
    <section aria-labelledby={sectionId} className="signup-section">
      <div className="signup-section-heading">
        <h2 id={sectionId}>{title}</h2>
        <p>{note}</p>
      </div>
      <div className="signup-panel">{children}</div>
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
      <label htmlFor={`upload-${kind}`} className={`signup-upload ${dragging ? 'is-dragging' : ''}`}
        onDragOver={(event) => { event.preventDefault(); if (!disabled) setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => { event.preventDefault(); setDragging(false); if (!disabled) onFiles(Array.from(event.dataTransfer.files)) }}>
        <span className="signup-upload-copy"><span className="block text-[14px] font-medium">{title}</span>
        <span id={`upload-${kind}-help`} className="text-[13px] leading-5 text-ink-dim">{note} PDF · up to 10 MB.</span></span>
        <input id={`upload-${kind}`} type="file" accept="image/*,application/pdf" multiple disabled={disabled}
          aria-describedby={`upload-${kind}-help${error ? ` upload-${kind}-error` : ''}`} aria-invalid={error ? true : undefined}
          onChange={(event) => { onFiles(Array.from(event.target.files ?? [])); event.target.value = '' }}
          className="signup-file" />
      </label>
      {error && <p role="alert" id={`upload-${kind}-error`} className="mt-2 text-[13px] leading-5 text-signal">{error}</p>}
    </div>
  )
}

export function MedicalReview({ card, confirming, blocked, onConfirm }: { card: MedicalCardView; confirming: boolean; blocked: boolean; onConfirm: () => void }) {
  const facts = [
    ['Blood type', card.bloodType], ['Allergies', card.allergies], ['Conditions', card.conditions], ['Medications', card.medications],
    ['Emergency contact', card.emergencyContact], ['Insurer', card.insurer], ['Plan', card.plan], ['Member ID', card.memberId],
    ['Group number', card.groupNumber], ['Insurer phone', card.insurerPhone],
  ]
  return (
    <div className="signup-medical">
      <dl className="signup-facts">
        {facts.map(([label, value]) => <div key={label}><dt className="text-ink-dim">{label}</dt><dd className="break-words">{value || 'Not found in documents'}</dd></div>)}
      </dl>
      {card.status === 'confirmed' && !blocked ? (
        <p role="status" className="mt-6 flex items-center gap-2 text-[14px] text-teal"><CheckCheck size={17} aria-hidden="true" /> You confirmed this card.</p>
      ) : (
        <Button type="button" className="signup-primary mt-6" disabled={confirming || blocked} onClick={onConfirm}>
          {confirming ? <LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}
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

function RegistrationForm({ band }: { band: Pick<MockBand, 'deviceId' | 'label'> }) {
  const { go } = useRoute()
  const session = useSession()
  const attendee = useAttendee((s) => s.attendee)
  const { myBand, medicalCard, medicalDocuments, myBandReady, claimBand } = session
  const [draft, setDraft] = useState(() => getSavedRegistration(band.deviceId) ?? blankRegistration(band.deviceId))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState<Registration | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [uploads, setUploads] = useState<LocalUpload[]>([])
  const [uploadErrors, setUploadErrors] = useState<Partial<Record<MedicalDocumentKind, string>>>({})
  const [retrying, setRetrying] = useState<string[]>([])
  const [claimError, setClaimError] = useState<string | null>(null)
  const savedHeading = useRef<HTMLHeadingElement>(null)
  const uploadId = useRef(0)
  const attemptedClaim = useRef(false)
  // A medic tapping someone else's band must never claim it.
  const isMedic = useIsMedic()
  const mine = myBand?.bandId === Number(band.label) ? myBand : null
  const owned = mine?.status === 'claimed'
  const connected = session.phase === 'live'
  const linked = connected && !claimError
  const over = nightIsOver(session.eventEnded, session.departure?.leftAt)
  // A retry creates a new row: show the newest attempt for a given document.
  const documents = [...medicalDocuments].sort((a, b) => b.uploadedAt - a.uploadedAt || Number(BigInt(b.id) - BigInt(a.id)))
    .filter((doc, index, all) => all.findIndex((item) => item.fileHash === doc.fileHash && item.kind === doc.kind) === index)
  const outstanding = uploads.some((item) => item.status !== 'failed' && (!item.hash || !documents.some((doc) => doc.fileHash === item.hash && doc.kind === item.kind)))
    || documents.some((doc) => doc.status !== 'read' && doc.status !== 'failed') || retrying.length > 0
  const reviewBlocked = !linked || outstanding || !session.medicalDocumentsReady
  const confirmed = session.medicalCardReady && medicalCard?.status === 'confirmed' && !reviewBlocked
  const uploadingKind = (kind: MedicalDocumentKind) => uploads.some((item) => item.kind === kind && item.status === 'uploading')
    || documents.some((doc) => doc.kind === kind && doc.status === 'reading')

  useEffect(() => {
    if (isViewing() || over || !connected || !myBandReady || attemptedClaim.current || owned || isMedic) return
    attemptedClaim.current = true
    void claimBand(`BANDIT-${band.label}`).catch((error: unknown) => setClaimError(reason(error)))
  }, [over, connected, myBandReady, claimBand, band.label, owned, isMedic])

  useEffect(() => {
    if (!saved) return
    savedHeading.current?.closest('[data-page]')?.scrollTo({ top: 0 })
    savedHeading.current?.focus({ preventScroll: true })
  }, [saved])

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
    if (!linked || !files.length) return
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
      emergencyName: draft.emergencyName.trim(), emergencyPhone: draft.emergencyPhone.trim(),
      street: draft.street.trim(), unit: draft.unit.trim(), city: draft.city.trim(), region: draft.region.trim(),
      postalCode: draft.postalCode.trim(), country: draft.country.trim(), last4: draft.last4.trim(), exp: draft.exp.trim() }
    const found = errorsFor(next)
    if (claimError) found.form = claimError
    else if (!connected) found.form = 'Connecting to your band…'
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

  if (over) return <main className="wallet-main"><Recap showWalletLink /></main>

  if (saved) return (
    <div className="signup-complete">
      <div>
        <p className="mb-5 flex items-center gap-2 text-[13px] text-teal"><ShieldCheck size={18} aria-hidden="true" /> Ready for the night</p>
        <h1 ref={savedHeading} tabIndex={-1} className="signup-title">Saved on band {band.label}.</h1>
        <p className="mt-5 max-w-[40ch] text-[16px] leading-7 text-ink-dim">Your band is linked and your details are saved. Your medical card is ready for review at the aid station when it’s needed.</p>
        <WalletStatus />
        <div className="mt-8"><ProfileMatch /><LeaveEvent /></div>
        <div className="mt-8 flex flex-wrap items-center gap-5">
          <Button type="button" className="signup-primary" onClick={() => setSaved(null)}>Edit this band</Button>
          <button type="button" onClick={() => go('/wallet')} className="min-h-11 text-[14px]">Open your wallet</button>
          <button type="button" onClick={() => go('/claims')} className="min-h-11 text-[14px]">Claims desk</button>
        </div>
      </div>
      <CoverSlip registration={withMedicalCard(saved, session.medicalCardReady ? medicalCard : null)} bandLabel={band.label} />
    </div>
  )

  return (
    <main className="signup-main">
      <div className="signup-intro">
        <h1 className="signup-title">Register your band.</h1>
        <p>Add your details, then check what your documents say.</p>
      </div>
      <div className="signup-band">
        <div className="signup-strap" aria-hidden="true"><span>{band.label}</span><i /></div>
        <div className="signup-band-status">
          <h2>You’re on band {band.label}</h2>
          <div role="status" className="signup-status">
            {claimError ? <span className="text-signal">{claimError}</span>
              : linked ? <span className="flex items-center gap-2"><Check size={15} className="text-teal" aria-hidden="true" /> Connected · ready for your details</span>
              : 'Connecting to your band…'}
          </div>
          {owned && <button type="button" onClick={() => go('/wallet')} className="mt-1 min-h-11 text-[14px] text-champagne underline underline-offset-4">Open your wallet</button>}
        </div>
        <div className="signup-preview" role="group" aria-label="Band details preview">
          <p>{draft.name.trim() || 'Your name goes here'}</p>
          <span><CreditCard size={15} aria-hidden="true" />{ /^\d{4}$/.test(draft.last4) ? `${draft.cardBrand} ···· ${draft.last4} · Demo` : 'No demo card added'}</span>
        </div>
      </div>

      <form onSubmit={(event) => void save(event)} noValidate className="signup-form" aria-label={`Register band ${band.label}`}>
        {(errors.form || session.signupError || session.error || claimError) && <p role="alert" className="rounded border border-signal/30 bg-signal/5 p-4 text-[14px] leading-6 text-signal">{errors.form || claimError || session.signupError || session.error}</p>}
        <Step sectionId="your-details" title="Your details" note="The person wearing the band, and someone to call.">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="name" label="Name" value={isViewing() ? (attendee?.displayName ?? '') : draft.name} onChange={set('name')} error={errors.name} autoComplete="name" />
            <Field id="email" label="Email" type="email" value={draft.email} onChange={set('email')} error={errors.email} autoComplete="email" inputMode="email" />
            <Field id="emergency-name" label="Emergency contact" value={draft.emergencyName} onChange={set('emergencyName')} error={errors.emergencyName} autoComplete="section-emergency name" />
            <Field id="emergency-phone" label="Emergency phone" type="tel" value={draft.emergencyPhone} onChange={set('emergencyPhone')} error={errors.emergencyPhone} autoComplete="section-emergency tel" inputMode="tel" />
          </div>
        </Step>
        <Step sectionId="socials" title="Socials" note="People you spend time with can see these after the event."><Socials bare /></Step>
        <Step sectionId="shipping" title="Shipping" note="Where a replacement band or merch should go.">
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field id="street" label="Street" value={draft.street} onChange={set('street')} error={errors.street} autoComplete="shipping address-line1" />
            </div>
            <div className="sm:col-span-2">
              <Field id="unit" label="Apartment" value={draft.unit} onChange={set('unit')} error={errors.unit} autoComplete="shipping address-line2" />
            </div>
            <Field id="city" label="City" value={draft.city} onChange={set('city')} error={errors.city} autoComplete="shipping address-level2" />
            <Field id="region" label="State" value={draft.region} onChange={set('region')} error={errors.region} autoComplete="shipping address-level1" maxLength={32} />
            <Field id="postal-code" label="ZIP" value={draft.postalCode} onChange={set('postalCode')} error={errors.postalCode} autoComplete="shipping postal-code" inputMode="numeric" maxLength={10} />
            <Field id="country" label="Country" value={draft.country} onChange={set('country')} error={errors.country} autoComplete="shipping country-name" />
          </div>
        </Step>
        <Step sectionId="your-documents" title="Documents" note="We’ll read the details, then you check them.">
          <p className="mb-5 text-[13px] leading-6 text-ink-dim">One PDF per section. Include both sides of your insurance card in one file. Photos and separate files aren’t supported yet.</p>
          <div className="grid gap-4">
            <UploadArea kind="insurance" title="Insurance card" note="Front and back, together." disabled={!linked || uploadingKind('insurance')} onFiles={(files) => addFiles('insurance', files)} error={uploadErrors.insurance} />
            <UploadArea kind="history" title="Medical history" note="Your medical records." disabled={!linked || uploadingKind('history')} onFiles={(files) => addFiles('history', files)} error={uploadErrors.history} />
          </div>
          <PlanLookup bare disabled={!linked} />
          <ul aria-label="Document status" aria-live="polite" className="mt-4 divide-y divide-line">
            {uploads.filter((item) => !item.hash || !documents.some((doc) => doc.fileHash === item.hash && doc.kind === item.kind)).map((item) => (
              <li key={`local-${item.id}`} className="py-3 text-[13px]">
                <div className="flex items-start gap-3"><FileText size={16} className="mt-0.5 shrink-0 text-ink-dim" aria-hidden="true" /><span className="min-w-0 flex-1 break-words">{item.file.name}</span><span className={item.status === 'failed' ? 'text-signal' : 'text-champagne'}>{item.status === 'uploading' ? 'Uploading' : item.status === 'failed' ? 'Failed' : 'Reading'}</span></div>
                {item.error && <p className="mt-2 break-words text-signal">{item.error}</p>}
                {item.status === 'failed' && <button type="button" disabled={!linked} className="mt-2 min-h-10 text-champagne underline underline-offset-4" onClick={() => void sendFile(item)}>Retry {item.file.name}</button>}
              </li>
            ))}
            {documents.map((doc) => {
              const local = uploads.find((item) => item.hash === doc.fileHash && item.kind === doc.kind)
              const name = local?.file.name ?? `${doc.kind === 'insurance' ? 'Insurance card' : 'Medical history'} · document ${doc.id}`
              return <li key={doc.id} className="py-3 text-[13px]">
                <div className="flex items-start gap-3"><FileText size={16} className="mt-0.5 shrink-0 text-ink-dim" aria-hidden="true" /><span className="min-w-0 flex-1 break-words">{name}</span><span className={doc.status === 'read' ? 'text-teal' : doc.status === 'failed' ? 'text-signal' : 'text-champagne'}>{doc.status === 'read' ? 'Read' : doc.status === 'failed' ? 'Failed' : 'Reading'}</span></div>
                {doc.dropped.length > 0 && <div className="mt-3 text-ink-dim"><p>Fields left out by the reader:</p><ul className="mt-1 list-disc pl-5">{doc.dropped.map((field, index) => <li key={index} className="break-words">{field}</li>)}</ul></div>}
                {doc.status === 'failed' && <button type="button" disabled={!linked || retrying.includes(doc.id)} className="mt-2 min-h-10 text-champagne underline underline-offset-4" onClick={() => void retryDocument(doc.id)}>{retrying.includes(doc.id) ? 'Retrying…' : `Retry ${name}`}</button>}
              </li>
            })}
          </ul>
        </Step>
        <Step sectionId="review-card" title="Review your card" note="Check what your documents told us.">
          {!session.medicalCardReady || !session.medicalDocumentsReady || outstanding ? <p role="status" className="mb-4 flex items-center gap-2 text-[14px] text-ink-dim"><LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> Still reading your documents.</p> : !medicalCard ? <p className="text-[14px] leading-6 text-ink-dim">Your medical and insurance details will appear here after you upload your documents.</p> : null}
          {session.medicalCardReady && medicalCard && <MedicalReview card={medicalCard} confirming={confirming} blocked={reviewBlocked} onConfirm={() => void confirm()} />}
        </Step>
        <Step sectionId="payment" title="Payment" note="Mock payment details for this demo.">
          <div className="signup-payment-fields">
            <div>
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
          <Button type="submit" className="signup-primary signup-save mt-6" disabled={saving || !linked || !confirmed}>{saving ? 'Saving…' : 'Save this band'}</Button>
          {!confirmed && <p className="mt-3 text-[13px] leading-5 text-ink-dim">Review your medical card to finish.</p>}
        </Step>
      </form>
      <p className="signup-privacy"><ShieldCheck size={16} aria-hidden="true" /> Documents are read for your medical card. File contents stay out of this browser’s saved registration.</p>
    </main>
  )
}

function WalletStatus() {
  const wallet = useSession((state) => state.wallet)
  const error = useSession((state) => state.walletError)
  return <p role="status" className="mt-4 break-words text-[13px] leading-5 text-ink-dim">{wallet ? `Wallet account ${wallet.accountId}` : error ? `Wallet pending: ${error} Your registration can still be saved.` : 'Your wallet account will appear here when it opens. It won’t hold up registration.'}</p>
}

export function RegisterPage({ viewBandId }: { viewBandId?: number } = {}) {
  const [lights, setLights] = useState(true)
  const { search } = useRoute()
  const band = viewBandId != null && isViewing() ? { deviceId: `band-${viewBandId}`, label: String(viewBandId) } : bandFromLocation(search)
  const medic = useMedicOnBand(band ? Number(band.label) : null)
  const fromLink = bandIdFromSearch(search)
  useEffect(() => {
    if (!isViewing() && fromLink != null) rememberBand(fromLink)
  }, [fromLink])
  const known = useSession((s) => nightKnown(s.eventReady, s.departureReady, s.recapViewErrors.my_departure))
  const over = useSession((s) => nightIsOver(s.eventEnded, s.departure?.leftAt))
  const bandPage = !known ? (
    <div className="signup-tap" role="status">
      <h1 className="signup-title">Opening your band…</h1>
      <p className="mt-5 text-[16px] leading-7 text-ink-dim">Checking whether the night has ended.</p>
    </div>
  ) : over ? <main className="wallet-main"><Recap showWalletLink /></main>
    : band && medic.show ? <main className="signup-main"><MedicTap bandId={Number(band.label)} /></main>
    : band ? <RegistrationForm key={band.deviceId} band={band} /> : (
      <div className="signup-tap">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-line bg-raised"><Waves size={30} strokeWidth={1.25} className="text-champagne" aria-hidden="true" /></div>
        <h1 className="signup-title mt-8">Your wristband opens this page.</h1>
        <p className="mt-5 text-[16px] leading-7 text-ink-dim">Tap it with your phone. The tag is that band’s link, so this page connects on its own.</p>
      </div>
    )
  return (
    <div data-page data-motif="signup" data-lights={lights ? 'on' : 'off'} className="desk-night signup-page h-full overflow-y-auto bg-ground text-ink">
      <ConcertLights enabled={lights} />
      <div className="signup-shell">
        <NightHeader lights={lights} onToggleLights={() => setLights((current) => !current)} />
        {bandPage}
      </div>
    </div>
  )
}
