/**
 * The organizer's developer desks: the Kibana views and the test bands. It reads band, zone and
 * board_attendees from the session's socket (the session already subscribes them), posts the
 * host's dev endpoints for bands 90 to 99, and opens incidents for broken or stolen equipment.
 * Mirrors the Kibana and Bands tabs of the organizer portal at dev.band1t.vip.
 */
import { create } from 'zustand'
import { HOST_FALLBACK, loadHostConfig, type HostConfig } from './host'
import type { DbConnection } from './module_bindings'
import { linkDb, linkReducers, messageOf, millisOf, num, onLink, rowsOf, text, watchTables } from './link'

/** The bands the host keeps for testing. The first four carry the claims story's attendees. */
export const TEST_BANDS = [90, 91, 92, 93, 94, 95, 96, 97, 98, 99] as const

/** Bands from here up are the ones testers claim from a tap link, and they have a button to press. */
export const PRESS_FROM = 94

/** Hardware bands start here. Their online flag is trusted as it is. */
export const HARDWARE_FROM = 100

/** A test band counts as online only while the host heard from it in the last five seconds. */
export const FRESH_MS = 5000

export interface TestBand {
  id: number
  online: boolean
  /** The station id of the zone the band was last heard in, 0 for none. */
  zone: number
  lastSeen: number
}

export interface TestZone {
  id: string
  name: string
  stationId: number
}

export type TestArea = 'bands' | 'property' | 'report'

export interface TestFailure {
  at: TestArea
  message: string
}

interface TestBandsState {
  linked: boolean
  bands: Record<number, TestBand>
  zones: TestZone[]
  /** The display name of whoever claimed each test band. A claimed band with no name yet maps to ''. */
  wearers: Record<number, string>
  host: HostConfig | null
  /** The key of the request in flight. */
  busy: string | null
  failure: TestFailure | null
}

export const useTestBands = create<TestBandsState>(() => ({
  linked: false,
  bands: {},
  zones: [],
  wearers: {},
  host: null,
  busy: null,
  failure: null,
}))

type TestReducers = {
  openIncident(args: { kind: string; zoneId: bigint; bandId: number; note: string }): Promise<unknown>
}

const testIds = new Set<number>(TEST_BANDS)

export function readTestBands(): void {
  const db = linkDb()
  const bands: Record<number, TestBand> = {}
  for (const row of rowsOf(db?.band)) {
    const id = num(row.id)
    if (!testIds.has(id)) continue
    bands[id] = { id, online: row.online === true, zone: num(row.zone), lastSeen: millisOf(row.lastSeen) }
  }
  const zones: TestZone[] = rowsOf(db?.zone)
    .map((row) => ({ id: String(row.id ?? ''), name: text(row.name), stationId: num(row.stationId) }))
    .sort((a, b) => a.stationId - b.stationId)
  const wearers: Record<number, string> = {}
  for (const row of rowsOf(db?.boardAttendees)) {
    const bandId = num(row.bandId)
    if (testIds.has(bandId)) wearers[bandId] = text(row.displayName)
  }
  useTestBands.setState({ bands, zones, wearers })
}

let queued = false

/** One read per transaction: the SDK fires a row callback for every band in it. */
function queueRead() {
  if (queued) return
  queued = true
  queueMicrotask(() => {
    queued = false
    readTestBands()
  })
}

function attach(conn: DbConnection) {
  watchTables(conn, ['band', 'zone', 'boardAttendees'], queueRead)
  useTestBands.setState({ linked: true })
  readTestBands()
}

function drop() {
  useTestBands.setState({ linked: false, bands: {}, zones: [], wearers: {}, busy: null })
}

onLink(attach, drop)

/** Reads the host's config.json once, for the Kibana address and whether test mode is on. */
export async function loadTestHost(): Promise<HostConfig> {
  let host: HostConfig
  try {
    host = await loadHostConfig()
  } catch {
    host = HOST_FALLBACK
  }
  useTestBands.setState({ host })
  return host
}

