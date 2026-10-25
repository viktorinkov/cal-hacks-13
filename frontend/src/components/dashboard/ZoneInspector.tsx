import { useMemo } from 'react'
import { Area, AreaChart, ResponsiveContainer, YAxis } from 'recharts'
import type { CongestionStatus, SectionKind } from '@/contracts/domain'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useServerNow } from '@/hooks/useServerNow'
import { ago, count, density } from '@/lib/format'
import { congestionText, displayCongestion, zoneSourceTag } from '@/lib/status'
import { cn } from '@/lib/utils'
import { mapController } from '@/map/controller'
import { isLive, useConnection } from '@/stores/connection'
import { useUi } from '@/stores/ui'
import { useWorld } from '@/stores/world'
import { SourceChip } from './SourceChip'

const sectionName: Record<SectionKind, string> = {
  front: 'Front of stage',
  floor: 'Main floor',
  wing: 'Side wing',
  concourse: 'Concourse',
  plaza: 'Gate plaza',
  food: 'Food court',
  passage: 'Passage',
}

const sectionSwatch: Record<SectionKind, string> = {
  front: 'bg-section-front',
  floor: 'bg-section-floor',
  wing: 'bg-section-wing',
  concourse: 'bg-section-concourse',
  plaza: 'bg-section-plaza',
  food: 'bg-section-food',
  passage: 'bg-silver',
}

const statusText: Record<CongestionStatus | 'stale', string> = {
  normal: 'text-ink',
  caution: 'text-caution',
  critical: 'text-signal',
  unknown: 'text-ink-muted',
  stale: 'text-ink-muted',
}

const barColor: Record<CongestionStatus | 'stale', string> = {
  normal: 'bg-silver/60',
  caution: 'bg-caution',
  critical: 'bg-signal',
  unknown: 'bg-ink-muted/40',
  stale: 'bg-ink-muted/40',
}

const RANK: Record<CongestionStatus | 'stale', number> = { critical: 4, caution: 3, unknown: 2, stale: 1, normal: 0 }
/** Bars share one scale so zones compare at a glance. */
const BAR_MAX = 5

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line py-2">
      <dt className="text-[13px] text-ink-muted">{label}</dt>
      <dd className="flex items-center gap-2 text-right text-[14px] font-medium tabular-nums text-ink">{children}</dd>
    </div>
  )
}

