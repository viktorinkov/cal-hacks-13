import { create } from 'zustand'
import type { DbConnection } from './module_bindings'

/** Setup 0 is the Palace of Fine Arts model that ships with the app. */
export const DEFAULT_SETUP_ID = '0'

export interface VenueSource {
  label: string
  value: string
}

/** One `venue_setup` row: a run that looked for an event's venue and its 3D model. */
export interface VenueSetupView {
  id: string
  eventName: string
  /** `running`, `ready`, `no model` or `failed`. */
  status: string
  eventSite: string
  venueName: string
  address: string
  mapUrl: string
  method: string
  modelUrl: string
  layoutUrl: string
  modelBytes: number
  meshes: number
  triangles: number
  places: number
  sizeX: number
  sizeY: number
  sizeZ: number
  floorPlans: string[]
  sources: VenueSource[]
  error: string
  createdAt: number
  updatedAt: number
}

/** One `venue_setup_step` row, written by the worker as it happens. */
export interface VenueStepView {
  id: string
  setupId: string
  step: string
  detail: string
  at: number
}

interface VenueSetupState {
  /** Each table is its own subscription, so one that never answers does not hold the others. */
  setupsReady: boolean
  stepsReady: boolean
  chosenReady: boolean
  error: string | null
  setups: VenueSetupView[]
  steps: VenueStepView[]
  chosenId: string
  starting: boolean
  startError: string | null
  choosing: boolean
  chooseError: string | null
  start: (eventName: string) => Promise<boolean>
  choose: (setupId: string) => Promise<boolean>
}

