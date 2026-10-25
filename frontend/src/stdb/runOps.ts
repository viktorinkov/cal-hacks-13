/**
 * The event run beside the session: the simulated night on the floor, its incidents, the decisions
 * taken on them, the stations and the gateway, and our real bands placed among the crowd. The
 * session hands its socket over through link.ts. This module subscribes the run tables on it, reads
 * them with the session's own tables into one store, and calls the run reducers.
 */
import { useMemo } from 'react'
import { create } from 'zustand'
import { formatCents } from '@/cover/money'
import type { DbConnection } from './module_bindings'
import { linkDb, linkReducers, messageOf, millisOf, num, onLink, rowsOf, subscribeEach, tag, text, watchTables } from './link'
import { useSession } from './session'

export type RunPhase = 'idle' | 'running' | 'closing' | 'ended'

export interface LiveRun {
  phase: RunPhase
  crowd: number
  pace: number
  startedAt: number
  endsAt: number
  closingAt: number
  endedAt: number
  nextIncidentAt: number
  step: number
  /** u64, kept as text so it is shown exactly. */
  seed: string
}

export interface RunMarker {
  incidentId: string
  kind: string
  bandId: number
  person: string
  xM: number
  yM: number
  stationId: number
  place: string
  status: string
  medic: string
  openedAt: number
  respondingAt: number
  resolvedAt: number
  claimId: string
  claimStatus: string
  payoutCents: number
}

export interface RunDecision {
  id: string
  at: number
  incidentId: string
  claimId: string
  actor: string
  who: string
  what: string
  why: string
}

export interface RunStation {
  id: number
  exitColour: number
  online: boolean
  lastSeen: number
}

export interface RunGateway {
  online: boolean
  lastLine: number
}

export interface PlacedBand {
  bandId: number
  xM: number
  yM: number
  stationId: number
  label: string
  placedAt: number
}

export interface RunBand {
  id: number
  online: boolean
  lastSeen: number
  zone: number
  neigh: number
  sos: boolean
  fall: boolean
  hasPosition: boolean
}

export interface RunZone {
  id: string
  name: string
  stationId: number
  capacity: number
  exitColour: number
  xM: number
  yM: number
}

export interface RunAttendee {
  nodeId: string
  displayName: string
  bandId: number
  crowd: boolean
  organization: string
}

export interface RunClaim {
  id: string
  incidentId: string
  status: string
  payoutCents: number
  packHash: string
}

export interface RunCharge {
  id: string
  incidentId: string
  attendeeName: string
  status: string
  amountCents: number
}

export interface RunOrder {
  id: string
  createdAt: number
  status: string
  amountCents: number
}

export interface RunOpenIncident {
  id: string
  kind: string
  status: string
  zoneId: string
  subjectBand: number
  openedAt: number
}

/** Who wears a band before it goes on the floor. nodeId '0' adds a new attendee by name. */
export interface Wearer {
  nodeId: string
  name: string
}

export interface RunState {
  linked: boolean
  /** How each of this module's queries answered. */
  queries: Record<string, 'open' | 'refused'>
  refusals: Record<string, string>
  busy: string | null
  error: { key: string; message: string } | null
  /** The incident whose decisions are shown, or null for all of them. */
  focus: string | null
  run: LiveRun | null
  pausedAt: number | null
  evacuatingAt: number | null
  eventEnded: boolean
  markers: RunMarker[]
  plans: { incidentId: string; culpritBand: number }[]
  decisions: RunDecision[]
  stations: RunStation[]
  gateway: RunGateway | null
  placed: PlacedBand[]
  bands: RunBand[]
  zones: RunZone[]
  attendees: RunAttendee[]
  claims: RunClaim[]
  charges: RunCharge[]
  orders: RunOrder[]
  incidents: RunOpenIncident[]
  yellow: number
  red: number
  lowVis: boolean
}

const EMPTY: RunState = {
  linked: false,
  queries: {},
  refusals: {},
  busy: null,
  error: null,
  focus: null,
  run: null,
  pausedAt: null,
  evacuatingAt: null,
  eventEnded: false,
  markers: [],
  plans: [],
  decisions: [],
  stations: [],
  gateway: null,
  placed: [],
  bands: [],
  zones: [],
  attendees: [],
  claims: [],
  charges: [],
  orders: [],
  incidents: [],
  yellow: 3,
  red: 5,
  lowVis: false,
}

