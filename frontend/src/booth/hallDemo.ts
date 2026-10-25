import { create } from 'zustand'
import type { StoreApi, UseBoundStore } from 'zustand'
import type { FloorBand } from '@/stdb/floor'
import type { GuidanceCommand, Incident } from '@/contracts/domain'
import { useWorld } from '@/stores/world'
import {
  HARDWARE_ID_MAX,
  S_NEAR_SOS,
  S_SOS,
  bandLights,
  demoCommand,
  demoIsActive,
  demoPath,
  useDemoRing,
  useHardware,
} from '@/booth/demoRing'

/** Local id for the entrance path. Nothing with this id is sent to a wristband. */
export const HALL_PATH = 'demo-path'

interface HallState {
  /** A stand-in distress, used when no real band has raised one. */
  scripted: boolean
  /** The operator has taken the incident. */
  acknowledged: boolean
  /** The operator has opened the path from the entrance. */
  pathOpen: boolean
  sosId: number | null
  neighborIds: number[]
  startedAt: number
}

const idle: HallState = {
  scripted: false,
  acknowledged: false,
  pathOpen: false,
  sosId: null,
  neighborIds: [],
  startedAt: 0,
}

type HallStore = UseBoundStore<StoreApi<HallState>>

function hallStore(): HallStore {
  const slot = globalThis as typeof globalThis & { __banditHall?: HallStore }
  if (!slot.__banditHall) slot.__banditHall = create<HallState>()(() => ({ ...idle }))
  return slot.__banditHall
}

export const useHallDemo = hallStore()

export function resetHallDemo(): void {
  useHallDemo.setState({ ...idle })
}

function pickIds(): { sosId: number; neighborIds: number[] } {
  const taken = new Set(useHardware.getState().bands.map((band) => band.id))
  const ids: number[] = []
  const prefer = [91, 92, 93, 94]
  for (let n = 1; n <= HARDWARE_ID_MAX; n++) prefer.push(n)
  for (const id of prefer) {
    if (taken.has(id) || ids.includes(id)) continue
    ids.push(id)
    if (ids.length === 4) break
  }
  return { sosId: ids[0] ?? 91, neighborIds: ids.slice(1) }
}

/** A real wristband is already in distress, so the rehearsal must not invent another. */
function hardwareDistress(): boolean {
  const scriptedId = scriptedIncidentId()
  const incidents = Object.values(useWorld.getState().incidents).filter((incident) => incident.incidentId !== scriptedId)
  return demoIsActive(useHardware.getState().bands, incidents)
}

/**
 * Raise the stand-in SOS. Pressing it again clears that rehearsal.
 * A real wristband distress is left alone, so the button cannot stack a second one on top.
 */
export function triggerHallSos(): void {
  if (useHallDemo.getState().scripted) {
    resetHallDemo()
    return
  }
  if (hardwareDistress()) return
  const { sosId, neighborIds } = pickIds()
  useHallDemo.setState({
    scripted: true,
    acknowledged: false,
    pathOpen: false,
    sosId,
    neighborIds,
    startedAt: Date.now(),
  })
}

export function acknowledgeHall(): void {
  useHallDemo.setState({ acknowledged: true })
}

export function openHallPath(): void {
  useHallDemo.setState({ acknowledged: true, pathOpen: true })
}

export function closeHallPath(): void {
  useHallDemo.setState({ pathOpen: false })
}

export function resolveHall(): void {
  useHallDemo.setState({ ...idle })
}

export function scriptedIncidentId(): string | null {
  const { scripted, sosId } = useHallDemo.getState()
  if (!scripted || sosId == null) return null
  return `live-${sosId}`
}

/**
 * Bands drawn for the rehearsal.
 * A quiet live row does not cancel it. A wristband that is actually lit does, so the hardware wins.
 */