let conn: DbConnection | null = null

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error) return error
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message: unknown }).message
    if (typeof message === 'string' && message) return message
  }
  return 'The database refused that.'
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function count(value: unknown): number {
  const n = typeof value === 'bigint' ? Number(value) : Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

function millisOf(value: unknown): number {
  if (value && typeof value === 'object' && 'toDate' in value) {
    const fn = (value as { toDate: unknown }).toDate
    if (typeof fn === 'function') {
      const time = (fn.call(value) as Date).getTime()
      return Number.isFinite(time) ? time : 0
    }
  }
  return 0
}

function rowsOf(table: unknown): Record<string, unknown>[] {
  if (!table || typeof table !== 'object' || !('iter' in table)) return []
  const iter = (table as { iter: unknown }).iter
  if (typeof iter !== 'function') return []
  return [...(iter.call(table) as Iterable<Record<string, unknown>>)]
}

export function setupView(row: Record<string, unknown>): VenueSetupView {
  return {
    id: String(row.id ?? ''),
    eventName: text(row.eventName),
    status: text(row.status),
    eventSite: text(row.eventSite),
    venueName: text(row.venueName),
    address: text(row.address),
    mapUrl: text(row.mapUrl),
    method: text(row.method),
    modelUrl: text(row.modelUrl),
    layoutUrl: text(row.layoutUrl),
    modelBytes: count(row.modelBytes),
    meshes: count(row.meshes),
    triangles: count(row.triangles),
    places: count(row.places),
    sizeX: count(row.sizeX),
    sizeY: count(row.sizeY),
    sizeZ: count(row.sizeZ),
    floorPlans: Array.isArray(row.floorPlans) ? row.floorPlans.map(text).filter(Boolean) : [],
    sources: Array.isArray(row.sources)
      ? row.sources.flatMap((item) => {
          if (!item || typeof item !== 'object') return []
          const fact = item as { label?: unknown; value?: unknown }
          const value = text(fact.value)
          return value ? [{ label: text(fact.label), value }] : []
        })
      : [],
    error: text(row.error),
    createdAt: millisOf(row.createdAt),
    updatedAt: millisOf(row.updatedAt),
  }
}

function read(next: DbConnection) {
  if (conn !== next) return
  const db = next.db as unknown as Record<string, unknown>
  const setups = rowsOf(db.venueSetup)
    .map(setupView)
    .sort((a, b) => b.createdAt - a.createdAt || Number(b.id) - Number(a.id))
  const steps: VenueStepView[] = rowsOf(db.venueSetupStep)
    .map((row) => ({
      id: String(row.id ?? ''),
      setupId: String(row.setupId ?? ''),
      step: text(row.step),
      detail: text(row.detail),
      at: millisOf(row.at),
    }))
    .sort((a, b) => a.at - b.at || Number(a.id) - Number(b.id))
  const chosen = rowsOf(db.chosenVenue).find((row) => count(row.id) === 0)
  useVenueSetup.setState({ setups, steps, chosenId: chosen ? String(chosen.setupId ?? DEFAULT_SETUP_ID) : DEFAULT_SETUP_ID })
}

function watch(next: DbConnection, table: unknown) {
  const t = table as { onInsert?: (cb: () => void) => void; onDelete?: (cb: () => void) => void; onUpdate?: (cb: () => void) => void } | undefined
  const update = () => read(next)
  t?.onInsert?.(update)
  t?.onDelete?.(update)
  t?.onUpdate?.(update)
}

/** Called once per connection from the session. The three tables are public. */
export function subscribeVenueSetup(next: DbConnection) {
  conn = next
  useVenueSetup.setState({ setupsReady: false, stepsReady: false, chosenReady: false, error: null })
  const db = next.db as unknown as Record<string, unknown>
  watch(next, db.venueSetup)
  watch(next, db.venueSetupStep)
  watch(next, db.chosenVenue)
  const views = [
    ['venue_setup', 'setupsReady'],
    ['venue_setup_step', 'stepsReady'],
    ['chosen_venue', 'chosenReady'],
  ] as const
  for (const [view, readiness] of views) {
    next
      .subscriptionBuilder()
      .onApplied(() => {
        if (conn !== next) return
        useVenueSetup.setState({ [readiness]: true })
        read(next)
      })
      .onError((...args: unknown[]) => {
        if (conn !== next) return
        useVenueSetup.setState({ error: messageOf(args[1] ?? args[0]) })
      })
      .subscribe(`SELECT * FROM ${view}`)
  }
}

export function dropVenueSetup() {
  conn = null
}

type VenueReducers = {
  startVenueSetup(args: { eventName: string }): Promise<unknown>
  chooseVenue(args: { setupId: bigint }): Promise<unknown>
}

function reducers(): VenueReducers {
  if (!conn) throw new Error('The database is not connected.')
  return (conn as unknown as { reducers: VenueReducers }).reducers
}

/** The worker's words when the caller lacks the role, made plain for the organizer. */
function startRefusal(message: string): string {
  if (/role|permission|not allowed|unauthori[sz]ed|ops/i.test(message)) return 'Only an organizer signed in to the desk can start a search.'
  return message
}

export const useVenueSetup = create<VenueSetupState>((set) => ({
  setupsReady: false,
  stepsReady: false,
  chosenReady: false,
  error: null,
  setups: [],
  steps: [],
  chosenId: DEFAULT_SETUP_ID,
  starting: false,
  startError: null,
  choosing: false,
  chooseError: null,
  start: async (eventName) => {
    const name = eventName.trim()
    if (!name) {
      set({ startError: "Type the event's name first." })
      return false
    }
    if (name.length > 200) {
      set({ startError: 'Keep the name under 200 characters.' })
      return false
    }
    set({ starting: true, startError: null })
    try {
      await reducers().startVenueSetup({ eventName: name })
      return true
    } catch (error) {
      set({ startError: startRefusal(messageOf(error)) })
      return false
    } finally {
      set({ starting: false })
    }
  },
  choose: async (setupId) => {
    set({ choosing: true, chooseError: null })
    try {
      await reducers().chooseVenue({ setupId: BigInt(setupId) })
      set({ chosenId: setupId })
      return true
    } catch (error) {
      set({ chooseError: messageOf(error) })
      return false
    } finally {
      set({ choosing: false })
    }
  },
}))
