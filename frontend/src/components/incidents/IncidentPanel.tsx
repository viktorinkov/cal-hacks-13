import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Loader2, X } from 'lucide-react'
import type { Incident } from '@/contracts/domain'
import { Button } from '@/components/ui/button'
import { SourceChip } from '@/components/dashboard/SourceChip'
import { GuidancePanel } from '@/components/interventions/GuidancePanel'
import { useServerNow } from '@/hooks/useServerNow'
import { clock, elapsed } from '@/lib/format'
import { incidentStatusText, incidentTitle, localizationText, observationText, simBandsFor, type Tone } from '@/lib/status'
import { cn } from '@/lib/utils'
import { mapController } from '@/map/controller'
import { acknowledgeIncident, approveGuidance, cancelGuidance, pendingKey, previewGuidance } from '@/services/operatorCommands'
import { isLive, useConnection } from '@/stores/connection'
import { useMapStats } from '@/stores/frames'
import { useUi } from '@/stores/ui'
import { useWorld } from '@/stores/world'
import { EvidenceFrame } from './EvidenceFrame'
import { IncidentTimeline } from './IncidentTimeline'
import { ResolveDialog } from './ResolveDialog'

const toneText: Record<Tone, string> = {
  neutral: 'text-ink',
  ok: 'text-help',
  caution: 'text-caution',
  critical: 'text-signal',
  help: 'text-help',
  muted: 'text-ink-muted',
  sim: 'text-[#cfc4ff]',
}

const statusChip: Record<Incident['status'], string> = {
  reported: 'text-signal shadow-[inset_0_0_0_1px_rgba(255,59,48,0.6)]',
  acknowledged: 'text-champagne shadow-[inset_0_0_0_1px_rgba(220,199,159,0.5)]',
  responding: 'text-help shadow-[inset_0_0_0_1px_rgba(140,192,155,0.55)]',
  resolved: 'text-ink-dim shadow-[inset_0_0_0_1px_var(--nc-line-strong)]',
}

function Fact({ label, children, tag }: { label: string; children: React.ReactNode; tag?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-t border-line py-2">
      <dt className="flex-none text-[13px] text-ink-muted">{label}</dt>
      <dd className="flex items-center gap-2 text-right text-[13.5px] text-ink">
        <span>{children}</span>
        {tag}
      </dd>
    </div>
  )
}

