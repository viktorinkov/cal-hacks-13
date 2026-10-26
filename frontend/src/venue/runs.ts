import type { VenueSetupView, VenueStepView } from '@/stdb/venueSetup'

/** The four parts of a run, in order. Save is the moment the model lands, so it has no length. */
export type Stage = 'search' | 'read' | 'capture' | 'save'
export type Tool = 'search' | 'unlocker' | 'browser' | 'claude'
export type StepKind = 'progress' | 'dead-end' | 'failed' | 'done'

export const STAGES: { id: Stage; label: string }[] = [
  { id: 'search', label: 'Search' },
  { id: 'read', label: 'Read' },
  { id: 'capture', label: 'Capture' },
  { id: 'save', label: 'Save' },
]

/** What did each step. Kept in one place so the names can change in one edit. */
export const TOOL_LABEL: Record<Tool, string> = {
  search: 'Bright Data SERP API',
  unlocker: 'Bright Data Web Unlocker',
  browser: 'Bright Data Browser API',
  claude: 'Claude',
}

/** The tools a stage uses, for the strip's labels. */
export const STAGE_TOOLS: Record<Stage, Tool[]> = {
  search: ['search', 'claude'],
  read: ['unlocker', 'claude'],
  capture: ['browser'],
  save: [],
}

/** The worker's step names (crates/bandit-workers/src/venue.rs), and `Failed` from the module. */
const STEPS: Record<string, { stage: Stage; tool: Tool | null; kind: StepKind }> = {
  Searching: { stage: 'search', tool: 'search', kind: 'progress' },
  'Found the event': { stage: 'search', tool: 'claude', kind: 'progress' },
  'Reading pages': { stage: 'read', tool: 'unlocker', kind: 'progress' },
  'Opening the 3D map': { stage: 'capture', tool: 'browser', kind: 'progress' },
  'No model there': { stage: 'capture', tool: 'browser', kind: 'dead-end' },
  'No 3D map found': { stage: 'read', tool: 'claude', kind: 'failed' },
  'Saved the model': { stage: 'save', tool: null, kind: 'done' },
  Failed: { stage: 'save', tool: null, kind: 'failed' },
}

export function describeStep(step: string): { stage: Stage; tool: Tool | null; kind: StepKind } {
  return STEPS[step] ?? { stage: 'search', tool: null, kind: 'progress' }
}

export interface RunStep {
  id: string
  step: string
  detail: string
  /** Milliseconds from the start of the run. */
  offset: number
  stage: Stage
  tool: Tool | null
  kind: StepKind
}

export interface Replay {
  /** True when the run was put back together from saved files rather than recorded as it ran. */
  reconstructed: boolean
  /** When the model it ends on was saved. */
  savedAt: number
}

export interface Run {
  setup: VenueSetupView
  steps: RunStep[]
  start: number
  /** The last step's offset. A running run grows with the clock instead. */
  duration: number
  replay: Replay | null
}

export function buildRun(setup: VenueSetupView, steps: VenueStepView[], replay: Replay | null = null): Run {
  const own = steps.filter((step) => step.setupId === setup.id).sort((a, b) => a.at - b.at || Number(a.id) - Number(b.id))
  const start = setup.createdAt || own[0]?.at || 0
  const runSteps = own.map((step) => ({
    id: step.id,
    step: step.step,
    detail: step.detail,
    offset: Math.max(0, step.at - start),
    ...describeStep(step.step),
  }))
  return { setup, steps: runSteps, start, duration: runSteps.at(-1)?.offset ?? 0, replay }
}

/** The run as it stood `t` ms after it started. A finished live run is shown whole. */
export interface RunFrame {
  t: number
  /** How long the run has taken so far, or in all once it ended. */
  span: number
  steps: RunStep[]
  status: string
  finished: boolean
  current: RunStep | null
  /** The fields a viewer could know at `t`: the venue after it is found, the model after it is saved. */
  setup: VenueSetupView
}

function has(steps: RunStep[], name: string): boolean {
  return steps.some((step) => step.step === name)
}

export function frameAt(run: Run, t: number, now = Date.now()): RunFrame {
  const live = !run.replay
  const running = live && run.setup.status === 'running'
  const span = running ? Math.max(run.duration, now - run.start) : run.duration
  const at = live ? span : Math.min(Math.max(0, t), run.duration)
  const steps = live ? run.steps : run.steps.filter((step) => step.offset <= at)
  const finished = live ? !running : at >= run.duration
  const status = finished ? run.setup.status : 'running'
  const s = run.setup
  const found = has(steps, 'Found the event') || finished
  const opened = has(steps, 'Opening the 3D map') || finished
  const saved = has(steps, 'Saved the model') || (finished && s.status === 'ready')
  return {
    t: at,
    span,
    steps,
    status,
    finished,
    current: finished ? null : steps.at(-1) ?? null,
    setup: {
      ...s,
      status,
      eventSite: found ? s.eventSite : '',
      venueName: found ? s.venueName : '',
      address: found ? s.address : '',
      mapUrl: opened ? s.mapUrl : '',
      method: saved ? s.method : '',
      modelUrl: saved ? s.modelUrl : '',
      modelBytes: saved ? s.modelBytes : 0,
      meshes: saved ? s.meshes : 0,
      triangles: saved ? s.triangles : 0,
      places: saved ? s.places : 0,
      sizeX: saved ? s.sizeX : 0,
      sizeY: saved ? s.sizeY : 0,
      sizeZ: saved ? s.sizeZ : 0,
      floorPlans: finished ? s.floorPlans : [],
      sources: finished ? s.sources : [],
      error: finished ? s.error : '',
    },
  }
}