/** The dev organizer's rule: a test band is online while it was heard in the last five seconds. */
export function isOnline(band: TestBand | undefined, now: number = Date.now()): boolean {
  if (!band || !band.online) return false
  return band.id >= HARDWARE_FROM || now - band.lastSeen < FRESH_MS
}

export function zoneNameFor(stationId: number, zones: readonly TestZone[]): string {
  return zones.find((zone) => zone.stationId === stationId)?.name ?? ''
}

/** POSTs one of the host's dev endpoints. A refusal answers JSON `{ error }`, which becomes the message. */
export async function postDev(path: string): Promise<void> {
  let res: Response
  try {
    res = await fetch(path, { method: 'POST' })
  } catch {
    throw new Error('The host did not answer.')
  }
  if (res.ok) return
  let message = ''
  try {
    const body = (await res.json()) as unknown
    if (body && typeof body === 'object' && 'error' in body) message = text((body as { error: unknown }).error)
  } catch {
    // The refusal had no JSON body.
  }
  throw new Error(message || `The host refused that (${res.status}).`)
}

async function run(key: string, at: TestArea, work: () => Promise<unknown>): Promise<boolean> {
  useTestBands.setState({ busy: key, failure: null })
  try {
    await work()
    return true
  } catch (error) {
    useTestBands.setState({ failure: { at, message: messageOf(error) } })
    return false
  } finally {
    if (useTestBands.getState().busy === key) useTestBands.setState({ busy: null })
  }
}