/** The incident the operator is working: evidence first, then the one next action. */
export function IncidentPanel() {
  const incidents = useWorld((s) => s.incidents)
  const observations = useWorld((s) => s.observations)
  const commands = useWorld((s) => s.commands)
  const devices = useWorld((s) => s.devices)
  const venue = useWorld((s) => s.venue)
  const selection = useUi((s) => s.selection)
  const select = useUi((s) => s.select)
  const pending = useUi((s) => s.pending)
  const expanded = useUi((s) => s.incidentOpen)
  const setExpanded = useUi((s) => s.setIncidentOpen)
  const linkUp = useConnection(isLive)
  const near = useMapStats((s) => s.nearIncident)
  const simulatedBands = useWorld((s) => s.scenario?.simulatedBands)
  const now = useServerNow(1)
  const [resolveOpen, setResolveOpen] = useState(false)
  const [falseAlarm, setFalseAlarm] = useState(false)
  const [dismissed, setDismissed] = useState<string | null>(null)

  const open = useMemo(
    () => Object.values(incidents).filter((i) => i.status !== 'resolved').sort((a, b) => a.reportedAt - b.reportedAt),
    [incidents],
  )
  const recentResolved = useMemo(
    () => Object.values(incidents).filter((i) => i.status === 'resolved').sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0))[0],
    [incidents],
  )
  const selectedId = selection.kind === 'incident' ? selection.id : null
  const inc = (selectedId && incidents[selectedId]) || open[0] || (recentResolved && recentResolved.incidentId !== dismissed ? recentResolved : undefined)

  const cmds = useMemo(() => (inc ? Object.values(commands).filter((c) => c.incidentId === inc.incidentId) : []), [commands, inc])
  const active = cmds.find((c) => c.approvalStatus === 'approved')
  const draft = cmds.find((c) => c.approvalStatus === 'pending_approval')
  const shown = active ?? draft
  const draftCrowd = simBandsFor(simulatedBands, draft?.commandId)

  // once acknowledged, ask the backend for its preapproved path (never computed here)
  const incId = inc?.incidentId
  const status = inc?.status
  const hasLocation = !!inc?.location
  useEffect(() => {
    if (!incId || status !== 'acknowledged' || !hasLocation || cmds.length > 0) return
    const t = setTimeout(() => void previewGuidance(incId), 500)
    return () => clearTimeout(t)
  }, [incId, status, hasLocation, cmds.length])

  if (!inc) return null
  const tz = venue?.timeZone
  const zoneName = venue?.zones.find((z) => z.zoneId === inc.candidateZone)?.name ?? 'Unknown zone'
  const reporter = inc.reportedByDeviceId ? devices[inc.reportedByDeviceId] : undefined
  const obs = inc.cameraObservations.map((id) => observations[id]).filter(Boolean).at(-1)
  const ot = observationText(obs)
  const corridors = venue?.responderCorridors ?? []
  const busy = (k: string) => !!pending[k]
  const kindLabel = inc.source === 'imu_suspicion' ? 'Experimental' : inc.isSimulated ? 'Simulated SOS' : 'From a band'
  const openPanel = () => {
    setExpanded(true)
    // recentre once the panel has taken its space
    if (inc.location) setTimeout(() => mapController.focusIncident(inc.incidentId), 60)
  }

  if (!expanded) {
    return (
      <section aria-labelledby="inc-h" className="nc-panel pointer-events-auto flex w-[280px] flex-col gap-2 p-3.5">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-mono text-[11.5px] text-champagne">
            {inc.displayId} · {kindLabel}
          </span>
          <span className="flex flex-none items-center gap-1">
            <span className={cn('inline-flex h-[20px] items-center rounded-[2px] px-1.5 text-[11.5px] font-medium', statusChip[inc.status])}>
              {incidentStatusText[inc.status]}
            </span>
            {inc.status === 'resolved' && (
              <button type="button" aria-label="Close" onClick={() => setDismissed(inc.incidentId)} className="grid size-6 place-items-center rounded-[3px] text-ink-dim hover:bg-accent hover:text-ink">
                <X className="size-3.5" />
              </button>
            )}
          </span>
        </div>
        <h2 id="inc-h" className="font-display text-[24px] leading-none text-ink">
          {incidentTitle(inc)}
        </h2>
        <p className="text-[12.5px] text-ink-dim">
          {zoneName}
          {reporter ? ` · band-${reporter.label}` : ''}
          {inc.status !== 'resolved' ? ` · open ${elapsed(now - inc.reportedAt)}` : ''}
          {open.length > 1 ? ` · ${open.length} open` : ''}
        </p>
        <Button variant="outline" aria-expanded={false} className="mt-1 h-9 justify-between bg-transparent text-[13px]" onClick={openPanel}>
          Open incident <ChevronUp className="size-4" />
        </Button>
      </section>
    )
  }

  return (
    <section aria-labelledby="inc-h" className="nc-panel pointer-events-auto flex max-h-[min(100%,480px)] min-h-0 w-[340px] flex-col bg-[rgba(14,14,16,0.97)] backdrop-blur-sm">
      {open.length > 1 && (
        <div role="tablist" aria-label="Open incidents" className="flex gap-1 border-b border-line px-3 pt-3">
          {open.map((i) => (
            <button
              key={i.incidentId}
              role="tab"
              aria-selected={i.incidentId === inc.incidentId}
              onClick={() => {
                select({ kind: 'incident', id: i.incidentId })
                mapController.focusIncident(i.incidentId)
              }}
              className={cn(
                '-mb-px border-b-2 px-2.5 pb-2 font-mono text-[12px]',
                i.incidentId === inc.incidentId ? 'border-champagne text-ink' : 'border-transparent text-ink-muted hover:text-ink',
              )}
            >
              {i.displayId}
            </button>
          ))}
        </div>
      )}

      <div className="nc-scroll flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-3 pt-3.5">
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate font-mono text-[12px] text-champagne">
            {inc.displayId} · {kindLabel}
          </span>
          <span className="flex flex-none items-center gap-1.5">
            <span className={cn('inline-flex h-[22px] items-center whitespace-nowrap rounded-[2px] px-2 text-[12px] font-medium', statusChip[inc.status])}>
              {incidentStatusText[inc.status]}
            </span>
            <button
              type="button"
              aria-label="Hide the incident panel"
              aria-expanded
              onClick={() => setExpanded(false)}
              className="grid size-7 place-items-center rounded-[3px] text-ink-dim hover:bg-accent hover:text-ink"
            >
              <ChevronDown className="size-4" />
            </button>
            {inc.status === 'resolved' && (
              <button type="button" aria-label="Close" onClick={() => setDismissed(inc.incidentId)} className="grid size-7 place-items-center rounded-[3px] text-ink-dim hover:bg-accent hover:text-ink">
                <X className="size-4" />
              </button>
            )}
          </span>
        </div>

        <div className="flex flex-col gap-1.5">
          <h2 id="inc-h" className="font-display text-[28px] leading-none tracking-[-0.01em] text-ink">
            {incidentTitle(inc)}
          </h2>
          <p className="text-[13px] text-ink-dim">
            {zoneName}
            {reporter ? ` · band-${reporter.label}, ${reporter.wearerLabel ?? 'unassigned'}` : ''}
          </p>
        </div>

        {inc.status !== 'resolved' && (
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-[13px] tabular-nums text-ink-dim">{clock(inc.reportedAt, tz)}</span>
            <span className="text-[13px] text-ink-muted">open {elapsed(now - inc.reportedAt)}</span>
          </div>
        )}

        {shown && <GuidancePanel incident={inc} command={shown} devices={devices} corridors={corridors} />}

        <div className="flex flex-col gap-2">
          <EvidenceFrame obs={obs} compact />
          <p className={cn('text-[13px] font-medium', toneText[ot.tone])}>{ot.title}</p>
          <p className="text-[12.5px] leading-snug text-ink-muted">{ot.detail}</p>
        </div>

        <dl className="flex flex-col">
          {inc.source === 'manual_sos' && inc.radio?.holdMs !== undefined && (
            <Fact label="Button" tag={<SourceChip tag={inc.isSimulated ? 'sim' : 'radio'} />}>
              Held {(inc.radio.holdMs / 1000).toFixed(1)} s
            </Fact>
          )}
          {inc.radio?.impactG !== undefined && (
            <Fact label="Wrist sensor" tag={<SourceChip tag={inc.isSimulated ? 'sim' : 'radio'} />}>
              {inc.radio.impactG.toFixed(1)} g, then {inc.radio.stillSeconds ?? '?'} s still
            </Fact>
          )}
          <Fact label="Radio" tag={<SourceChip tag={inc.isSimulated ? 'sim' : 'radio'} />}>
            {inc.radioStatus === 'received' ? `Received by ${inc.radio?.gatewayId?.toLowerCase() ?? 'gateway'}` : inc.radioStatus === 'delayed' ? 'Delayed' : inc.radioStatus === 'lost' ? 'Lost' : 'Unknown'}
          </Fact>
          <Fact label="Location">{localizationText(inc)}</Fact>
          {inc.status !== 'resolved' && inc.location && (
            <Fact label="People within 4 m" tag={<SourceChip tag="sim" />}>
              {near}
            </Fact>
          )}
          {inc.resolution && (
            <Fact label="Outcome">
              {inc.resolution.reason.replace(/_/g, ' ')} · {inc.resolution.by}
            </Fact>
          )}
        </dl>

        {inc.status === 'acknowledged' && !shown && (
          <p className="flex items-center gap-2 text-[13px] text-ink-dim">
            {inc.location ? (
              <>
                <Loader2 className="size-3.5 animate-spin" /> Asking the backend for the preapproved path…
              </>
            ) : (
              'No location yet, so no path can be previewed. Send staff by radio'
            )}
          </p>
        )}

        <div className="flex flex-col gap-1.5">
          <h3 className="text-[13px] font-medium text-ink">Timeline</h3>
          <IncidentTimeline incident={inc} tz={tz} />
        </div>
      </div>

      {inc.status !== 'resolved' && (
        <div className="flex flex-col gap-2 border-t border-dashed border-line-strong px-4 py-3">
          {!linkUp && <p className="text-[12px] text-caution">Not connected. Actions are paused until the link is back</p>}
          {inc.status === 'reported' && (
            <>
              <Button
                size="lg"
                className="h-11 text-[14px] font-semibold hover:bg-champagne-hover"
                disabled={!linkUp || busy(pendingKey.ack(inc.incidentId))}
                onClick={() => void acknowledgeIncident(inc.incidentId)}
              >
                {busy(pendingKey.ack(inc.incidentId)) ? (
                  <>
                    <Loader2 className="animate-spin" /> Waiting for the backend…
                  </>
                ) : (
                  'Acknowledge'
                )}
              </Button>
              <Button
                variant="outline"
                className="h-10 bg-transparent text-[14px]"
                disabled={!linkUp}
                onClick={() => {
                  setFalseAlarm(true)
                  setResolveOpen(true)
                }}
              >
                {inc.source === 'imu_suspicion' ? 'Not a fall' : 'False alarm'}
              </Button>
            </>
          )}
          {inc.status === 'acknowledged' && draft && (
            <>
              <Button
                size="lg"
                className="h-11 text-[14px] font-semibold hover:bg-champagne-hover"
                disabled={!linkUp || busy(pendingKey.approve(draft.commandId))}
                onClick={() => void approveGuidance(draft.commandId)}
              >
                {busy(pendingKey.approve(draft.commandId)) ? (
                  <>
                    <Loader2 className="animate-spin" /> Waiting for the backend…
                  </>
                ) : (
                  `Clear the path · signal ${draftCrowd ? `~${draft.targets.length + draftCrowd.signalled}` : draft.targets.length} bands`
                )}
              </Button>
              <Button variant="outline" className="h-10 bg-transparent text-[14px]" disabled={!linkUp} onClick={() => { setFalseAlarm(false); setResolveOpen(true) }}>
                Resolve without a path
              </Button>
            </>
          )}
          {inc.status === 'acknowledged' && !draft && (
            <Button variant="outline" className="h-10 bg-transparent text-[14px]" disabled={!linkUp} onClick={() => { setFalseAlarm(false); setResolveOpen(true) }}>
              Resolve
            </Button>
          )}
          {inc.status === 'responding' && (
            <>
              <Button size="lg" className="h-11 text-[14px] font-semibold hover:bg-champagne-hover" disabled={!linkUp} onClick={() => { setFalseAlarm(false); setResolveOpen(true) }}>
                Resolve
              </Button>
              {active && (
                <Button
                  variant="outline"
                  className="h-10 bg-transparent text-[14px]"
                  disabled={!linkUp || busy(pendingKey.cancel(active.commandId))}
                  onClick={() => void cancelGuidance(active.commandId)}
                >
                  {busy(pendingKey.cancel(active.commandId)) ? 'Stopping…' : 'Stop signals'}
                </Button>
              )}
            </>
          )}
        </div>
      )}
      <ResolveDialog key={`${inc.incidentId}-${falseAlarm}`} incident={inc} open={resolveOpen} onOpenChange={setResolveOpen} defaultReason={falseAlarm ? 'false_alarm' : 'assisted_on_scene'} />
    </section>
  )
}
