import { useEffect, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { CoverSlip } from '@/components/cover/CoverSlip'
import { MOCK_BANDS } from '@/mock/bands'
import { fieldClass } from '@/cover/fields'
import { blankRegistration, getRegistration, saveRegistration, type Registration } from '@/cover/registry'
import { useRoute } from '@/cover/route'
import { useSession } from '@/stdb/session'

const BLOOD = ['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'Unknown']
const BRANDS = ['Visa', 'Mastercard', 'Amex']

function bandFromLocation() {
  const id = new URLSearchParams(window.location.search).get('band')
  if (id && MOCK_BANDS.some((band) => band.deviceId === id)) return id
  return 'band-01'
}

function NightHeader() {
  const { go } = useRoute()
  return (
    <header className="flex flex-wrap items-baseline justify-between gap-4">
      <button type="button" onClick={() => go('/join')} className="font-display text-[30px] leading-none text-ink">
        BandIt
      </button>
      <nav aria-label="Night" className="flex items-baseline gap-5 text-[14px]">
        <button type="button" onClick={() => go('/')} className="text-ink-dim hover:text-ink">
          Map
        </button>
        <button type="button" onClick={() => go('/claims')} className="text-ink-dim hover:text-ink">
          Claims
        </button>
      </nav>
    </header>
  )
}

function errorsFor(draft: Registration): Record<string, string> {
  const errors: Record<string, string> = {}
  if (!draft.name.trim()) errors.name = 'Name the person wearing it.'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())) errors.email = 'Use an email address.'
  if (!draft.bloodType) errors.bloodType = 'Choose a blood type.'
  if (!draft.allergies.trim()) errors.allergies = 'Say what they are, or write None.'
  if (!draft.conditions.trim()) errors.conditions = 'Say what they are, or write None.'
  if (!draft.medications.trim()) errors.medications = 'Say what they take, or write None.'
  if (!draft.emergencyName.trim()) errors.emergencyName = 'Name someone to call.'
  if (!draft.emergencyPhone.trim()) errors.emergencyPhone = 'Give a phone number.'
  if (!draft.carrier.trim()) errors.carrier = 'Name the carrier.'
  if (!draft.memberId.trim()) errors.memberId = 'Give the member id.'
  if (!draft.groupId.trim()) errors.groupId = 'Give the group.'
  if (!/^\d{4}$/.test(draft.last4.trim())) errors.last4 = 'Last four is four digits.'
  if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(draft.exp.trim())) errors.exp = 'Use MM/YY, like 09/28.'
  return errors
}

function Field({
  id,
  label,
  value,
  onChange,
  error,
  type = 'text',
  autoComplete,
  inputMode,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  error?: string
  type?: string
  autoComplete?: string
  inputMode?: 'text' | 'email' | 'tel' | 'numeric'
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-[14px] font-medium text-ink">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        autoComplete={autoComplete}
        inputMode={inputMode}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => onChange(event.target.value)}
        className={fieldClass}
      />
      {error && (
        <p id={`${id}-error`} className="mt-1.5 text-[13px] text-signal">
          {error}
        </p>
      )}
    </div>
  )
}

