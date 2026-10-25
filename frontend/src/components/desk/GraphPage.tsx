import { Expand, Maximize, Shrink, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { useCatalog } from '@/stdb/catalog'
import { DeskFrame, Figure } from './DeskFrame'
import { attendeeName } from './attendeeName'
import type { EventGraph } from './eventGraph'
import type { Labels } from './graphModel'
import { KIND_COLOURS, KIND_NAMES, LINK_COLOURS, LINK_NAMES, useGraphView, type Kind, type LegendLine, type Mode, type Summary } from './graphView'

const MODES: { mode: Mode; label: string }[] = [
  { mode: 'kind', label: 'Kind' },
  { mode: 'memories', label: 'Memories' },
  { mode: 'company', label: 'Company' },
]

function Tool({ onClick, pressed, children }: { onClick: () => void; pressed?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-[3px] px-2.5 text-[13px] transition-colors [&_svg]:size-3.5 [&_svg]:stroke-[1.5]',
        pressed ? 'bg-[rgba(236,235,230,0.09)] text-ink' : 'text-ink-dim hover:bg-accent hover:text-ink',
      )}
    >
      {children}
    </button>
  )
}

function Swatch({ colour, line = false, children }: { colour: string; line?: boolean; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <i aria-hidden className={cn('inline-block shrink-0 rounded-full', line ? 'h-0.5 w-3.5' : 'size-2')} style={{ background: colour }} />
      {children}
    </span>
  )
}

function Legend({ mode, legend }: { mode: Mode; legend: LegendLine[] }) {
  const groups =
    mode === 'kind'
      ? (Object.keys(KIND_COLOURS) as Kind[]).map((kind) => (
          <Swatch key={kind} colour={KIND_COLOURS[kind]}>
            {KIND_NAMES[kind]}
          </Swatch>
        ))
      : legend.length
        ? legend.map((line) => (
            <Swatch key={line.label} colour={line.colour}>
              {line.label}
            </Swatch>
          ))
        : [<span key="none">No memories yet.</span>]
  return (
    <div className="nc-panel flex max-w-[min(100%,46rem)] flex-col gap-1.5 px-3 py-2 text-[12px] text-ink-dim">
      <div className="flex flex-wrap gap-x-4 gap-y-1">{groups}</div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {Object.entries(LINK_NAMES).map(([kind, label]) => (
          <Swatch key={kind} colour={LINK_COLOURS[kind]} line>
            {label}
          </Swatch>
        ))}
      </div>
    </div>
  )
}

/** The selected node: what it is, and every booth, company and person one link away. */
function Card({ summary, onPick, onClose }: { summary: Summary; onPick: (id: string) => void; onClose: () => void }) {
  return (
    <aside
      aria-label={summary.title}
      className="nc-panel nc-scroll absolute inset-x-3 bottom-3 z-10 bg-panel max-h-[45%] overflow-y-auto p-4 md:inset-x-auto md:bottom-auto md:left-3 md:top-3 md:max-h-[calc(100%-7.5rem)] md:w-[300px]"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[12px] text-ink-dim">{summary.eyebrow}</p>
        <button type="button" aria-label="Close" onClick={onClose} className="-m-1 grid size-6 shrink-0 place-items-center rounded-[3px] text-ink-muted hover:bg-accent hover:text-ink">
          <X className="size-3.5" />
        </button>
      </div>
      <h2 className="mt-1 font-display text-[26px] leading-[1.05] text-ink">{summary.title}</h2>
      <p className="mt-2 text-[13px] text-ink-dim">{summary.stats}</p>
      {summary.sections.map((section) => (
        <section key={section.title} className="mt-4">
          <h3 className="text-[12px] text-ink-muted">{section.title}</h3>
          <ul className="mt-1">
            {section.items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onPick(item.id)}
                  className="-mx-1.5 flex w-[calc(100%+0.75rem)] items-center gap-2 rounded-[3px] px-1.5 py-1 text-left text-[13px] text-ink hover:bg-accent"
                >
                  <i aria-hidden className="inline-block size-1.5 shrink-0 rounded-full" style={{ background: KIND_COLOURS[item.kind] }} />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.note && <span className="shrink-0 tabular-nums text-ink-muted">{item.note}</span>}
                </button>
              </li>
            ))}
          </ul>
          {section.more > 0 && <p className="mt-1 text-[12px] text-ink-muted">and {section.more} more</p>}
        </section>
      ))}
    </aside>
  )
}