export const useRun = create<RunState>(() => EMPTY)

/** The tables the session does not subscribe. Requested one at a time on each socket. */
export const RUN_QUERIES = [
  'SELECT * FROM live_run',
  'SELECT * FROM live_pause',
  'SELECT * FROM live_evacuation',
  'SELECT * FROM incident_marker',
  'SELECT * FROM live_plan',
  'SELECT * FROM decision',
  'SELECT * FROM station',
  'SELECT * FROM gateway',
  'SELECT * FROM band_place',
] as const

/** The start form's defaults, as on the dev portal. */
export const RUN_DEFAULTS = { crowd: 1000, minutes: 12, pace: 8 } as const
export const RUN_LIMITS = { crowd: [1, 2000], minutes: [1, 240], pace: [1, 30] } as const

/** Bands 90 to 99 are the test bands. Ids from 100 are the simulated crowd. */
export const TEST_BANDS = { from: 90, to: 99 } as const
export const CROWD_FROM = 100
export const DECISION_LIMIT = 60
export const WEARER_LIMIT = 8

export const EXIT_COLOURS = ['none', 'blue', 'magenta', 'cyan', 'white', 'orange', 'violet'] as const

const MARKER_KIND: Record<string, string> = {
  sos: 'SOS',
  fall: 'fall',
  property: 'equipment broken',
  theft: 'stolen from the venue',
  breakage: 'equipment broken',
}

const ALERT_KIND: Record<string, string> = {
  sos: 'SOS',
  fall: 'fall',
  property: 'venue equipment broken',
  theft: 'stolen from the venue',
  breakage: 'venue equipment broken',
}

const CHARGE_STATUS: Record<string, string> = {
  proposed: 'waits for the organizer',
  approved: 'to pay',
  paying: 'paying',
  paid: 'paid',
  disputed: 'disputed',
  waived: 'waived',
}

const PHASES: readonly RunPhase[] = ['idle', 'running', 'closing', 'ended']

type RunReducers = {
  startLiveRun(args: { crowdSize: number; minutes: number; pace: number; fresh: boolean; seed: bigint }): Promise<unknown>
  pauseLiveRun(args: Record<string, never>): Promise<unknown>
  resumeLiveRun(args: Record<string, never>): Promise<unknown>
  evacuateLiveRun(args: { on: boolean }): Promise<unknown>
  endLiveRun(args: Record<string, never>): Promise<unknown>
  endEvent(args: Record<string, never>): Promise<unknown>
  reopenEvent(args: Record<string, never>): Promise<unknown>
  startCrowd(args: { size: number }): Promise<unknown>
  stopCrowd(args: Record<string, never>): Promise<unknown>
  wakeCrowd(args: Record<string, never>): Promise<unknown>
  approveClaim(args: { claimId: bigint; amountSeenCents: bigint; packHashSeen: string }): Promise<unknown>
  giveBand(args: { bandId: number; nodeId: bigint; name: string }): Promise<unknown>
  placeBand(args: { bandId: number; xM: number; yM: number; label: string }): Promise<unknown>
  unplaceBand(args: { bandId: number }): Promise<unknown>
  setLowVis(args: { on: boolean }): Promise<unknown>
}

// ------------------------------------------------------------------------------------- reading

function idOf(value: unknown): string {
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  return text(value)
}

function zeroRow(table: unknown): Record<string, unknown> | undefined {
  const rows = rowsOf(table)
  return rows.find((row) => num(row.id) === 0) ?? rows[0]
}

function readRunRow(row: Record<string, unknown> | undefined): LiveRun | null {
  if (!row) return null
  const phase = tag(row.phase)
  return {
    phase: PHASES.includes(phase as RunPhase) ? (phase as RunPhase) : 'idle',
    crowd: num(row.crowd),
    pace: num(row.pace),
    startedAt: millisOf(row.startedAt),
    endsAt: millisOf(row.endsAt),
    closingAt: millisOf(row.closingAt),
    endedAt: millisOf(row.endedAt),
    nextIncidentAt: millisOf(row.nextIncidentAt),
    step: num(row.step),
    seed: idOf(row.seed) || '0',
  }
}

function momentOf(row: Record<string, unknown> | undefined, field: string): number | null {
  if (!row) return null
  return millisOf(row[field]) || Date.now()
}

type Db = Record<string, unknown>