export function RegisterPage() {
  const { go } = useRoute()
  const [bandId, setBandId] = useState(bandFromLocation)
  const [draft, setDraft] = useState<Registration>(() => getRegistration(bandFromLocation()) ?? blankRegistration(bandFromLocation()))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState<Registration | null>(null)
  const [saving, setSaving] = useState(false)
  const registerBand = useSession((state) => state.registerBand)
  const band = MOCK_BANDS.find((item) => item.deviceId === bandId)
  const label = band?.label ?? bandId.replace(/^band-/, '')
  const existing = getRegistration(bandId)

  useEffect(() => {
    const next = `/register?band=${bandId}`
    if (`${window.location.pathname}${window.location.search}` !== next) window.history.replaceState(null, '', next)
  }, [bandId])

  const set = (key: keyof Registration) => (value: string) => setDraft((current) => ({ ...current, [key]: value }))

  const chooseBand = (id: string) => {
    setBandId(id)
    setDraft(getRegistration(id) ?? blankRegistration(id))
    setErrors({})
    setSaved(null)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void save()
  }

  const save = async () => {
    const next = {
      ...draft,
      bandId,
      name: draft.name.trim(),
      email: draft.email.trim(),
      allergies: draft.allergies.trim(),
      conditions: draft.conditions.trim(),
      medications: draft.medications.trim(),
      emergencyName: draft.emergencyName.trim(),
      emergencyPhone: draft.emergencyPhone.trim(),
      carrier: draft.carrier.trim(),
      memberId: draft.memberId.trim(),
      groupId: draft.groupId.trim(),
      last4: draft.last4.trim(),
      exp: draft.exp.trim(),
    }
    const found = errorsFor(next)
    setErrors(found)
    if (Object.keys(found).length > 0) return
    setSaving(true)
    try {
      await registerBand(`BANDIT-${label}`, next.name)
    } catch (error) {
      setSaving(false)
      setErrors({ form: error instanceof Error ? error.message : 'The database refused the band.' })
      return
    }
    setSaving(false)
    saveRegistration(next)
    setDraft(next)
    setSaved(next)
  }

  return (
    <div data-page className="h-full overflow-y-auto bg-ground text-ink">
      <div className="mx-auto w-full max-w-[1200px] px-5 py-6 md:px-10 md:py-8">
        <NightHeader />
        {saved ? (
          <div className="mt-14 grid items-start gap-12 md:mt-20 md:grid-cols-2">
            <div>
              <h1 className="font-display text-[clamp(36px,4vw,56px)] leading-[0.98] tracking-[-0.02em] text-ink">{`Saved on band ${label}.`}</h1>
              <p className="mt-5 max-w-[40ch] text-[16px] leading-7 text-ink">
                {`BANDIT-${label} is waiting for its button. Your name is on the database, and the wallet is opening. The medical card fills when its documents are read.`}
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-5">
                <Button type="button" className="h-11 px-4" onClick={() => setSaved(null)}>
                  Edit this band
                </Button>
                <button type="button" onClick={() => go('/claims')} className="text-[14px] text-ink">
                  Claims desk
                </button>
              </div>
            </div>
            <CoverSlip registration={saved} bandLabel={label} />
          </div>
        ) : (
          <form onSubmit={submit} className="mt-14 md:mt-20" noValidate>
            <h1 className="font-display text-[clamp(36px,4vw,56px)] leading-[0.98] tracking-[-0.02em] text-ink">Register this band.</h1>
            <p className="mt-5 max-w-[46ch] text-[16px] leading-7 text-ink">
              Claiming the band, your name, and the wallet go to the database. Press the button on the band to finish. The medical card is read from the documents, not from these boxes.
            </p>
            {errors.form && <p className="mt-4 text-[14px] text-signal">{errors.form}</p>}
            <div className="mt-12 grid items-start gap-x-16 gap-y-12 md:grid-cols-2">
              <div className="flex flex-col gap-4">
                <h2 className="font-display text-[28px] leading-none text-ink">Person</h2>
                <div>
                  <label htmlFor="band" className="mb-2 block text-[14px] font-medium text-ink">
                    Band
                  </label>
                  <select id="band" value={bandId} onChange={(event) => chooseBand(event.target.value)} className={fieldClass}>
                    {MOCK_BANDS.map((item) => {
                      const stored = getRegistration(item.deviceId)
                      const who = stored?.name || item.wearer || 'Empty'
                      return (
                        <option key={item.deviceId} value={item.deviceId}>
                          Band {item.label} · {who}
                        </option>
                      )
                    })}
                  </select>
                  {existing && <p className="mt-2 text-[13px] text-ink-dim">Saving replaces the record already on this band.</p>}
                </div>
                <Field id="name" label="Name" value={draft.name} onChange={set('name')} error={errors.name} autoComplete="name" />
                <Field id="email" label="Email" type="email" value={draft.email} onChange={set('email')} error={errors.email} autoComplete="email" inputMode="email" />
                <h2 className="mt-8 font-display text-[28px] leading-none text-ink">Medical</h2>
                <div>
                  <label htmlFor="blood" className="mb-2 block text-[14px] font-medium text-ink">
                    Blood type
                  </label>
                  <select
                    id="blood"
                    value={draft.bloodType}
                    aria-invalid={errors.bloodType ? true : undefined}
                    aria-describedby={errors.bloodType ? 'blood-error' : undefined}
                    onChange={(event) => set('bloodType')(event.target.value)}
                    className={fieldClass}
                  >
                    <option value="">Choose</option>
                    {BLOOD.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                  {errors.bloodType && (
                    <p id="blood-error" className="mt-1.5 text-[13px] text-signal">
                      {errors.bloodType}
                    </p>
                  )}
                </div>
                <Field id="allergies" label="Allergies" value={draft.allergies} onChange={set('allergies')} error={errors.allergies} />
                <Field id="conditions" label="Conditions" value={draft.conditions} onChange={set('conditions')} error={errors.conditions} />
                <Field id="medications" label="Medications" value={draft.medications} onChange={set('medications')} error={errors.medications} />
                <Field id="emergency-name" label="Emergency contact" value={draft.emergencyName} onChange={set('emergencyName')} error={errors.emergencyName} autoComplete="name" />
                <Field id="emergency-phone" label="Emergency phone" type="tel" value={draft.emergencyPhone} onChange={set('emergencyPhone')} error={errors.emergencyPhone} autoComplete="tel" inputMode="tel" />
              </div>

              <div className="flex flex-col gap-4">
                <h2 className="font-display text-[28px] leading-none text-ink">Insurance</h2>
                <Field id="carrier" label="Carrier" value={draft.carrier} onChange={set('carrier')} error={errors.carrier} />
                <Field id="member" label="Member id" value={draft.memberId} onChange={set('memberId')} error={errors.memberId} />
                <Field id="group" label="Group" value={draft.groupId} onChange={set('groupId')} error={errors.groupId} />
                <h2 className="mt-8 font-display text-[28px] leading-none text-ink">Payment</h2>
                <div>
                  <label htmlFor="brand" className="mb-2 block text-[14px] font-medium text-ink">
                    Card
                  </label>
                  <select id="brand" value={draft.cardBrand} onChange={(event) => set('cardBrand')(event.target.value)} className={fieldClass}>
                    {BRANDS.map((brand) => (
                      <option key={brand} value={brand}>
                        {brand}
                      </option>
                    ))}
                  </select>
                </div>
                <Field id="last4" label="Last four" value={draft.last4} onChange={set('last4')} error={errors.last4} inputMode="numeric" autoComplete="off" />
                <Field id="exp" label="Expiry" value={draft.exp} onChange={set('exp')} error={errors.exp} autoComplete="off" />
                <p className="text-[13px] leading-5 text-ink-dim">Last four only. The full number never lands here.</p>
                <Button type="submit" className="mt-2 h-11 self-start px-4" disabled={saving}>
                  {saving ? 'Saving' : 'Save this band'}
                </Button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
