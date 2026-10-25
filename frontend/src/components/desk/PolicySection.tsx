import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { formatCents } from '@/cover/money'
import { confirmPolicy, lookUpPolicy, submitPolicyFile, useDesk, type PolicyTerm } from '@/stdb/deskOps'

const field = 'h-9 w-full rounded-[4px] border border-line-strong bg-ground px-3 text-[14px] text-ink outline-none placeholder:text-ink-muted'

const LOOKUP_STATUS: Record<string, string> = {
  searching: 'Searching',
  found: 'Found',
  not_found: 'Not found',
  wrong_form: 'Wrong form',
  failed: 'Failed',
}

const TERM_LABEL: Record<string, string> = {
  insurer: 'Insurer',
  policy_number: 'Policy number',
  period: 'Period',
  fnol_contact: 'Claims contact',
  per_claim_limit: 'Per-claim limit',
  aggregate_limit: 'Aggregate limit',
  deductible: 'Deductible',
  minimum_payout: 'Minimum payout',
  service_window_days: 'Service window',
  exclusion: 'Exclusion',
  fee_cap: 'Fee cap',
}

function centsOf(value: string, allowZero: boolean): bigint | null {
  const trimmed = value.trim()
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null
  const [dollars, fraction = ''] = trimmed.split('.')
  const cents = Number(dollars) * 100 + Number(fraction.padEnd(2, '0'))
  if (!Number.isInteger(cents) || cents < (allowZero ? 0 : 1)) return null
  return BigInt(cents)
}

function termLabel(term: PolicyTerm): string {
  if (term.name === 'fee_cap') return `${term.code} ${term.readValue}`.trim()
  return TERM_LABEL[term.name] ?? term.name.replaceAll('_', ' ')
}

function day(ms: number): string {
  if (!ms) return ''
  return new Date(ms).toLocaleDateString('en-CA')
}