/** One reader per table accessor, so a change to one table re-reads only that table. */
const READERS: Record<string, (db: Db) => Partial<RunState>> = {
  livePlan: (db) => ({ plans: rowsOf(db.livePlan).map((row) => ({ incidentId: idOf(row.incidentId), culpritBand: num(row.culpritBand) })) }),
  liveRun: (db) => ({ run: readRunRow(zeroRow(db.liveRun)) }),
  livePause: (db) => ({ pausedAt: momentOf(zeroRow(db.livePause), 'pausedAt') }),
  liveEvacuation: (db) => ({ evacuatingAt: momentOf(zeroRow(db.liveEvacuation), 'startedAt') }),
  incidentMarker: (db) => ({
    markers: rowsOf(db.incidentMarker).map((row) => ({
      incidentId: idOf(row.incidentId),
      kind: text(row.kind).toLowerCase(),
      bandId: num(row.bandId),
      person: text(row.person),
      xM: num(row.xM),
      yM: num(row.yM),
      stationId: num(row.stationId),
      place: text(row.place),
      status: text(row.status).toLowerCase(),
      medic: text(row.medic),
      openedAt: millisOf(row.openedAt),
      respondingAt: millisOf(row.respondingAt),
      resolvedAt: millisOf(row.resolvedAt),
      claimId: num(row.claimId) ? idOf(row.claimId) : '',
      claimStatus: text(row.claimStatus),
      payoutCents: num(row.payoutCents),
    })),
  }),
  decision: (db) => ({
    decisions: rowsOf(db.decision).map((row) => ({
      id: idOf(row.id),
      at: millisOf(row.at),
      incidentId: num(row.incidentId) ? idOf(row.incidentId) : '',
      claimId: num(row.claimId) ? idOf(row.claimId) : '',
      actor: text(row.actor),
      who: text(row.who),
      what: text(row.what),
      why: text(row.why),
    })),
  }),
  station: (db) => ({
    stations: rowsOf(db.station).map((row) => ({
      id: num(row.id),
      exitColour: num(row.exitColour),
      online: row.online === true,
      lastSeen: millisOf(row.lastSeen),
    })),
  }),
  gateway: (db) => {
    const row = zeroRow(db.gateway)
    return { gateway: row ? { online: row.online === true, lastLine: millisOf(row.lastLine) } : null }
  },
  bandPlace: (db) => ({
    placed: rowsOf(db.bandPlace)
      .map((row) => ({
        bandId: num(row.bandId),
        xM: num(row.xM),
        yM: num(row.yM),
        stationId: num(row.stationId),
        label: text(row.label),
        placedAt: millisOf(row.placedAt),
      }))
      .sort((a, b) => a.bandId - b.bandId),
  }),
  band: (db) => ({
    bands: rowsOf(db.band).map((row) => ({
      id: num(row.id),
      online: row.online === true,
      lastSeen: millisOf(row.lastSeen),
      zone: num(row.zone),
      neigh: num(row.neigh),
      sos: row.sos === true,
      fall: row.fall === true,
      hasPosition: Number.isFinite(Number(row.xM)) && Number.isFinite(Number(row.yM)),
    })),
  }),
  zone: (db) => ({
    zones: rowsOf(db.zone)
      .map((row) => ({
        id: idOf(row.id),
        name: text(row.name),
        stationId: num(row.stationId),
        capacity: num(row.capacity),
        exitColour: num(row.exitColour),
        xM: num(row.planXM),
        yM: num(row.planYM),
      }))
      .sort((a, b) => a.stationId - b.stationId),
  }),
  settings: (db) => {
    const row = zeroRow(db.settings)
    return {
      yellow: row && row.yellow != null ? num(row.yellow) : 3,
      red: row && row.red != null ? num(row.red) : 5,
      lowVis: row?.lowVis === true,
    }
  },
  eventState: (db) => ({ eventEnded: zeroRow(db.eventState)?.ended === true }),
  boardAttendees: (db) => ({
    attendees: rowsOf(db.boardAttendees).map((row) => ({
      nodeId: idOf(row.nodeId),
      displayName: text(row.displayName),
      bandId: num(row.bandId),
      crowd: row.crowd === true,
      organization: text(row.organization),
    })),
  }),
  claimsBoard: (db) => ({
    claims: rowsOf(db.claimsBoard).map((row) => ({
      id: idOf(row.id),
      incidentId: idOf(row.incidentId),
      status: tag(row.status),
      payoutCents: num(row.payoutCents),
      packHash: text(row.packHash),
    })),
  }),
  boardCharges: (db) => ({
    charges: rowsOf(db.boardCharges).map((row) => ({
      id: idOf(row.id),
      incidentId: idOf(row.incidentId),
      attendeeName: text(row.attendeeName),
      status: text(row.status).toLowerCase(),
      amountCents: num(row.amountCents),
    })),
  }),
  boardMerchOrders: (db) => ({
    orders: rowsOf(db.boardMerchOrders).map((row) => ({
      id: idOf(row.id),
      createdAt: millisOf(row.createdAt),
      status: text(row.status).toLowerCase(),
      amountCents: num(row.amountCents),
    })),
  }),
  openIncidents: (db) => ({
    incidents: rowsOf(db.openIncidents).map((row) => ({
      id: idOf(row.id),
      kind: tag(row.kind),
      status: tag(row.status),
      zoneId: idOf(row.zoneId),
      subjectBand: num(row.subjectBand),
      openedAt: millisOf(row.openedAt),
    })),
  }),
}

