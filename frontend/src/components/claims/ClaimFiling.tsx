import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { askRecoveryLetter, fileClaim, retryPayout, submitClinicRecord, useDesk } from '@/stdb/deskOps'
import { useSession } from '@/stdb/session'

const field = 'h-10 w-full rounded-[4px] border border-line-strong bg-ground px-3 text-[14px] text-ink outline-none'

const REPORTS = [
  { value: 'matches', label: 'Matches' },
  { value: 'mismatch', label: "Doesn't match" },
  { value: 'random', label: 'Random' },
] as const

function stories(kind: string, zone: string): [string, string][] {
  return kind === 'sos'
    ? [
        ['Felt faint', `I felt faint and short of breath near the ${zone}, so I pressed the button on my band.`],
        ['Crushed at the barrier', `I got crushed against the barrier at the ${zone} and hurt my ribs, so I called for help with my band.`],
      ]
    : [
        ['Slipped on a drink', `I slipped on a spilled drink near the ${zone} and landed on my right wrist.`],
        ['Knocked over in the crowd', `Someone knocked into me in the crowd at the ${zone}. I fell and twisted my left ankle.`],
      ]
}

export function InjuryForm({ incidentId, kind, zone, name, onFiled }: { incidentId: string; kind: string; zone: string; name: string; onFiled?: () => void }) {
  const busy = useDesk((s) => s.busy)
  const [statement, setStatement] = useState('')
  const [report, setReport] = useState('random')
  const [problem, setProblem] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    try {
      await fileClaim(incidentId, statement, report)
      setStatement('')
      setProblem('')
      onFiled?.()
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : 'The claim was not filed.')
    }
  }
  return (
    <form onSubmit={(event) => void submit(event)} className="mt-3 flex flex-col gap-2">
      <label className="text-[13px] text-ink-dim">
        What happened, in their words
        <textarea aria-label={`What happened to ${name}`} value={statement} required rows={3} onChange={(event) => setStatement(event.target.value)} className={`${field} mt-1 py-2`} />
      </label>
      <p className="flex flex-wrap gap-3 text-[13px]">
        {stories(kind, zone || 'stage').map(([label, text]) => (
          <button key={label} type="button" className="text-ink-dim hover:text-ink" onClick={() => setStatement(text)}>{label}</button>
        ))}
      </p>
      <label className="text-[13px] text-ink-dim">
        Hospital report
        <select value={report} onChange={(event) => setReport(event.target.value)} className={`${field} mt-1`}>
          {REPORTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </label>
      <Button type="submit" variant="outline" className="h-9 w-fit px-3" disabled={busy}>{`File the claim as ${name}`}</Button>
      {problem && <p className="text-[13px] text-signal">{problem}</p>}
    </form>
  )
}

/** Clinic PDF, a claim filed for the wearer, a payout retry, and a recovery letter. */
export function ClaimFiling({ claimId }: { claimId: string }) {
  const roles = useSession((s) => s.roles)
  const owner = useSession((s) => s.owner)
  const injuries = useDesk((s) => s.injuries)
  const filed = useDesk((s) => s.filed)
  const busy = useDesk((s) => s.busy)
  const claim = filed.find((item) => item.id === claimId)
  const error = useDesk((s) => s.error)
  const [file, setFile] = useState<File | null>(null)
  const [handler, setHandler] = useState('')
  const [contact, setContact] = useState('')
  const [problem, setProblem] = useState('')
  const [asked, setAsked] = useState(false)
  const canFile = owner || roles.includes('ops') || roles.includes('medic')
  const canOps = owner || roles.includes('ops')
  const payoutFailed = claim?.status === 'Paying' && /payout failed/i.test(claim.statusNote)
  const recover = claim?.coverKind === 'property' && (claim.status === 'Settled' || claim.status === 'Reconciled')
  const letters = claim
    ? [
        [claim.fnolHash, 'First notice of loss'],
        [claim.summaryHash, 'Approver summary'],
        [claim.determinationHash, 'Claimant letter'],
        [claim.recoveryHash, 'Recovery letter'],
      ].filter(([hash]) => hash)
    : []

  if (!canFile) return null

  return (
    <div className="mt-8 flex flex-col gap-8">
      <section aria-labelledby="injuries-open">
        <h2 id="injuries-open" className="text-[15px] font-semibold text-ink">{`Injuries without a claim (${injuries.length})`}</h2>
        {injuries.length === 0 ? (
          <p className="mt-2 text-[14px] text-ink-dim">None right now. A resolved fall or SOS shows here until someone files it.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-6">
            {injuries.map((injury) => (
              <li key={injury.incidentId}>
                <p className="text-[14px] text-ink">
                  {`${injury.wearerName || 'The wearer'}, band ${injury.bandId}: ${injury.kind === 'sos' ? 'SOS' : 'fall'} in ${injury.zoneName || 'the venue'}`}
                </p>
                <InjuryForm incidentId={injury.incidentId} kind={injury.kind} zone={injury.zoneName} name={injury.wearerName || 'the wearer'} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {claim?.status === 'AwaitingRecord' && (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (!file) {
              setProblem('Choose the clinic PDF.')
              return
            }
            setProblem('')
            void submitClinicRecord(claim.id, file).then(() => setFile(null)).catch((reason: unknown) => {
              setProblem(reason instanceof Error ? reason.message : 'The clinic report was not filed.')
            })
          }}
        >
          <h3 className="text-[15px] font-semibold text-ink">Upload the clinic&apos;s report</h3>
          <input aria-label="Clinic report PDF" type="file" accept="application/pdf" className="mt-3 text-[13px] text-ink" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          <Button type="submit" variant="outline" className="mt-3 h-9 px-3" disabled={busy}>Upload it, the Evidence Engine reads it</Button>
        </form>
      )}

      {letters.length > 0 && (
        <div>
          <h3 className="text-[15px] font-semibold text-ink">Letters</h3>
          <ul className="mt-2 flex flex-col gap-1 text-[14px]">
            {letters.map(([hash, label]) => (
              <li key={label}><a href={`/blobs/${hash}`} target="_blank" rel="noreferrer" className="text-ink underline-offset-4 hover:underline">{label}</a></li>
            ))}
          </ul>
        </div>
      )}

      {canOps && payoutFailed && (
        <Button type="button" variant="outline" className="h-9 w-fit px-3" disabled={busy} onClick={() => void retryPayout(claim.id).catch(() => undefined)}>
          Retry the payout
        </Button>
      )}

      {canOps && recover && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            setProblem('')
            void askRecoveryLetter(claim.id, handler, contact).then(() => {
              setAsked(true)
              setHandler('')
              setContact('')
            }).catch((reason: unknown) => {
              setProblem(reason instanceof Error ? reason.message : 'The letter was not requested.')
            })
          }}
        >
          <h3 className="text-[15px] font-semibold text-ink">Ask for a recovery letter</h3>
          <input aria-label="Who was handling the equipment" value={handler} required onChange={(event) => setHandler(event.target.value)} placeholder="Who was handling the equipment" className={field} />
          <input aria-label="Their contact" value={contact} required onChange={(event) => setContact(event.target.value)} placeholder="Email or phone" className={field} />
          <Button type="submit" variant="outline" className="h-9 w-fit px-3" disabled={busy}>Ask for the letter</Button>
          {asked && !claim.recoveryHash && <p className="text-[13px] text-ink-dim">Asked. The letter shows under Letters once it is drafted.</p>}
        </form>
      )}
      {problem && <p className="text-[13px] text-signal">{problem}</p>}
      {error && <p className="text-[13px] text-signal">{error}</p>}
    </div>
  )
}