/** Upload the venue policy, look the forms up, and confirm the terms that were read. */
export function PolicySection() {
  const documents = useDesk((s) => s.documents)
  const terms = useDesk((s) => s.terms)
  const lookups = useDesk((s) => s.lookups)
  const covers = useDesk((s) => s.covers)
  const policy = useDesk((s) => s.policy)
  const error = useDesk((s) => s.error)
  const busy = useDesk((s) => s.busy)
  const [file, setFile] = useState<File | null>(null)
  const [formError, setFormError] = useState('')
  const shown = documents.find((doc) => doc.status === 'read' || doc.status === 'confirmed')
  const shownTerms = shown ? terms.filter((term) => term.documentId === shown.id) : []
  const policyCovers = policy ? covers.filter((cover) => cover.policyId === policy.id) : []

  const upload = async (event: FormEvent) => {
    event.preventDefault()
    if (!file) {
      setFormError('Choose the policy PDF.')
      return
    }
    setFormError('')
    try {
      await submitPolicyFile(file)
      setFile(null)
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : 'The policy could not be uploaded.')
    }
  }

  const lookup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const read = (name: string) => String(data.get(name) ?? '')
    const medical = centsOf(read('medical_limit'), false)
    const aggregate = centsOf(read('medical_aggregate'), false)
    const propertyLimit = centsOf(read('property_limit'), false)
    const deductible = centsOf(read('property_deductible'), true)
    if (medical == null || aggregate == null || propertyLimit == null || deductible == null) {
      setFormError('Limits are in dollars, for example 10000. The deductible can be 0.')
      return
    }
    setFormError('')
    try {
      await lookUpPolicy({
        insurer: read('insurer'),
        state: read('state'),
        liabilityForm: read('liability_form'),
        propertyForm: read('property_form'),
        policyNumber: read('policy_number'),
        fnolContact: read('fnol_contact'),
        periodStart: read('period_start'),
        periodEnd: read('period_end'),
        medicalLimitCents: medical,
        medicalAggregateCents: aggregate,
        propertyLimitCents: propertyLimit,
        propertyDeductibleCents: deductible,
      })
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : 'The lookup did not start.')
    }
  }

  return (
    <section aria-labelledby="venue-policy" className="mt-16">
      <h2 id="venue-policy" className="text-[20px] font-semibold text-ink">Insurance policy</h2>
      <p className="mt-2 max-w-[62ch] text-[14px] leading-6 text-ink-dim">
        Upload the venue&apos;s insurance policy PDF. Each term is read with its quote and page, then checked. Until you confirm the terms, claims use the defaults.
      </p>
      <form onSubmit={(event) => void upload(event)} className="mt-5 flex flex-wrap items-center gap-3">
        <input
          aria-label="Policy PDF"
          type="file"
          accept="application/pdf"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          className="text-[13px] text-ink"
        />
        <Button type="submit" variant="outline" className="h-9 px-3" disabled={busy}>Upload and read</Button>
      </form>

      <h3 className="mt-10 text-[15px] font-semibold text-ink">Or find the policy online</h3>
      <p className="mt-2 max-w-[62ch] text-[13px] leading-5 text-ink-dim">
        Name the insurer and the two forms on the declarations page, then type the declarations. Both forms are read like an upload.
      </p>
      <form onSubmit={(event) => void lookup(event)} className="mt-4 grid max-w-xl gap-3">
        <label className="text-[13px] text-ink-dim">Insurer<input name="insurer" required maxLength={80} placeholder="Harborline Casualty" className={`${field} mt-1`} /></label>
        <label className="text-[13px] text-ink-dim">Venue&apos;s state<input name="state" required maxLength={2} placeholder="CA" className={`${field} mt-1`} /></label>
        <label className="text-[13px] text-ink-dim">Liability form number<input name="liability_form" required maxLength={24} placeholder="CG 00 01 04 13" className={`${field} mt-1`} /></label>
        <label className="text-[13px] text-ink-dim">Property form number<input name="property_form" required maxLength={24} placeholder="CP 00 10 10 12" className={`${field} mt-1`} /></label>
        <label className="text-[13px] text-ink-dim">Policy number<input name="policy_number" required maxLength={60} className={`${field} mt-1`} /></label>
        <label className="text-[13px] text-ink-dim">Policy period starts<input name="period_start" type="date" required className={`${field} mt-1`} /></label>
        <label className="text-[13px] text-ink-dim">Policy period ends<input name="period_end" type="date" required className={`${field} mt-1`} /></label>
        <label className="text-[13px] text-ink-dim">Report claims to<input name="fnol_contact" required maxLength={120} className={`${field} mt-1`} /></label>
        <label className="text-[13px] text-ink-dim">Medical expense limit, any one person ($)<input name="medical_limit" required inputMode="decimal" className={`${field} mt-1`} /></label>
        <label className="text-[13px] text-ink-dim">General aggregate limit ($)<input name="medical_aggregate" required inputMode="decimal" className={`${field} mt-1`} /></label>
        <label className="text-[13px] text-ink-dim">Property limit of insurance ($)<input name="property_limit" required inputMode="decimal" className={`${field} mt-1`} /></label>
        <label className="text-[13px] text-ink-dim">Property deductible ($)<input name="property_deductible" required inputMode="decimal" className={`${field} mt-1`} /></label>
        <Button type="submit" variant="outline" className="h-9 w-fit px-3" disabled={busy}>Find the policy online</Button>
      </form>
      {(formError || error) && <p className="mt-3 text-[14px] text-signal">{formError || error}</p>}

      {lookups.length > 0 && (
        <>
          <h3 className="mt-10 text-[15px] font-semibold text-ink">{`Looked up (${lookups.length})`}</h3>
          <ul className="mt-3 flex flex-col gap-4">
            {lookups.map((lookup) => (
              <li key={lookup.id} className="text-[14px] leading-6 text-ink">
                <p>{`${lookup.insurer}, ${lookup.liabilityForm} and ${lookup.propertyForm}, policy ${lookup.policyNumber}. ${LOOKUP_STATUS[lookup.status] ?? lookup.status}`}</p>
                {lookup.forms.length > 0 && (
                  <ul className="mt-1 text-[13px] text-ink-dim">
                    {lookup.forms.map((form) => (
                      <li key={`${lookup.id}-${form.part}-${form.formNumber}`}>
                        <a href={form.url} target="_blank" rel="noreferrer" className="text-ink underline-offset-4 hover:underline">
                          {`${form.part === 'liability' ? 'Liability' : 'Property'} form ${form.formNumber}${form.title ? ` ${form.title}` : ''}`}
                        </a>
                        {`, pages ${form.firstPage} to ${form.firstPage + Math.max(form.pageCount - 1, 0)}`}
                      </li>
                    ))}
                  </ul>
                )}
                {(lookup.status === 'not_found' || lookup.status === 'wrong_form') && (
                  <p className="text-[13px] text-signal">We couldn&apos;t find the policy&apos;s forms online. Upload the policy instead.</p>
                )}
                {lookup.note && <p className="text-[13px] text-ink-dim">{lookup.note}</p>}
              </li>
            ))}
          </ul>
        </>
      )}

      {documents.length > 0 && (
        <>
          <h3 className="mt-10 text-[15px] font-semibold text-ink">{`Policy PDFs (${documents.length})`}</h3>
          <ul className="mt-3 flex flex-col gap-2 text-[14px] text-ink">
            {documents.map((doc) => (
              <li key={doc.id}>
                <a href={`/blobs/${doc.fileHash}`} target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline">{`Policy PDF, ${doc.pageCount} pages`}</a>
                {` · ${doc.source === 'policy_lookup' ? 'found online' : 'uploaded'} · ${doc.status}`}
                {doc.error && <span className="text-signal">{` · ${doc.error}`}</span>}
              </li>
            ))}
          </ul>
        </>
      )}

      {shown && shownTerms.length > 0 && (
        <>
          <h3 className="mt-10 text-[15px] font-semibold text-ink">Terms read from the policy</h3>
          <ul className="mt-3 divide-y divide-line">
            {shownTerms.map((term) => (
              <li key={term.id} className="grid gap-1 py-3 sm:grid-cols-[12rem_1fr]">
                <p className="text-[13px] text-ink-dim">{termLabel(term)}</p>
                <p className="text-[14px] text-ink">
                  {term.shown || term.readValue}
                  <span className="text-ink-dim">{` · ${term.status}${term.page ? ` · page ${term.page}` : ''}`}</span>
                  {term.quote && <span className="mt-1 block text-[13px] text-ink-dim">{term.quote}</span>}
                  {term.problem && <span className="mt-1 block text-[13px] text-signal">{term.problem}</span>}
                </p>
              </li>
            ))}
          </ul>
          {shown.status === 'read' && (
            <Button type="button" variant="outline" className="mt-4 h-9 px-3" disabled={busy} onClick={() => void confirmPolicy(shown.id)}>
              Use these terms for the event
            </Button>
          )}
        </>
      )}

      <h3 className="mt-10 text-[15px] font-semibold text-ink">In effect now</h3>
      {!policy ? (
        <p className="mt-2 text-[14px] text-ink-dim">No policy in effect yet.</p>
      ) : (
        <>
          <p className="mt-2 text-[14px] leading-6 text-ink">
            {`Policy ${policy.policyNumber} with ${policy.insurerName || 'the insurer'}.`}
            {policy.periodChecked ? ` Period ${day(policy.periodStart)} to ${day(policy.periodEnd)}.` : ' Period not stated, so not checked.'}
            {policy.fnolContact ? ` Claims reported to ${policy.fnolContact}.` : ''}
            {policy.staffExcluded ? ' Employees and volunteers are excluded.' : ''}
          </p>
          {policyCovers.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1 text-[14px] text-ink">
              {policyCovers.map((cover) => (
                <li key={`${cover.policyId}-${cover.coverKind}`}>
                  {`${cover.coverKind === 'medical_payments' ? 'Medical payments' : cover.coverKind === 'property' ? 'Property' : cover.coverKind}: ${formatCents(cover.perClaimLimitCents)} per claim, ${formatCents(cover.aggregateLimitCents)} aggregate, ${formatCents(cover.deductibleCents)} deductible`}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