function whole(value: number, what: string): number {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${what} is not a number the host knows.`)
  return value
}

/** Moves a test band to a zone, as if it had walked into range of that zone's station. */
export function walkTo(bandId: number, stationId: number): Promise<boolean> {
  return run(`move ${bandId}`, 'bands', () => postDev(`/api/dev/move/${whole(bandId, 'That band')}/${whole(stationId, 'That zone')}`))
}

/** Presses the button on a tap-link band. */
export function pressBand(bandId: number): Promise<boolean> {
  return run(`press ${bandId}`, 'bands', () => postDev(`/api/dev/press/${whole(bandId, 'That band')}`))
}

/** The band's wearer falls where the band is now. Two story bands stand around them. */
export function fallHere(bandId: number): Promise<boolean> {
  return run(`fall ${bandId}`, 'bands', () => postDev(`/api/dev/fall/${whole(bandId, 'That band')}`))
}

/** A venue camera in this zone sees a speaker knocked off its stand. */
export function breakSpeaker(stationId: number): Promise<boolean> {
  return run(`property ${stationId}`, 'property', () => postDev(`/api/dev/property/${whole(stationId, 'That zone')}`))
}

export const REPORT_KINDS = [
  ['property', 'Venue equipment broken'],
  ['theft', "Stolen from the venue: its equipment, merch or a sponsor's gear at its booth"],
] as const

export type ReportKind = (typeof REPORT_KINDS)[number][0]

/** Staff report of broken or stolen equipment. No band is involved, so band_id is 0. */
export function reportBroken(kind: ReportKind, zoneId: string, note: string): Promise<boolean> {
  return run('report', 'report', async () => {
    if (!REPORT_KINDS.some(([value]) => value === kind)) throw new Error('Choose what happened.')
    if (!/^\d+$/.test(zoneId)) throw new Error('Choose where it happened.')
    await linkReducers<TestReducers>().openIncident({ kind, zoneId: BigInt(zoneId), bandId: 0, note: note.trim() })
  })
}

export interface KibanaJob {
  job: string
  what: string
  views: readonly (readonly [label: string, path: string])[]
}

export const KIBANA_INTRO = {
  title: 'Elastic, the Evidence Engine',
  text: 'The Evidence Engine organizes and validates data and searches it by meaning. The Decision Engine reviews claim evidence and recommends outcomes. Code checks each recommendation against the policy and approval rules before settlement. Each view opens in Kibana, signed in to the Elastic Cloud project.',
} as const

/** Each job the Elastic project does, with the Kibana views that show it. */
export const KIBANA_JOBS: readonly KibanaJob[] = [
  {
    job: 'Before the event: organizing the scraped event data',
    what: "Bright Data scraped the event pages and the sponsors' company profiles into raw indices. The workflow bandit-organize joins the exact matches with ES|QL LOOKUP JOIN, and the agent bandit-organizer resolves the rest and gives a reason for every merge. Rust checks the bundle and loads it into SpacetimeDB in one transaction: the venue, zones, sponsors, booths and schedule on the other tabs.",
    views: [
      ['Scrape pipeline: raw records, merges and the reason for each', '/app/dashboards#/view/bandit-pipeline-calhacks-13'],
      ['Sponsors and prizes: what the scrape found', '/app/dashboards#/view/bandit-event-calhacks-13'],
      ['bandit-organize runs, step by step', '/app/workflows/bandit-organize'],
      ['bandit-organizer, the agent and its tool calls', '/app/agent_builder/agents/bandit-organizer'],
    ],
  },
  {
    job: "During the event: the bands' radio log and the photos",
    what: "The venue laptop records every packet the gateway hears from the bands and the station markers: zone, battery, SOS, fall and button presses, and the signal strength of every band nearby. It also records every photo's camera, time and place, never the image. The log is kept for after the event; nothing live reads it, since the Live tab comes from SpacetimeDB.",
    views: [['Band radio and photos', '/app/dashboards#/view/bandit-radio']],
  },
  {
    job: "After the event: ordering the recap's suggestions",
    what: "SpacetimeDB supplies the people and booths eligible for each recap. Elastic combines keyword and meaning searches, then reranks the results against the attendee's interests.",
    views: [["Recap suggestions: each attendee's latest ranking next to the minutes order", '/app/dashboards#/view/bandit-recap']],
  },
  {
    job: 'Documents and other model tasks',
    what: 'The document reader extracts quoted facts from policies and hospital reports. Separate workflows handle medical cards, images, letters and recommendations. Rust checks each result before saving it.',
    views: [
      ['Document reading runs', '/app/workflows/bandit-read-document'],
      ['Document reader and its page tools', '/app/agent_builder/agents/bandit-document-reader'],
      ['Text extraction, drafting and recommendation runs', '/app/workflows/bandit-run-task'],
    ],
  },
  {
    job: 'Claims: checking the evidence',
    what: 'Elastic checks claim copies without names and searches the venue and attendee policies for relevant clauses. The investigator requests evidence through Rust workers, which restrict every request to the claim. Code enforces policy amounts and approval rules before settlement.',
    views: [
      ['Claims evidence: validation, outcomes and approved amounts', '/app/dashboards#/view/bandit-claims'],
      ['Claim investigation runs', '/app/workflows/bandit-investigate-claim'],
      ['Claim investigator', '/app/agent_builder/agents/bandit-claim-investigator'],
    ],
  },
  {
    job: "Claims: proposing payment rules from the organizer's approvals",
    what: 'After three claims of one kind receive organizer approval, the rule proposer suggests their highest payout as the ceiling. Code checks the cited claims, enforced scope and ceiling. Future claims can use the rule only after the organizer approves that scope.',
    views: [
      ['bandit-propose-rule runs, step by step', '/app/workflows/bandit-propose-rule'],
      ['bandit-rule-proposer, the agent and its counts', '/app/agent_builder/agents/bandit-rule-proposer'],
    ],
  },
]

/** `${kibana_url}${path}`, as the dev portal builds it. A trailing slash on the address is dropped. */
export function kibanaHref(kibanaUrl: string, path: string): string {
  return `${kibanaUrl.replace(/\/+$/, '')}${path}`
}
