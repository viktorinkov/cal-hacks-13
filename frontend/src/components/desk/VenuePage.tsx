import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowUpRight, LoaderCircle, Pause, Play, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useRoute } from '@/cover/route'
import { cn } from '@/lib/utils'
import { useSession } from '@/stdb/session'
import { DEFAULT_SETUP_ID, importSlugFor, useVenueSetup } from '@/stdb/venueSetup'
import { ModelView } from '@/venue/ModelView'
import { palaceRun } from '@/venue/palaceRun'
import { RunStrip } from '@/venue/RunStrip'
import {
  SPEEDS,
  STATUS_LABEL,
  TOOL_LABEL,
  activeStage,
  buildRun,
  clock,
  detailParts,
  footprint,
  frameAt,
  megabytes,
  modelHref,
  short,
  speedFactor,
  stageSpans,
  type Run,
  type RunFrame,
  type RunStep,
  type Speed,
} from '@/venue/runs'
import { DeskFrame, when } from './DeskFrame'

const controlClass =
  'h-9 rounded-[4px] border border-line-strong bg-ground px-3 text-[14px] text-ink outline-none placeholder:text-ink-muted focus-visible:border-champagne'

/** One accent line under the chosen label: the screen's only selection mark. */
function Mark({ on }: { on: boolean }) {
  return on ? <span aria-hidden className="absolute -bottom-1.5 left-0 right-0 h-px bg-champagne" /> : null
}

function Choice({ on, label, onPick }: { on: boolean; label: string; onPick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onPick}
      className={cn('relative py-1 outline-none focus-visible:ring-2 focus-visible:ring-champagne/60', on ? 'text-ink' : 'text-ink-muted hover:text-ink')}
    >
      <span className="relative whitespace-nowrap">
        {label}
        <Mark on={on} />
      </span>
    </button>
  )
}

function Pill({ tone, children }: { tone: 'good' | 'bad' | 'plain'; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 flex-none items-center whitespace-nowrap rounded-[3px] px-1.5 text-[12px] font-medium',
        tone === 'good' && 'bg-help/12 text-help',
        tone === 'bad' && 'bg-signal/12 text-signal',
        tone === 'plain' && 'bg-raised text-ink-dim',
      )}
    >
      {children}
    </span>
  )
}

function statusPill(status: string, replaying: boolean) {
  if (status === 'running') return <Pill tone="plain">{replaying ? 'Replaying' : 'Working'}</Pill>
  if (status === 'ready') return <Pill tone="good">{STATUS_LABEL.ready}</Pill>
  if (status === 'failed') return <Pill tone="bad">{STATUS_LABEL.failed}</Pill>
  return <Pill tone="plain">{STATUS_LABEL[status] ?? status}</Pill>
}

function Panel({ title, aside, children, className }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('desk-card flex flex-col p-5', className)}>
      <div className="flex min-h-6 flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
        {aside}
      </div>
      <div className="mt-4 flex flex-1 flex-col">{children}</div>
    </section>
  )
}

function venueTitle(run: Run, frame: RunFrame): string {
  const venue = frame.setup.venueName
  return venue ? `${run.setup.eventName} at the ${venue.replace(/^the /i, '')}` : run.setup.eventName
}

function runOption(run: Run, chosenId: string): string {
  const s = run.setup
  const parts = [s.eventName, s.venueName, run.replay ? 'replay' : STATUS_LABEL[s.status] ?? s.status, s.id === chosenId ? 'on the map' : '']
  return parts.filter(Boolean).join(' · ')
}

/** The model's counts in the worker's own words read with separators: 115545 triangles becomes 115,545. */
function grouped(text: string): string {
  return text.replace(/\b\d{4,}(?= (?:triangles|meshes|named parts)\b)/g, (n) => Number(n).toLocaleString('en-US'))
}

// ---------------------------------------------------------------------------------- the toolbar