export function scriptedBands(): FloorBand[] {
  const { scripted, sosId, neighborIds, startedAt } = useHallDemo.getState()
  if (!scripted || sosId == null) return []
  const live = new Map(useHardware.getState().bands.map((band) => [band.id, band]))
  return [sosId, ...neighborIds]
    .filter((id) => {
      const row = live.get(id)
      return !row || !bandLights(row)
    })
    .map((id) => ({
      id,
      zone: 1,
      online: true,
      sos: id === sosId,
      fall: false,
      lastSeen: startedAt,
      hasMotor: true,
      hasMpu: true,
      wearer: id === sosId ? 'Test' : null,
      xM: null,
      yM: null,
      boothId: 0,
      hasPosition: false,
      state: id === sosId ? S_SOS : S_NEAR_SOS,
    }))
}

/** Live hardware plus the rehearsal stand-ins. */
export function bandsOnFloor(): FloorBand[] {
  const live = useHardware.getState().bands
  const extra = scriptedBands()
  return extra.length ? [...live, ...extra] : live
}

/**
 * The roster already contains ids 1–99, usually quiet.
 * The rehearsal replaces those rows for the map and the incident, and leaves the database alone.
 */
export function overlayScripted(bands: FloorBand[]): FloorBand[] {
  const extra = scriptedBands()
  if (!extra.length) return bands
  const byId = new Map(extra.map((band) => [band.id, band]))
  const next = bands.map((band) => byId.get(band.id) ?? band)
  const seen = new Set(next.map((band) => band.id))
  for (const band of extra) if (!seen.has(band.id)) next.push(band)
  return next
}

/**
 * Keep the operator's place in the guide across snapshots.
 * The path command is local. It is never delivered to a band.
 */
export function applyHallDemo(incidents: Incident[], commands: GuidanceCommand[]): { incidents: Incident[]; commands: GuidanceCommand[] } {
  const state = useHallDemo.getState()
  const scriptedId = state.scripted && state.sosId != null ? `live-${state.sosId}` : null
  const deviceId = state.sosId != null ? `band-${state.sosId}` : null
  let next = incidents
  const lead = scriptedId
    ? next.find((incident) => incident.incidentId === scriptedId) ??
      next.find((incident) => incident.reportedByDeviceId === deviceId && incident.status !== 'resolved')
    : next.find((incident) => incident.status !== 'resolved' && !incident.isSimulated && (incident.source === 'manual_sos' || incident.source === 'imu_suspicion'))
  if (lead && ((state.scripted && (state.pathOpen || state.acknowledged)) || (state.pathOpen && lead.status !== 'responding'))) {
    next = next.map((incident) => {
      if (incident.incidentId !== lead.incidentId) return incident
      if (state.pathOpen) return { ...incident, status: 'responding' as const, guidanceCommandIds: [HALL_PATH] }
      if (state.acknowledged) return { ...incident, status: 'acknowledged' as const }
      return incident
    })
  }
  const wantPreview = state.scripted && state.acknowledged && !state.pathOpen && !!lead
  const wantActive = state.pathOpen && !!lead
  const rest = commands.filter((command) => command.commandId !== HALL_PATH)
  if ((!wantPreview && !wantActive) || !lead) return { incidents: next, commands: rest }
  const ring = useDemoRing.getState()
  const path = demoPath(ring)
  let length = 0
  for (let i = 1; i < path.length; i++) length += Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.y - path[i - 1]!.y)
  length = Math.round(length)
  const base = demoCommand(length)
  const approved = state.pathOpen
  const command: GuidanceCommand = {
    ...base,
    incidentId: lead.incidentId,
    preview: { ...base.preview, corridorName: 'Entrance to the SOS' },
    approvalStatus: approved ? 'approved' : 'pending_approval',
    deliveryStatus: approved ? 'delivered' : 'not_sent',
    approvedBy: approved ? 'Leo P' : undefined,
    approvedAt: approved ? state.startedAt || Date.now() : undefined,
    reason: 'Clear a path from the entrance to the SOS',
    expiresAt: (state.startedAt || Date.now()) + 30 * 60 * 1000,
  }
  return { incidents: next, commands: [...rest, command] }
}