export const RUN_TABLES = Object.keys(READERS)

/** Read these tables (all of them by default) from the current socket into the store. */
export function refreshRun(names: readonly string[] = RUN_TABLES): void {
  const db = linkDb()
  if (!db) return
  const next: Partial<RunState> = {}
  for (const name of names) Object.assign(next, READERS[name]?.(db))
  useRun.setState(next)
}

const dirty = new Set<string>()
let flushTimer = 0

function flush() {
  flushTimer = 0
  const names = [...dirty]
  dirty.clear()
  refreshRun(names)
}

/** Bands change many times a second. Changes are gathered and read together. */
function mark(name: string) {
  dirty.add(name)
  if (!flushTimer) flushTimer = window.setTimeout(flush, 150)
}

function attach(conn: DbConnection) {
  useRun.setState({ linked: true, queries: {}, refusals: {} })
  for (const name of RUN_TABLES) watchTables(conn, [name], () => mark(name))
  refreshRun()
  subscribeEach(conn, RUN_QUERIES, {
    applied: (query) => {
      useRun.setState((s) => ({ queries: { ...s.queries, [query]: 'open' } }))
      refreshRun()
    },
    refused: (query, reason) => {
      useRun.setState((s) => ({ queries: { ...s.queries, [query]: 'refused' }, refusals: { ...s.refusals, [query]: reason } }))
    },
  })
}

function drop() {
  if (flushTimer) window.clearTimeout(flushTimer)
  flushTimer = 0
  dirty.clear()
  useRun.setState({ ...EMPTY, focus: useRun.getState().focus })
}

onLink(attach, drop)

// ------------------------------------------------------------------------------------- actions

const ANSWER_MS = 10_000

function answered<T>(work: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('The database did not answer in time. Check the run before you try again.')), ANSWER_MS)
    work.then(
      (value) => {
        window.clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        window.clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(messageOf(error)))
      },
    )
  })
}

function refuse(key: string, message: string): false {
  useRun.setState({ error: { key, message } })
  return false
}

/** One reducer call. The refusal is kept in the store under `key`; the result says whether it landed. */
async function call(key: string, work: (reducers: RunReducers) => Promise<unknown>): Promise<boolean> {
  useRun.setState({ busy: key, error: null })
  try {
    await answered(Promise.resolve().then(() => work(linkReducers<RunReducers>())))
    refreshRun()
    return true
  } catch (error) {
    return refuse(key, messageOf(error))
  } finally {
    useRun.setState((s) => (s.busy === key ? { busy: null } : {}))
  }
}

function whole(value: number, [low, high]: readonly [number, number]): boolean {
  return Number.isInteger(value) && value >= low && value <= high
}

export interface StartInput {
  crowd: number
  minutes: number
  pace: number
  fresh: boolean
  /** 0 picks a new seed; the same seed sends the same people to the same spots and stages the same incidents. */
  seed?: bigint
}