/** The selected zone, or the busiest zones when nothing is selected. */
export function ZoneInspector() {
  const venue = useWorld((s) => s.venue)
  const zones = useWorld((s) => s.zones)
  const series = useWorld((s) => s.zoneSeries)
  const devices = useWorld((s) => s.devices)
  const selection = useUi((s) => s.selection)
  const select = useUi((s) => s.select)
  const linkUp = useConnection(isLive)
  const now = useServerNow(1)
  const zoneId = selection.kind === 'zone' ? selection.id : null

  const total = useMemo(() => Object.values(zones).reduce((a, z) => a + (z.occupancyEstimate ?? 0), 0), [zones])

  if (!venue) return null
  const z = zoneId ? venue.zones.find((x) => x.zoneId === zoneId) : null

  const picker = (
    <Select
      value={zoneId ?? ''}
      onValueChange={(v) => {
        select({ kind: 'zone', id: v })
        const zz = venue.zones.find((x) => x.zoneId === v)
        if (zz) mapController.focus(zz.labelAt, 14)
      }}
    >
      <SelectTrigger size="sm" className="h-7 w-auto gap-1 border-0 bg-transparent px-2 text-[12px] text-ink-dim shadow-[inset_0_0_0_1px_var(--nc-line)]" aria-label="Choose a zone">
        <SelectValue placeholder="Choose a zone" />
      </SelectTrigger>
      <SelectContent>
        {venue.zones.map((x) => (
          <SelectItem key={x.zoneId} value={x.zoneId}>
            {x.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )

  if (!z) {
    // nothing selected: the backend's status first, then the densest
    const ranked = venue.zones
      .map((v) => ({ v, st: zones[v.zoneId], status: displayCongestion(zones[v.zoneId], now, linkUp) }))
      .sort((a, b) => RANK[b.status] - RANK[a.status] || (b.st?.peakDensity ?? 0) - (a.st?.peakDensity ?? 0))
      .slice(0, 4)
    return (
      <section aria-labelledby="busiest-h" className="nc-panel pointer-events-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <h2 id="busiest-h" className="text-[13px] font-medium text-ink">
            Busiest zones
          </h2>
          {picker}
        </div>
        <ul className="mt-2 flex flex-col">
          {ranked.map(({ v, st, status }) => {
            const ratio = Math.min(1, (st?.peakDensity ?? 0) / BAR_MAX)
            return (
              <li key={v.zoneId}>
                <button
                  type="button"
                  onClick={() => {
                    select({ kind: 'zone', id: v.zoneId })
                    mapController.focus(v.labelAt, 14)
                  }}
                  className="group flex w-full flex-col gap-1.5 border-t border-line py-2 text-left first:border-t-0 hover:bg-[rgba(236,235,230,0.03)]"
                >
                  <span className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-[13px] text-ink">
                      <span aria-hidden className={cn('size-2 rounded-[2px]', sectionSwatch[v.section])} />
                      {v.name}
                    </span>
                    <span className="flex items-baseline gap-2 tabular-nums">
                      <span className={cn('text-[13px] font-medium', statusText[status])}>{density(st?.peakDensity)}</span>
                      <span className="text-[11px] text-ink-muted">peak/m²</span>
                    </span>
                  </span>
                  <span className="relative h-[3px] rounded-full bg-[rgba(207,208,212,0.12)]" aria-hidden>
                    <span className={cn('absolute inset-y-0 left-0 rounded-full', barColor[status])} style={{ width: `${Math.round(ratio * 100)}%` }} />
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
        <p className="mt-2 flex items-center justify-between text-[11.5px] text-ink-muted">
          <span>Click a zone on the map to inspect it</span>
          <SourceChip tag={zoneSourceTag(Object.values(zones)[0])} />
        </p>
      </section>
    )
  }

  const st = zones[z.zoneId]
  const status = displayCongestion(st, now, linkUp)
  const bandsHere = Object.values(devices).filter((d) => d.zoneId === z.zoneId && d.location)
  const data = (series[z.zoneId] ?? []).map((p) => ({ t: p.t, peak: p.peak }))
  const tag = zoneSourceTag(st)

  return (
    <section aria-labelledby="zone-h" className="nc-panel pointer-events-auto px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-[12px] text-ink-muted">
          <span aria-hidden className={cn('size-2 rounded-[2px]', sectionSwatch[z.section])} />
          {sectionName[z.section]}
        </span>
        {picker}
      </div>
      <h2 id="zone-h" className="mt-2 font-display text-[34px] leading-none tracking-[-0.01em] text-ink">
        {z.name}
      </h2>
      <p className={cn('mt-1.5 text-[13px]', statusText[status])}>
        {congestionText[status]}
        {st && status !== 'stale' ? null : st ? <span className="text-ink-muted"> · updated {ago(now - st.updatedAt)}</span> : <span className="text-ink-muted"> · no feed for this zone</span>}
      </p>
      <div className="mt-3 h-16" aria-hidden>
        {data.length > 2 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
              <YAxis hide domain={[0, (max: number) => Math.max(4, Math.ceil(max))]} />
              <Area
                type="linear"
                dataKey="peak"
                stroke={status === 'critical' ? 'var(--nc-red)' : status === 'caution' ? 'var(--nc-caution)' : 'var(--nc-champagne)'}
                strokeWidth={1.5}
                fill={status === 'critical' ? 'var(--nc-red)' : status === 'caution' ? 'var(--nc-caution)' : 'var(--nc-champagne)'}
                fillOpacity={0.12}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="grid h-full place-items-center text-[12px] text-ink-muted">Collecting the last few minutes…</div>
        )}
      </div>
      <p className="mt-1 text-[11px] text-ink-muted">Peak per m², last {Math.max(1, Math.round(data.length / 60))} min</p>
      <dl className="mt-2 flex flex-col">
        <Row label="People now">
          {count(st?.occupancyEstimate)} <SourceChip tag={tag} />
        </Row>
        <Row label="Share of crowd">{st?.occupancyEstimate !== undefined && total ? `${Math.round((100 * st.occupancyEstimate) / total)}%` : '—'}</Row>
        <Row label="Peak density">
          {density(st?.peakDensity)} <span className="text-[12px] font-normal text-ink-muted">per m²</span>
        </Row>
        <Row label="Flow in / out">
          {count(st?.flowIn)} / {count(st?.flowOut)} <span className="text-[12px] font-normal text-ink-muted">per min</span>
        </Row>
        <Row label="Bands here">
          <span className="font-mono text-[13px]">{bandsHere.length ? bandsHere.map((d) => d.label).join(' · ') : 'none'}</span>
        </Row>
      </dl>
    </section>
  )
}
