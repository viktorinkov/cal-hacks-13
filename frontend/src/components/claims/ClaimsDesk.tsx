import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Button } from '@/components/ui/button'
import { DeskTabs } from '@/components/desk/DeskTabs'
import { useOperatorName } from '@/stdb/operatorName'
import { BandTapDialog } from '@/components/cover/BandTapDialog'
import { boardSummary, checkTone, sortBoard, statusLabel, type BoardClaim } from '@/cover/liveClaims'
import { formatCents } from '@/cover/money'
import { useRoute } from '@/cover/route'
import { cn } from '@/lib/utils'
import { ClaimExtras } from '@/components/claims/ClaimExtras'
import { ClaimFiling } from '@/components/claims/ClaimFiling'
import { useSession } from '@/stdb/session'

/**
 * Claims desk. The rows are the database's claims board. A routed claim still needs
 * the person it was sent to. Approving calls approve_claim; refusing calls refuse_claim.
 */
export function ClaimsDesk() {
  const { go, search } = useRoute()
  const phase = useSession((state) => state.phase)
  const actionError = useSession((state) => state.actionError)
  const owner = useSession((state) => state.owner)
  const me = useSession((state) => state.me)
  const roles = useSession((state) => state.roles)
  const insurer = useSession((state) => state.insurer)
  const claims = useSession((state) => state.claims)
  const actors = useSession((state) => state.actors)
  const busy = useSession((state) => state.busy)
  const approve = useSession((state) => state.approve)
  const refuse = useSession((state) => state.refuse)
  const ordered = useMemo(() => sortBoard(claims), [claims])
  const summary = useMemo(() => boardSummary(claims), [claims])
  const [selectedId, setSelectedId] = useState(() => new URLSearchParams(search).get('claim') ?? '')
  const [narrow, setNarrow] = useState(false)
  const [tapBand, setTapBand] = useState<number | null>(null)
  const docketRef = useRef<HTMLElement>(null)
  const selected = selectedId ? ordered.find((claim) => claim.id === selectedId) : ordered[0]
  const operator = useOperatorName()

  useEffect(() => {
    if (!narrow || !window.matchMedia('(max-width: 767px)').matches) return
    docketRef.current?.scrollIntoView({ block: 'start' })
  }, [narrow, selected?.id])

  const choose = (id: string) => {
    setSelectedId(id)
    setNarrow(true)
  }

  return (
    <div data-page data-motif="claims" className="desk-night h-full overflow-y-auto bg-ground text-ink">
      <div className="mx-auto w-full max-w-[1360px] px-5 py-6 md:px-10 md:py-8">
        <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="font-display text-[30px] leading-none text-ink">BandIt</span>
            <DeskTabs />
          </div>
          {operator && <span className="text-[13px] text-ink-muted">· operator {operator}</span>}
        </header>

        <div className="mt-8 flex flex-wrap items-baseline gap-x-5 gap-y-2 text-[13px] text-ink-dim">
          <ActorSelect actors={actors} />
          <button type="button" onClick={() => go('/join')} className="hover:text-champagne">
            Wristbands
          </button>
        </div>

        <div className="desk-figures mt-8 grid grid-cols-2 gap-x-6 gap-y-6 md:grid-cols-4">
          <Figure label="Needs a person" value={String(summary.waiting)} note={summary.detections === 0 ? 'nothing routed' : `of ${summary.detections} claims`} lead />
          <Figure label="Unfiled" value={formatCents(summary.unfiledCents)} note="still on the board" />
          <Figure label="Filed" value={formatCents(summary.filedCents)} note={`with ${insurer}`} />
          <Figure label="Damage seen" value={formatCents(summary.damageCents)} note={`across ${summary.detections} claims`} />
        </div>

        {actionError && <p className="mt-6 text-[14px] text-signal">{actionError}</p>}

        <div className="mt-10 grid items-start gap-6 md:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)]">
          <div className={cn(narrow && 'hidden md:block')}>
            <div className="grid grid-cols-[4.75rem_minmax(0,1fr)_auto] gap-x-3 text-[13px] text-ink-dim">
              <span>Claim</span>
              <span>What happened</span>
              <span className="text-right">Payable</span>
            </div>
            {ordered.length === 0 ? (
              <p className="mt-4 text-[14px] text-ink">{phase === 'live' ? 'No claims on this connection.' : 'Waiting for the board.'}</p>
            ) : (
              <ul className="mt-1" aria-label="Claims">
                {ordered.map((claim) => (
                  <li key={claim.id}>
                    <ClaimRow claim={claim} selected={claim.id === selected?.id} onChoose={() => choose(claim.id)} />
                  </li>
                ))}
              </ul>
            )}
          </div>

          {selected && (
            <div>
              <Docket
              claim={selected}
              narrow={narrow}
              busy={busy}
              canDecide={decides(selected, { owner, me, roles })}
              docketRef={docketRef}
              onBack={() => setNarrow(false)}
              onApprove={() => void approve(selected.id)}
              onRefuse={(reason) => void refuse(selected.id, reason)}
              onRead={(bandId) => setTapBand(bandId)}
            />
              <ClaimFiling claimId={selected.id} />
            </div>
          )}
        </div>
      </div>
      {tapBand != null && <BandTapDialog deviceId={`band-${String(tapBand).padStart(2, '0')}`} bandNumber={tapBand} onClose={() => setTapBand(null)} />}
    </div>
  )
}