export function startRun(input: StartInput): Promise<boolean> {
  if (!whole(input.crowd, RUN_LIMITS.crowd)) return Promise.resolve(refuse('start', 'People must be a whole number from 1 to 2,000.'))
  if (!whole(input.minutes, RUN_LIMITS.minutes)) return Promise.resolve(refuse('start', 'Minutes must be a whole number from 1 to 240.'))
  if (!whole(input.pace, RUN_LIMITS.pace)) return Promise.resolve(refuse('start', 'Speed must be a whole number from 1 to 30.'))
  const seed = input.seed ?? 0n
  if (seed < 0n) return Promise.resolve(refuse('start', 'The seed cannot be negative.'))
  return call('start', (r) => r.startLiveRun({ crowdSize: input.crowd, minutes: input.minutes, pace: input.pace, fresh: input.fresh, seed }))
}

export function pauseRun(): Promise<boolean> {
  return call('pause', (r) => r.pauseLiveRun({}))
}

export function resumeRun(): Promise<boolean> {
  return call('resume', (r) => r.resumeLiveRun({}))
}

export function evacuateRun(on: boolean): Promise<boolean> {
  return call('evacuate', (r) => r.evacuateLiveRun({ on }))
}

export function endRun(): Promise<boolean> {
  return call('end', (r) => r.endLiveRun({}))
}

export function setRunLowVis(on: boolean): Promise<boolean> {
  return call('lowvis', (r) => r.setLowVis({ on }))
}

/** end_event flips every band's page to the recap, whether or not a run is live. */
export function endEventRun(): Promise<boolean> {
  return call('end-event', (r) => r.endEvent({}))
}

export function reopenEventRun(): Promise<boolean> {
  return call('reopen', (r) => r.reopenEvent({}))
}

/** Re-seeds the crowd at `size` and re-arms its backend ticker. */
export function restartCrowd(size: number): Promise<boolean> {
  if (!whole(size, RUN_LIMITS.crowd)) return Promise.resolve(refuse('crowd', 'The crowd must be a whole number from 1 to 2,000.'))
  return call('crowd', (r) => r.startCrowd({ size }))
}

/** Resumes the crowd's backend ticker where it froze, without reseeding anyone. */
export function wakeCrowd(): Promise<boolean> {
  return call('crowd', (r) => r.wakeCrowd({}))
}

/** Freezes the crowd where it stands. */
export function stopCrowdNow(): Promise<boolean> {
  return call('crowd', (r) => r.stopCrowd({}))
}

/** Approve a claim routed to the organizer, at the amount and pack shown on screen. */
export function approveRunClaim(claim: RunClaim): Promise<boolean> {
  return call(`approve:${claim.id}`, (r) =>
    r.approveClaim({ claimId: BigInt(claim.id), amountSeenCents: BigInt(Math.round(claim.payoutCents)), packHashSeen: claim.packHash }),
  )
}

export interface PlaceInput {
  bandId: number
  xM: number
  yM: number
  wearer: Wearer | null
}

/**
 * Give the band to its wearer first when one is chosen, then put it on the floor. A band already on
 * the floor moved without a new wearer keeps its label.
 */
export function placeRunBand(input: PlaceInput): Promise<boolean> {
  if (!Number.isInteger(input.bandId) || input.bandId < 1) return Promise.resolve(refuse('place', 'Choose a band.'))
  if (!Number.isFinite(input.xM) || !Number.isFinite(input.yM)) return Promise.resolve(refuse('place', 'Type where it goes: X and Y in metres.'))
  const wearer = input.wearer
  const label = wearer?.name ?? useRun.getState().placed.find((row) => row.bandId === input.bandId)?.label ?? ''
  return call('place', async (r) => {
    if (wearer) await r.giveBand({ bandId: input.bandId, nodeId: BigInt(wearer.nodeId || '0'), name: wearer.name })
    await r.placeBand({ bandId: input.bandId, xM: input.xM, yM: input.yM, label })
  })
}

export function unplaceRunBand(bandId: number): Promise<boolean> {
  return call(`unplace:${bandId}`, (r) => r.unplaceBand({ bandId }))
}

export function focusIncident(id: string | null): void {
  useRun.setState({ focus: id })
}

export function clearRunError(): void {
  useRun.setState({ error: null })
}

/** The refusal for one of these keys, or a key that starts with `prefix:`. */
export function errorFor(error: RunState['error'], ...keys: string[]): string {
  if (!error) return ''
  return keys.some((key) => error.key === key || (key.endsWith(':') && error.key.startsWith(key))) ? error.message : ''
}