function Toolbar({ runs, selected, onSelect, onStarted }: { runs: Run[]; selected: string; onSelect: (id: string) => void; onStarted: () => void }) {
  const phase = useSession((s) => s.phase)
  const start = useVenueSetup((s) => s.start)
  const starting = useVenueSetup((s) => s.starting)
  const startError = useVenueSetup((s) => s.startError)
  const ready = useVenueSetup((s) => s.setupsReady)
  const error = useVenueSetup((s) => s.error)
  const chosenId = useVenueSetup((s) => s.chosenId)
  const imports = useVenueSetup((s) => s.imports) ?? []
  const importSteps = useVenueSetup((s) => s.importSteps) ?? []
  const [name, setName] = useState('')
  const live = phase === 'live'
  const importsThis = importSlugFor(name) !== null
  const latestImport = imports[0]
  const latestStep = latestImport ? importSteps.filter((step) => step.importId === latestImport.id).at(-1) : undefined
  const count = runs.filter((run) => !run.replay).length

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (await start(name)) {
      setName('')
      onStarted()
    }
  }

  return (
    <div className="grid gap-x-10 gap-y-6 lg:grid-cols-12">
      <form onSubmit={(event) => void submit(event)} noValidate className="min-w-0 lg:col-span-7">
        <label htmlFor="venue-event" className="mb-2 block text-[13px] font-medium text-ink">
          Find a venue by its event's name
        </label>
        <div className="flex gap-2">
          <input
            id="venue-event"
            value={name}
            maxLength={200}
            autoComplete="off"
            placeholder="For example, Cal Hacks 13.0"
            aria-invalid={startError ? true : undefined}
            aria-describedby={startError ? 'venue-event-error' : 'venue-event-help'}
            onChange={(event) => setName(event.target.value)}
            className={cn(controlClass, 'min-w-0 flex-1')}
          />
          <Button type="submit" variant="outline" className="h-9 px-3" disabled={!live || starting}>
            {starting && <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
            Find the venue
          </Button>
        </div>
        {startError ? (
          <p id="venue-event-error" className="mt-2 text-[13px] text-signal">
            {startError}
          </p>
        ) : (
          <p id="venue-event-help" className="mt-2 text-[13px] text-ink-dim">
            {live
              ? importsThis
                ? "Starts the Bright Data import of this event's venue, zones, sponsors and schedule, and searches for its public 3D map. Takes a few minutes."
                : "Searches the web, reads the event's pages and saves its venue's public 3D map. Takes a few minutes."
              : 'Connecting to the desk.'}
          </p>
        )}
        {latestImport && (
          <p className="mt-2 text-[13px] text-ink-dim">
            {latestImport.status === 'running' ? 'Importing' : latestImport.status === 'ready' ? 'Imported' : latestImport.status === 'failed' ? 'Import failed' : latestImport.status}{' '}
            {latestImport.eventName || 'the event'}
            {latestStep ? ` · ${latestStep.step}${latestStep.detail ? `: ${latestStep.detail}` : ''}` : ''}
            {latestImport.error ? ` · ${latestImport.error}` : ''}
          </p>
        )}
      </form>
      <div className="min-w-0 lg:col-span-5">
        <label htmlFor="venue-run-pick" className="mb-2 block text-[13px] font-medium text-ink">
          Search shown
        </label>
        <select id="venue-run-pick" value={selected} onChange={(event) => onSelect(event.target.value)} className={cn(controlClass, 'w-full')}>
          {runs.map((run) => (
            <option key={run.setup.id} value={run.setup.id}>
              {runOption(run, chosenId)}
            </option>
          ))}
        </select>
        <p className="mt-2 flex items-center gap-2 text-[13px] text-ink-dim" role={ready ? undefined : 'status'}>
          {error ? (
            <span className="text-signal">{`Couldn't load the searches: ${error}`}</span>
          ) : !ready ? (
            <>
              <LoaderCircle size={13} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> Loading the searches run on this desk.
            </>
          ) : count === 0 ? (
            'No searches run on this desk yet. The Palace replay is always here.'
          ) : (
            `${count} search${count === 1 ? '' : 'es'} run on this desk, and the Palace replay.`
          )}
        </p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------- the run

function ReplayControls({
  run,
  frame,
  playing,
  speed,
  onPlay,
  onPause,
  onSpeed,
}: {
  run: Run
  frame: RunFrame
  playing: boolean
  speed: Speed
  onPlay: () => void
  onPause: () => void
  onSpeed: (speed: Speed) => void
}) {
  const atEnd = frame.t >= run.duration
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
      <div role="group" aria-label="Replay speed" className="flex items-center gap-4 text-[13px]">
        {SPEEDS.map((item) => (
          <Choice key={item.id} on={speed === item.id} label={item.label} onPick={() => onSpeed(item.id)} />
        ))}
      </div>
      <span className="text-[13px] tabular-nums text-ink-dim">{`${clock(frame.t)} / ${clock(run.duration)}`}</span>
      {playing ? (
        <Button type="button" variant="outline" className="h-9 px-3" onClick={onPause}>
          <Pause aria-hidden="true" /> Pause
        </Button>
      ) : (
        <Button type="button" variant="outline" className="h-9 px-3" onClick={onPlay}>
          {atEnd ? <RotateCcw aria-hidden="true" /> : <Play aria-hidden="true" />}
          {atEnd ? 'Replay the run' : 'Play'}
        </Button>
      )}
    </div>
  )
}

function UseVenue({ run, frame }: { run: Run; frame: RunFrame }) {
  const { path, go } = useRoute()
  const chosenId = useVenueSetup((s) => s.chosenId)
  const choose = useVenueSetup((s) => s.choose)
  const choosing = useVenueSetup((s) => s.choosing)
  const chooseError = useVenueSetup((s) => s.chooseError)
  const phase = useSession((s) => s.phase)
  const mapPath = path === '/organizer' || window.location.hostname === 'band1t.vip' ? '/organizer' : '/'
  const isChosen = chosenId === run.setup.id
  const hasModel = frame.setup.status === 'ready'
  return (
    <div className="flex flex-col items-start gap-2 lg:items-end">
      {isChosen ? (
        <div className="flex items-center gap-4">
          <span className="text-[13px] text-ink-dim">This venue is on the map</span>
          <Button type="button" className="h-9 px-3" onClick={() => go(mapPath)}>
            Open the map <ArrowUpRight aria-hidden="true" />
          </Button>
        </div>
      ) : (
        <Button type="button" className="h-9 px-3" disabled={!hasModel || choosing || phase !== 'live'} onClick={() => void choose(run.setup.id)}>
          {choosing && <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
          Use this venue
        </Button>
      )}
      {!isChosen && !hasModel && <p className="text-[13px] text-ink-muted">{frame.finished ? 'This search saved no model to show.' : 'Waiting for the model.'}</p>}
      {chooseError && (
        <p className="max-w-[36ch] text-[13px] text-signal lg:text-right">
          {/role|ops|permission/i.test(chooseError) ? 'Only an organizer signed in to the desk can change the venue.' : chooseError}
        </p>
      )}
    </div>
  )
}

function Detail({ step }: { step: RunStep }) {
  const parts = detailParts(step.step, step.detail)
  if (parts.length === 0) return null
  if (parts.every((part) => part.kind === 'chip')) {
    return (
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {parts.map((part, i) => {
          const chip = 'inline-flex h-6 max-w-full items-center truncate rounded-[3px] bg-raised px-2 text-[12px] text-ink-dim'
          return (
            <li key={i} className="max-w-full">
              {part.kind === 'chip' && part.href ? (
                <a href={part.href} target="_blank" rel="noreferrer" className={cn(chip, 'hover:text-ink')}>
                  {part.text}
                </a>
              ) : (
                <span className={chip}>{part.text}</span>
              )}
            </li>
          )
        })}
      </ul>
    )
  }
  return (
    <p className="mt-1 break-words text-[13px] leading-5 text-ink-dim">
      {parts.map((part, i) =>
        part.kind === 'link' ? (
          <a key={i} href={part.href} target="_blank" rel="noreferrer" className="text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink">
            {part.text}
          </a>
        ) : (
          <span key={i}>{grouped(part.text)}</span>
        ),
      )}
    </p>
  )
}

function StepsPanel({ frame }: { frame: RunFrame }) {
  return (
    <Panel title="What it did" aside={<span className="text-[13px] tabular-nums text-ink-muted">{`${frame.steps.length} step${frame.steps.length === 1 ? '' : 's'}`}</span>}>
      {frame.steps.length === 0 ? (
        <p className="text-[13px] text-ink-muted">The first step shows here as soon as the worker picks the search up.</p>
      ) : (
        <ol className="-my-3 divide-y divide-line">
          {frame.steps.map((step) => {
            const now = frame.current?.id === step.id
            const muted = step.kind === 'dead-end'
            return (
              <li key={step.id} className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-3 py-3 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-200">
                <span className="pt-px text-[13px] tabular-nums text-ink-muted">{clock(step.offset)}</span>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <span className={cn('text-[14px] font-medium', muted ? 'text-ink-muted' : step.kind === 'failed' ? 'text-signal' : 'text-ink')}>{step.step}</span>
                    {now && <LoaderCircle size={13} className="animate-spin text-ink-dim motion-reduce:animate-none" aria-label="In progress" />}
                    {step.tool && <span className="text-[12px] text-ink-muted">{TOOL_LABEL[step.tool]}</span>}
                  </p>
                  <Detail step={step} />
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </Panel>
  )
}

function SourcesPanel({ frame }: { frame: RunFrame }) {
  const s = frame.setup
  const rows = [...s.sources.map((fact) => ({ label: fact.label || 'Page', url: fact.value })), ...s.floorPlans.map((url) => ({ label: 'Floor plan', url }))]
  return (
    <Panel title="Pages it kept" aside={<span className="text-[13px] tabular-nums text-ink-muted">{frame.finished ? `${rows.length}` : '–'}</span>}>
      {rows.length === 0 ? (
        <p className="text-[13px] text-ink-muted">{frame.finished ? 'The search kept no pages.' : 'Listed once the search ends.'}</p>
      ) : (
        <ul className="-my-2 divide-y divide-line">
          {rows.map((row) => (
            <li key={`${row.label}-${row.url}`} className="grid grid-cols-[8rem_minmax(0,1fr)] items-baseline gap-3 py-2">
              <span className="text-[13px] text-ink-muted">{row.label}</span>
              <a href={row.url} target="_blank" rel="noreferrer" className="flex min-w-0 items-baseline gap-1 text-[14px] text-ink hover:text-champagne-hover">
                <span className="truncate">{short(row.url)}</span>
                <ArrowUpRight size={12} className="flex-none text-ink-muted" aria-hidden="true" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function Figure({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0 sm:px-4 sm:first:pl-0 sm:last:pr-0">
      <dt className="text-[12px] text-ink-muted">{label}</dt>
      <dd className={cn('mt-1 whitespace-nowrap text-[18px] tabular-nums leading-6', value ? 'text-ink' : 'text-ink-muted')}>{value ?? '–'}</dd>
    </div>
  )
}

function ModelPanel({ run, frame }: { run: Run; frame: RunFrame }) {
  const [cut, setCut] = useState(true)
  const s = frame.setup
  const saved = s.status === 'ready' && Boolean(s.modelUrl)
  // A replay loads its model at once and shows it when the run gets there.
  const src = run.replay ? modelHref(run.setup.modelUrl) : saved ? modelHref(s.modelUrl) : null
  const capturing = frame.current?.step === 'Opening the 3D map'
  const empty = (() => {
    if (frame.finished && s.status === 'no model') return <p className="max-w-[36ch] text-[14px] text-ink-dim">{`No public 3D map of ${s.venueName || 'the venue'} was found on the event's pages.`}</p>
    if (frame.finished && s.status === 'failed') return <p className="max-w-[40ch] text-[14px] text-ink-dim">{s.error || 'The search stopped before it saved a model.'}</p>
    if (capturing && frame.current) {
      return (
        <div className="max-w-[44ch]">
          <p className="flex items-center justify-center gap-2 text-[14px] text-ink">
            <LoaderCircle size={14} className="animate-spin text-ink-dim motion-reduce:animate-none" aria-hidden="true" />
            Capturing the 3D map in a remote browser
          </p>
          <p className="mt-1.5 truncate text-[13px] text-ink-dim">{short(frame.current.detail)}</p>
          <p className="mt-1 text-[12px] tabular-nums text-ink-muted">{`${TOOL_LABEL.browser} · ${clock(frame.t - frame.current.offset)} so far`}</p>
        </div>
      )
    }
    return <p className="max-w-[36ch] text-[14px] text-ink-dim">The venue's model shows here once its public 3D map is captured.</p>
  })()
  return (
    <Panel
      title="The model"
      className="h-full"
      aside={
        <div role="group" aria-label="Roof" className="flex items-center gap-4 text-[13px]">
          <Choice on={cut} label="Roof cut away" onPick={() => setCut(true)} />
          <Choice on={!cut} label="Whole building" onPick={() => setCut(false)} />
        </div>
      }
    >
      <ModelView
        src={src}
        shown={saved}
        bytes={run.setup.modelBytes}
        cut={cut}
        empty={empty}
        label={saved ? `3D model of ${s.venueName || run.setup.eventName}` : 'No model yet'}
      />
      <dl className="mt-5 grid grid-cols-3 gap-y-4 sm:grid-cols-5 sm:divide-x sm:divide-line">
        <Figure label="Footprint" value={saved ? footprint(s) : null} />
        <Figure label="Height" value={saved ? `${Math.round(s.sizeY)} m` : null} />
        <Figure label="Triangles" value={saved ? s.triangles.toLocaleString('en-US') : null} />
        <Figure label="Meshes" value={saved ? s.meshes.toLocaleString('en-US') : null} />
        <Figure label="File" value={saved && s.modelBytes ? megabytes(s.modelBytes) : null} />
      </dl>
      <p className="mt-4 text-[13px] leading-5 text-ink-dim">
        {saved
          ? `Captured from ${short(s.mapUrl)} as a ${s.method || '3D model'} by the ${TOOL_LABEL.browser}.`
          : s.mapUrl
            ? `Opening ${short(s.mapUrl)}.`
            : 'No 3D map picked yet.'}
      </p>
    </Panel>
  )
}

// ---------------------------------------------------------------------------------- the page

export function VenuePage() {
  const setups = useVenueSetup((s) => s.setups)
  const allSteps = useVenueSetup((s) => s.steps)
  const palace = useMemo(() => palaceRun(), [])
  const runs = useMemo(() => [palace, ...setups.filter((s) => s.id !== DEFAULT_SETUP_ID).map((s) => buildRun(s, allSteps))], [palace, setups, allSteps])
  const [picked, setPicked] = useState<string>(() => setups.find((s) => s.status === 'running')?.id ?? DEFAULT_SETUP_ID)
  // After a search starts here, the newest running search is shown until someone picks another.
  const [follow, setFollow] = useState(false)
  const newest = setups.find((s) => s.status === 'running')
  const selected = follow && newest ? newest.id : picked
  const run = runs.find((item) => item.setup.id === selected) ?? palace

  const [t, setT] = useState(palace.duration)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<Speed>('fit')
  const [now, setNow] = useState(() => Date.now())

  // The replay clock. Run time moves faster than the wall clock at 4× and "in 30 s".
  const tNow = useRef(t)
  useEffect(() => {
    tNow.current = t
  }, [t])
  useEffect(() => {
    if (!playing || !run.replay) return
    let last = performance.now()
    const id = window.setInterval(() => {
      const at = performance.now()
      const next = Math.min(run.duration, tNow.current + (at - last) * speedFactor(speed, run.duration))
      last = at
      setT(next)
      if (next >= run.duration) setPlaying(false)
    }, 80)
    return () => window.clearInterval(id)
  }, [playing, speed, run])

  // A live run's elapsed time ticks while it works.
  const running = !run.replay && run.setup.status === 'running'
  useEffect(() => {
    if (!running) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [running])

  const select = (id: string) => {
    setPicked(id)
    setFollow(false)
    setPlaying(false)
    const next = runs.find((item) => item.setup.id === id)
    if (next?.replay) setT(next.duration)
  }

  const frame = frameAt(run, t, now)
  const spans = stageSpans(run, frame)
  const active = activeStage(frame, spans)
  const meta = run.replay
    ? `Reconstructed from the model saved ${when(run.replay.savedAt)}. Step times are approximate.`
    : `Started ${when(run.start)} · ${clock(frame.span)}${frame.finished ? ' in all' : ' so far'}`

  return (
    <DeskFrame motif="venue">
      <Toolbar runs={runs} selected={run.setup.id} onSelect={select} onStarted={() => setFollow(true)} />

      <section aria-labelledby="venue-run" className="mt-12">
        <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h2 id="venue-run" className="text-[20px] font-semibold leading-7 tracking-[-0.01em] text-ink">
                {venueTitle(run, frame)}
              </h2>
              {statusPill(frame.status, Boolean(run.replay))}
            </div>
            <p className="mt-1 text-[13px] text-ink-dim">{meta}</p>
          </div>
          <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
            {run.replay && (
              <ReplayControls
                run={run}
                frame={frame}
                playing={playing}
                speed={speed}
                onSpeed={setSpeed}
                onPause={() => setPlaying(false)}
                onPlay={() => {
                  if (t >= run.duration) setT(0)
                  setPlaying(true)
                }}
              />
            )}
            <UseVenue run={run} frame={frame} />
          </div>
        </div>

        <div className="mt-6">
          <RunStrip
            run={run}
            frame={frame}
            spans={spans}
            active={active}
            onSeek={
              run.replay
                ? (value) => {
                    setPlaying(false)
                    setT(value)
                  }
                : undefined
            }
          />
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-12">
          <div className="flex min-w-0 flex-col gap-6 lg:col-span-5">
            <StepsPanel frame={frame} />
            <SourcesPanel frame={frame} />
          </div>
          <div className="min-w-0 lg:col-span-7">
            <ModelPanel run={run} frame={frame} />
          </div>
        </div>
      </section>
    </DeskFrame>
  )
}