function decides(claim: BoardClaim, who: { owner: boolean; me: string; roles: string[] }) {
  if (claim.status !== 'Routed') return false
  if (who.owner) return true
  const unassigned = claim.routedTo === '' || /^0+$/.test(claim.routedTo)
  if (!unassigned && claim.routedTo === who.me) return true
  return unassigned && who.roles.includes(claim.routedToRole)
}

function ActorSelect({ actors }: { actors: { name: string; label: string }[] }) {
  if (actors.length === 0) return null
  const current = new URLSearchParams(window.location.search).get('as') ?? ''
  const label = actors.find((actor) => actor.name === current)?.label ?? 'this browser'
  return (
    <label className="flex items-baseline gap-2">
      <span>Play as</span>
      <select
        aria-label="Play as"
        value={current}
        onChange={(event) => {
          const url = new URL(window.location.href)
          if (event.target.value) url.searchParams.set('as', event.target.value)
          else url.searchParams.delete('as')
          window.location.assign(url)
        }}
        style={{ width: `${label.length + 1}ch` }}
        className="cursor-pointer appearance-none bg-transparent text-ink outline-none"
      >
        <option value="">this browser</option>
        {actors.map((actor) => (
          <option key={actor.name} value={actor.name}>
            {actor.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function Figure({ label, value, note, lead = false }: { label: string; value: string; note: string; lead?: boolean }) {
  return (
    <div className="md:px-6 md:first:pl-0 md:last:pr-0">
      <p className="text-[13px] text-ink-dim">{label}</p>
      <p className={cn('mt-1 flex h-9 items-end tabular-nums leading-none text-ink', lead ? 'text-[32px]' : 'text-[22px]')}>{value}</p>
      <p className="mt-2 text-[13px] text-ink-dim">{note}</p>
    </div>
  )
}

function ClaimRow({ claim, selected, onChoose }: { claim: BoardClaim; selected: boolean; onChoose: () => void }) {
  const who = claim.claimantName || (claim.bandId ? `band ${claim.bandId}` : 'no claimant')
  const note = `${claim.zoneName} · ${claim.openedAt} · ${who} · ${statusLabel(claim.status)}`
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onChoose}
      className="desk-row grid w-full grid-cols-[4.75rem_minmax(0,1fr)_auto] items-baseline gap-x-3 py-3 text-left"
    >
      <span className="relative font-mono text-[13px] text-ink">
        {claim.id}
        {selected && <span aria-hidden className="absolute -bottom-1 left-0 right-0 h-px bg-champagne" />}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[14px] text-ink">{claim.incidentKind}</span>
        <span className="mt-1 block truncate text-[13px] text-ink-dim" title={note}>
          {note}
        </span>
      </span>
      <span className="tabular-nums text-[14px] text-ink">{formatCents(claim.payoutCents)}</span>
    </button>
  )
}

function Docket({
  claim,
  narrow,
  busy,
  canDecide,
  docketRef,
  onBack,
  onApprove,
  onRefuse,
  onRead,
}: {
  claim: BoardClaim
  narrow: boolean
  busy: boolean
  canDecide: boolean
  docketRef: RefObject<HTMLElement | null>
  onBack: () => void
  onApprove: () => void
  onRefuse: (reason: string) => void
  onRead: (bandId: number) => void
}) {
  const [reason, setReason] = useState('')
  const steps = claim.checks.length > 0 ? claim.checks : [{ name: 'Board', result: statusLabel(claim.status), detail: claim.statusNote, reader: '' }]
  const shown = steps.slice(0, 4)
  return (
    <section ref={docketRef} aria-label="Reconciliation" className={cn('desk-card scroll-mt-4 px-5 py-5', !narrow && 'hidden md:block')}>
      <button type="button" onClick={onBack} className="mb-4 text-[14px] text-ink-dim md:hidden">
        All claims
      </button>
      <h2 className="font-display text-[28px] leading-none text-ink">{claim.incidentKind}</h2>
      <p className="mt-3 text-[13px] text-ink-dim">
        {claim.zoneName}
        {claim.openedAt ? ` · ${claim.openedAt}` : ''} · {statusLabel(claim.status)}
      </p>

      <ol className="mt-6 grid grid-cols-4 gap-3">
        {shown.map((step) => (
          <li key={step.name}>
            <span className="relative inline-block text-[13px] text-ink">
              {step.name}
              <span aria-hidden className={cn('absolute -bottom-1 left-0 right-0 h-px', toneClass(checkTone(step.result)))} />
            </span>
            <p className="mt-2 text-[13px] text-ink-dim">{step.result || 'seen'}</p>
          </li>
        ))}
      </ol>

      <ul className="mt-6 flex flex-col gap-3">
        {steps.map((step) => (
          <li key={`${step.name}-${step.detail}`} className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3">
            <span className="text-[13px] text-ink-dim">{step.name}</span>
            <span className="text-[14px] leading-5 text-ink">{step.detail || step.result}</span>
          </li>
        ))}
      </ul>

      <dl className="mt-6 grid grid-cols-[1fr_auto] gap-y-2 text-[14px]">
        <dt className="text-ink-dim">Damage</dt>
        <dd className="text-right tabular-nums text-ink">{formatCents(claim.costCents)}</dd>
        <dt className="text-ink-dim">Recoverable</dt>
        <dd className="text-right tabular-nums text-ink">{formatCents(claim.recoverableCents)}</dd>
        <dt className="pt-1 text-ink">Payable</dt>
        <dd className="pt-1 text-right text-[22px] tabular-nums leading-none text-ink">{formatCents(claim.payoutCents)}</dd>
      </dl>

      <p className="mt-5 text-[15px] leading-6 text-ink">{claim.statusNote || 'No note on this claim.'}</p>
      {claim.status === 'Routed' && claim.routedToName && <p className="mt-2 text-[13px] text-ink-dim">Waiting for {claim.routedToName}.</p>}

      {claim.status === 'Routed' && canDecide && (
        <div className="mt-6 flex flex-col gap-3">
          <Button type="button" className="h-11 self-start px-4" disabled={busy} onClick={onApprove}>
            {`Approve ${formatCents(claim.payoutCents)}`}
          </Button>
          <div className="flex flex-wrap items-center gap-3">
            <input
              aria-label="Reason for refusing"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Reason for refusing"
              className="h-11 min-w-0 flex-1 rounded-[4px] border border-line-strong bg-ground px-3 text-[14px] text-ink outline-none"
            />
            <button type="button" className="h-11 text-[14px] text-ink" disabled={busy || reason.trim() === ''} onClick={() => onRefuse(reason)}>
              Refuse
            </button>
          </div>
        </div>
      )}

      {claim.bandId > 0 && (
        <button type="button" onClick={() => onRead(claim.bandId)} className="mt-4 h-11 text-[14px] text-ink">
          {`Read band ${claim.bandId}`}
        </button>
      )}
      <ClaimExtras claimId={claim.id} />
    </section>
  )
}

function toneClass(tone: 'done' | 'waiting' | 'declined') {
  if (tone === 'waiting') return 'bg-champagne'
  if (tone === 'declined') return 'bg-ink-muted'
  return 'bg-ink'
}