/** Organizers and the owner run the event. Everyone else reads. */
export function useOps(): boolean {
  return useSession((s) => s.owner || s.roles.includes('ops'))
}

// ------------------------------------------------------------------------------------- derived

export function clock(ms: number): string {
  return ms ? new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
}

/** A band at the event: a simulated one is online until it leaves; a real one must have spoken in the last 5 s. */
export function isOnline(band: RunBand, now: number): boolean {
  return band.online && (band.id >= CROWD_FROM || now - band.lastSeen < 5000)
}

export function levelOf(average: number, yellow: number, red: number): 'normal' | 'busy' | 'very busy' {
  return average >= red ? 'very busy' : average >= yellow ? 'busy' : 'normal'
}

export function markerKind(kind: string): string {
  return MARKER_KIND[kind.toLowerCase()] ?? kind
}

export function alertKind(kind: string): string {
  return ALERT_KIND[kind.toLowerCase()] ?? kind
}

export function chargeLine(charge: RunCharge | undefined): string {
  if (!charge) return ''
  return `charge to ${charge.attendeeName}: ${CHARGE_STATUS[charge.status] ?? charge.status}${charge.amountCents ? `, ${formatCents(charge.amountCents)}` : ''}`
}

export function exitName(colour: number): string {
  return EXIT_COLOURS[colour] ?? String(colour)
}

export function isLive(run: LiveRun | null): boolean {
  return run?.phase === 'running' || run?.phase === 'closing'
}

/** The run's state in one line, as the dev portal words it. */
export function phaseLine(run: LiveRun | null, pausedAt: number | null, evacuatingAt: number | null): string {
  if (!run || run.phase === 'idle') return 'Not started'
  if (pausedAt) return `Paused since ${clock(pausedAt)}`
  if (run.phase === 'running' && evacuatingAt) return `Evacuating since ${clock(evacuatingAt)}, everyone walking out`
  if (run.phase === 'running') return 'Running'
  if (run.phase === 'closing') return `Doors closed at ${clock(run.closingAt)}, everyone walking out`
  return `Ended at ${clock(run.endedAt)}`
}

/** The incidents of this run, newest first. Nothing before the run started. */
export function runIncidents(markers: readonly RunMarker[], run: LiveRun | null): RunMarker[] {
  if (!run) return []
  return markers.filter((marker) => marker.openedAt >= run.startedAt).sort((a, b) => Number(BigInt(b.incidentId || '0') - BigInt(a.incidentId || '0')))
}

export interface RunSummary {
  phase: RunPhase
  live: boolean
  paused: boolean
  evacuating: boolean
  line: string
  crowd: number
  /** Simulated crowd bands online now. */
  people: number
  incidents: RunMarker[]
  open: number
  /** Seconds to the next incident while the run is counting, else null. */
  nextIn: number | null
  claims: { paid: number; waiting: number; refused: number }
  purchases: { paying: number; paid: number; failed: number; salesCents: number }
  charges: { named: number; waiting: number; toPay: number; paid: number; waived: number }
}

export type SummaryInput = Pick<RunState, 'run' | 'pausedAt' | 'evacuatingAt' | 'markers' | 'bands' | 'charges' | 'orders'>

export function summarize(state: SummaryInput, now: number): RunSummary {
  const { run } = state
  const people = state.bands.filter((band) => band.id >= CROWD_FROM && isOnline(band, now)).length
  const incidents = runIncidents(state.markers, run)
  const counting = run?.phase === 'running' && !state.pausedAt && !state.evacuatingAt
  const ids = new Set(incidents.map((marker) => marker.incidentId))
  const charges = state.charges.filter((charge) => ids.has(charge.incidentId))
  const chargeCount = (...statuses: string[]) => charges.filter((charge) => statuses.includes(charge.status)).length
  const orders = run ? state.orders.filter((order) => order.createdAt >= run.startedAt) : []
  const paidOrders = orders.filter((order) => order.status === 'paid')
  const claimCount = (status: string) => incidents.filter((marker) => marker.claimStatus === status).length
  return {
    phase: run?.phase ?? 'idle',
    live: isLive(run),
    paused: state.pausedAt != null,
    evacuating: state.evacuatingAt != null,
    line: phaseLine(run, state.pausedAt, state.evacuatingAt),
    crowd: run?.crowd ?? 0,
    people,
    incidents,
    open: incidents.filter((marker) => marker.status !== 'resolved').length,
    nextIn: counting && run ? Math.max(0, Math.round((run.nextIncidentAt - now) / 1000)) : null,
    claims: {
      paid: incidents.filter((marker) => marker.claimStatus.startsWith('paid')).length,
      waiting: claimCount('waiting for the organizer'),
      refused: claimCount('refused'),
    },
    purchases: {
      paying: orders.filter((order) => order.status === 'paying').length,
      paid: paidOrders.length,
      failed: orders.filter((order) => order.status === 'failed').length,
      salesCents: paidOrders.reduce((sum, order) => sum + order.amountCents, 0),
    },
    charges: {
      named: charges.length,
      waiting: chargeCount('proposed', 'disputed'),
      toPay: chargeCount('approved', 'paying'),
      paid: chargeCount('paid'),
      waived: chargeCount('waived'),
    },
  }
}