export interface StageSpan {
  stage: Stage
  label: string
  from: number
  to: number
  /** Reached by `t`. */
  reached: boolean
  steps: RunStep[]
}

/** Search, read and capture as spans of the run's time. Save is a moment, shown as the strip's end. */
export function stageSpans(run: Run, frame: RunFrame): StageSpan[] {
  const end = Math.max(frame.span, run.duration)
  const firsts = STAGES.filter((s) => s.id !== 'save').map((s) => ({ ...s, first: run.steps.find((step) => step.stage === s.id)?.offset }))
  const present = firsts.filter((s) => s.first !== undefined) as (typeof firsts[number] & { first: number })[]
  return present.map((s, i) => {
    const from = i === 0 ? 0 : s.first
    const nextFirst = present[i + 1]?.first
    const saved = run.steps.find((step) => step.stage === 'save')?.offset
    const to = nextFirst ?? saved ?? end
    return {
      stage: s.id,
      label: s.label,
      from,
      to: Math.max(from, to),
      reached: frame.t >= from && frame.steps.some((step) => step.stage === s.id),
      steps: run.steps.filter((step) => step.stage === s.id),
    }
  })
}

/** The stage the playhead is in. Once a run ends, the last stage with a length. */
export function activeStage(frame: RunFrame, spans: StageSpan[]): Stage | null {
  if (spans.length === 0) return null
  if (frame.finished) return spans.at(-1)?.stage ?? null
  const inside = spans.filter((span) => span.reached)
  return inside.at(-1)?.stage ?? spans[0].stage
}

export type Speed = 'real' | 'x4' | 'fit'

export const SPEEDS: { id: Speed; label: string }[] = [
  { id: 'real', label: 'Real time' },
  { id: 'x4', label: '4×' },
  { id: 'fit', label: 'In 30 s' },
]

/** How many run milliseconds pass per wall-clock millisecond. */
export function speedFactor(speed: Speed, duration: number): number {
  if (speed === 'x4') return 4
  if (speed === 'fit') return Math.max(1, duration / 30_000)
  return 1
}

/** 0:07, 2:52, 12:05. */
export function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** An address without its scheme, `www.` and trailing slash. */
export function short(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '')
}

/** The bundled venue lives under the app's base; a saved model is a blob on the same host. */
export function modelHref(url: string): string {
  if (url.startsWith('/venue/')) return `${import.meta.env.BASE_URL}${url.slice(1)}`
  return url
}

export function hrefOf(value: string): string {
  return /^https?:\/\//.test(value) ? value : `https://${value}`
}

export type DetailPart = { kind: 'text'; text: string } | { kind: 'link'; href: string; text: string } | { kind: 'chip'; text: string; href?: string }

/** A step's detail as text, links and chips, so the pages and queries read at a glance. */
export function detailParts(step: string, detail: string): DetailPart[] {
  if (!detail) return []
  if (step === 'Searching') {
    const queries = [...detail.matchAll(/"([^"]+)"/g)].map((m) => m[1])
    if (queries.length) return queries.map((text) => ({ kind: 'chip', text }))
  }
  if (step === 'Reading pages') {
    return detail
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .map((text) => ({ kind: 'chip', text: short(text), href: hrefOf(text) }))
  }
  const parts: DetailPart[] = []
  const pattern = /https?:\/\/[^\s,;]+[^\s,;.:)]/g
  let last = 0
  for (const match of detail.matchAll(pattern)) {
    const at = match.index ?? 0
    if (at > last) parts.push({ kind: 'text', text: detail.slice(last, at) })
    parts.push({ kind: 'link', href: match[0], text: short(match[0]) })
    last = at + match[0].length
  }
  if (last < detail.length) parts.push({ kind: 'text', text: detail.slice(last) })
  return parts
}

export const STATUS_LABEL: Record<string, string> = {
  running: 'Working',
  ready: 'Model saved',
  'no model': 'No 3D model found',
  failed: 'Failed',
}

/** 213.9 × 96.7 m, rounded the way a plan is read. */
export function footprint(setup: Pick<VenueSetupView, 'sizeX' | 'sizeZ'>): string {
  return `${Math.round(setup.sizeX)} × ${Math.round(setup.sizeZ)} m`
}

export function megabytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}

/** The line under the title: what the selected run found, in the venue's own words. */
export function findingOf(frame: RunFrame, eventName: string): string {
  const s = frame.setup
  const where = s.venueName ? ` at the ${s.venueName.replace(/^the /i, '')}` : ''
  if (!frame.finished) {
    const step = frame.current
    const doing = step ? step.step.charAt(0).toLowerCase() + step.step.slice(1) : 'starting'
    return `${eventName}${where}: ${doing}, ${clock(frame.t)} in.`
  }
  if (s.status === 'ready') {
    const from = s.mapUrl ? ` from ${short(s.mapUrl)}` : ''
    return `${s.venueName || eventName}, captured${from}: ${footprint(s)}, ${s.triangles.toLocaleString('en-US')} triangles.`
  }
  if (s.status === 'no model') return `Found ${s.venueName || 'the venue'} for ${eventName}, but no public 3D map of it.`
  return `The search for ${eventName} stopped at ${clock(frame.span)}${s.error ? `: ${s.error}` : '.'}`
}