/** The event graph in 3D: drag to turn, scroll to zoom, click a person to see the booths they stood at. */
export function GraphPage() {
  const links = useCatalog((s) => s.links)
  const linkCount = useCatalog((s) => s.linkCount)
  const booths = useCatalog((s) => s.booths)
  const companies = useCatalog((s) => s.companies)
  const attendees = useCatalog((s) => s.attendees)
  const mode = useGraphView((s) => s.mode)
  const legend = useGraphView((s) => s.legend)
  const selected = useGraphView((s) => s.selected)
  const ready = useGraphView((s) => s.ready)
  const frame = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const engine = useRef<EventGraph | null>(null)
  const [failed, setFailed] = useState(false)
  const [full, setFull] = useState(false)
  const labels = useMemo<Labels>(() => {
    const person = new Map<string, string>()
    for (const link of links) {
      for (const [kind, id] of [
        [link.fromKind, link.fromId],
        [link.toKind, link.toId],
      ]) {
        if (kind === 'person' && id && !person.has(id)) person.set(id, attendeeName(id))
      }
    }
    // The staff list, when this viewer can read it, replaces the public name with the one the attendee uses.
    for (const attendee of attendees) {
      if (attendee.nodeId && attendee.displayName) person.set(attendee.nodeId, attendee.displayName)
    }
    return {
      person,
      booth: new Map(booths.map((item) => [item.id, item.name])),
      company: new Map(companies.map((item) => [item.id, item.name])),
    }
  }, [attendees, booths, companies, links])
  const latest = useRef({ links, labels })
  const counts = useMemo(() => {
    const seen = new Set<string>()
    const out = { person: 0, booth: 0, company: 0, named: 0 }
    for (const link of links) {
      for (const [kind, id] of [
        [link.fromKind, link.fromId],
        [link.toKind, link.toId],
      ]) {
        const key = `${kind}:${id}`
        if (seen.has(key) || !(kind in KIND_COLOURS)) continue
        seen.add(key)
        out[kind as Kind] += 1
        if (kind === 'person' && labels.person.has(id)) out.named += 1
      }
    }
    return out
  }, [links, labels])

  useEffect(() => {
    latest.current = { links, labels }
    engine.current?.setData(links, labels)
  }, [links, labels])

  useEffect(() => {
    let alive = true
    import('./eventGraph')
      .then(({ eventGraph }) => {
        if (!alive || !stage.current) return
        const graph = eventGraph()
        graph.attach(stage.current)
        engine.current = graph
        graph.setData(latest.current.links, latest.current.labels)
      })
      .catch(() => {
        if (alive) setFailed(true)
      })
    return () => {
      alive = false
      engine.current?.detach()
      engine.current = null
    }
  }, [])

  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === frame.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void frame.current?.requestFullscreen?.()
  }

  return (
    <DeskFrame
      motif="graph"
      title={linkCount ? `${linkCount.toLocaleString('en-US')} meetings in the room.` : 'No meetings drawn yet.'}
      sentence="People, booths and companies linked by where they stood."
      figures={
        <>
          <Figure lead label="Links" value={linkCount.toLocaleString('en-US')} note={linkCount > links.length ? `${links.length.toLocaleString('en-US')} drawn` : 'in the graph'} />
          <Figure label="People" value={counts.person.toLocaleString('en-US')} note={counts.named ? 'named' : 'on the graph'} />
          <Figure label="Booths" value={counts.booth.toLocaleString('en-US')} note="named" />
          <Figure label="Companies" value={counts.company.toLocaleString('en-US')} note="named" />
        </>
      }
    >
      <div ref={frame} className="desk-card nc-graph relative h-[70vh] min-h-[520px] overflow-hidden">
        <div ref={stage} className="absolute inset-0" />
        {!ready && (
          <p className="absolute inset-0 grid place-items-center px-6 text-center text-[15px] text-ink-dim">
            {failed ? 'This browser could not start the 3D view.' : linkCount ? 'Laying out the graph…' : 'The graph has not arrived from the live host yet.'}
          </p>
        )}
        <div className="absolute right-3 top-3 flex flex-wrap items-center justify-end gap-2">
          <div role="group" aria-label="Colour by" className="nc-panel flex items-center gap-0.5 p-1">
            <span className="px-2 text-[13px] text-ink-muted">Colour by</span>
            {MODES.map((item) => (
              <Tool key={item.mode} pressed={mode === item.mode} onClick={() => engine.current?.setMode(item.mode)}>
                {item.label}
              </Tool>
            ))}
          </div>
          <div className="nc-panel flex items-center gap-0.5 p-1">
            <Tool onClick={() => engine.current?.fit()}>
              <Maximize /> Fit
            </Tool>
            <Tool onClick={toggleFull}>
              {full ? <Shrink /> : <Expand />} {full ? 'Exit full screen' : 'Full screen'}
            </Tool>
          </div>
        </div>
        {selected && <Card summary={selected} onPick={(id) => engine.current?.select(id)} onClose={() => engine.current?.select(undefined)} />}
        <div className="pointer-events-none absolute inset-x-3 bottom-3 flex items-end justify-between gap-4">
          <Legend mode={mode} legend={legend} />
          <p className="hidden shrink-0 pb-1 text-[12px] text-ink-muted lg:block">Drag to turn, scroll to zoom, click anything to see what it links to.</p>
        </div>
      </div>
    </DeskFrame>
  )
}