/** The summary, re-derived when the run tables change or the clock ticks. */
export function useRunSummary(now: number): RunSummary {
  const run = useRun((s) => s.run)
  const pausedAt = useRun((s) => s.pausedAt)
  const evacuatingAt = useRun((s) => s.evacuatingAt)
  const markers = useRun((s) => s.markers)
  const bands = useRun((s) => s.bands)
  const charges = useRun((s) => s.charges)
  const orders = useRun((s) => s.orders)
  return useMemo(() => summarize({ run, pausedAt, evacuatingAt, markers, bands, charges, orders }, now), [run, pausedAt, evacuatingAt, markers, bands, charges, orders, now])
}

export interface ZoneRow {
  id: string
  name: string
  stationId: number
  people: number
  hardware: number
  neighbours: number
  level: 'normal' | 'busy' | 'very busy'
  capacity: number
  exit: string
  stationOnline: boolean
}

export function zoneRows(zones: readonly RunZone[], online: readonly RunBand[], stations: readonly RunStation[], yellow: number, red: number): ZoneRow[] {
  const byStation = new Map(stations.map((station) => [station.id, station]))
  return zones.map((zone) => {
    const here = online.filter((band) => band.zone === zone.stationId)
    const neighbours = here.length ? here.reduce((sum, band) => sum + band.neigh, 0) / here.length : 0
    return {
      id: zone.id,
      name: zone.name,
      stationId: zone.stationId,
      people: here.length,
      hardware: here.filter((band) => band.id < CROWD_FROM).length,
      neighbours,
      level: levelOf(neighbours, yellow, red),
      capacity: zone.capacity,
      exit: exitName(zone.exitColour),
      stationOnline: byStation.get(zone.stationId)?.online === true,
    }
  })
}

/** Our real bands that can go on the floor: the test bands, ones already placed, and any online now. */
export function placeableBands(bands: readonly RunBand[], placed: readonly PlacedBand[], now: number): number[] {
  const placedIds = new Set(placed.map((row) => row.bandId))
  const byId = new Map(bands.map((band) => [band.id, band]))
  const ids: number[] = []
  for (let id = 1; id < CROWD_FROM; id += 1) {
    const band = byId.get(id)
    if ((id >= TEST_BANDS.from && id <= TEST_BANDS.to) || placedIds.has(id) || (band && isOnline(band, now))) ids.push(id)
  }
  return ids
}

/** Real attendees (not the simulated crowd) whose name or company holds every word typed. */
export function wearerMatches(attendees: readonly RunAttendee[], query: string): RunAttendee[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return attendees
    .filter((person) => !person.crowd && words.every((word) => `${person.displayName} ${person.organization}`.toLowerCase().includes(word)))
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
}

/** Decisions, newest first, for one incident or all, matching every search word. */
export function shownDecisions(decisions: readonly RunDecision[], focus: string | null, query: string): { rows: RunDecision[]; total: number } {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const scoped = focus == null ? decisions : decisions.filter((row) => row.incidentId === focus)
  const matching = words.length
    ? scoped.filter((row) => {
        const line = `${clock(row.at)} ${row.incidentId} ${row.who} ${row.actor} ${row.what} ${row.why}`.toLowerCase()
        return words.every((word) => line.includes(word))
      })
    : [...scoped]
  matching.sort((a, b) => Number(BigInt(b.id || '0') - BigInt(a.id || '0')))
  return { rows: matching.slice(0, DECISION_LIMIT), total: matching.length }
}
