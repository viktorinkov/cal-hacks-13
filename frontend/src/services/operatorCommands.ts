/**
 * Operator actions (layer E). Each one marks itself pending, waits for the backend to accept it,
 * then applies the backend's reply. Nothing is shown as done until the backend says so, and band
 * delivery is tracked separately through guidance events.
 */
import { toast } from 'sonner'
import type { GuidanceCommand, Incident, ResolutionReason } from '@/contracts/domain'
import { HALL_PATH, scriptedIncidentId } from '@/booth/hallDemo'
import { guideHallAcknowledge, guideHallClosePath, guideHallPath, guideHallResolve } from '@/booth/hallGuide'
import { useCatalog } from '@/stdb/catalog'
import { addIncidentNote, assignMedic, ensureIncident, incidentForBand, resolveModuleIncident, useDesk } from '@/stdb/deskOps'
import { useSession } from '@/stdb/session'
import { useUi } from '@/stores/ui'
import { useWorld } from '@/stores/world'
import { BackendError } from './BackendAdapter'
import { getAdapter } from './runtime'

const TIMEOUT_MS = 8000

async function run<T>(key: string, failure: string, fn: () => Promise<T>, needsAdapter = true): Promise<T | null> {
  if (needsAdapter && !getAdapter()) return null
  const ui = useUi.getState()
  if (ui.pending[key]) return null
  ui.setPending(key, true)
  try {
    const result = await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new BackendError('timeout', 'No confirmation from the backend')), TIMEOUT_MS),
      ),
    ])
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    toast.error(failure, { description: message })
    return null
  } finally {
    useUi.getState().setPending(key, false)
  }
}

export const pendingKey = {
  ack: (incidentId: string) => `ack:${incidentId}`,
  resolve: (incidentId: string) => `resolve:${incidentId}`,
  preview: (incidentId: string) => `preview:${incidentId}`,
  approve: (commandId: string) => `approve:${commandId}`,
  cancel: (commandId: string) => `cancel:${commandId}`,
  resend: (commandId: string) => `resend:${commandId}`,
  reset: 'reset',
}

function mergeIncident(i: Incident | null): Incident | null {
  if (i) useWorld.getState().mergeIncident(i)
  return i
}

function mergeCommand(c: GuidanceCommand | null): GuidanceCommand | null {
  if (c) useWorld.getState().mergeCommand(c)
  return c
}

/** A live band incident. The rehearsal's stand-in keeps the local guide and never calls the module. */
export function isModuleIncident(incidentId: string): boolean {
  if (incidentId === scriptedIncidentId()) return false
  return /^\d+$/.test(incidentId) || /^live-\d+$/.test(incidentId)
}

function bandOf(incidentId: string): number | null {
  const live = /^live-(\d+)$/.exec(incidentId)
  if (live) return Number(live[1])
  const world = useWorld.getState().incidents[incidentId]
  const device = world?.reportedByDeviceId?.match(/^band-(\d+)$/)
  if (device) return Number(device[1])
  const row = useDesk.getState().incidents.find((item) => item.id === incidentId)
  return row && row.bandId > 0 ? row.bandId : null
}

function placeFor(bandId: number, incidentId: string): { kind: string; zoneId: string } | null {
  const catalog = useCatalog.getState()
  const band = catalog.bands.find((item) => item.id === bandId)
  const zone = catalog.zones.find((item) => item.stationId === band?.zone) ?? catalog.zones[0]
  if (!zone) return null
  const world = useWorld.getState().incidents[incidentId]
  const kind = world?.source === 'imu_suspicion' || band?.fall ? 'fall' : 'sos'
  return { kind, zoneId: zone.id }
}

async function moduleId(incidentId: string): Promise<string> {
  if (/^\d+$/.test(incidentId)) return incidentId
  const bandId = bandOf(incidentId)
  if (bandId == null) throw new Error('This incident has no band.')
  const open = incidentForBand(bandId)
  if (open) return open.id
  const place = placeFor(bandId, incidentId)
  if (!place) throw new Error('That band is not in a zone yet.')
  return ensureIncident(bandId, place.kind, place.zoneId)
}

async function tapCard(bandId: number | null): Promise<void> {
  if (bandId == null || bandId < 1 || bandId > 255) return
  try {
    await useSession.getState().requestCard(bandId)
  } catch {
    // The card stays closed until a medic can tap the band.
  }
}

const RESOLUTION: Record<ResolutionReason, string> = {
  assisted_on_scene: 'treated on site',
  handed_to_medical: 'handed to medical',
  false_alarm: 'false alarm',
  other: 'other',
}

export async function acknowledgeIncident(incidentId: string): Promise<Incident | null> {
  if (incidentId === scriptedIncidentId()) {
    guideHallAcknowledge()
    return useWorld.getState().incidents[incidentId] ?? null
  }
  if (isModuleIncident(incidentId)) {
    const res = await run(pendingKey.ack(incidentId), 'Not acknowledged. The incident is still open.', async () => {
      const id = await moduleId(incidentId)
      await assignMedic(id)
      await tapCard(bandOf(incidentId))
      return useWorld.getState().incidents[incidentId] ?? null
    }, false)
    return res
  }
  const res = await run(pendingKey.ack(incidentId), 'Not acknowledged. The incident is still open.', () =>
    getAdapter()!.acknowledgeIncident(incidentId),
  )
  return mergeIncident(res)
}

export async function resolveIncident(incidentId: string, reason: ResolutionReason): Promise<Incident | null> {
  if (incidentId === scriptedIncidentId()) return guideHallResolve()
  if (isModuleIncident(incidentId)) {
    return run(pendingKey.resolve(incidentId), 'Not resolved. The incident is still open.', async () => {
      const id = await moduleId(incidentId)
      await resolveModuleIncident(id, RESOLUTION[reason])
      return useWorld.getState().incidents[incidentId] ?? null
    }, false)
  }
  const res = await run(pendingKey.resolve(incidentId), 'Not resolved. The incident is still open.', () =>
    getAdapter()!.resolveIncident(incidentId, reason),
  )
  return mergeIncident(res)
}

/** The path step on a live incident is a note on the module, not a corridor from the provisional API. */
export async function noteIncidentPath(incidentId: string, note: string, costDollars: string): Promise<boolean> {
  const cost = costDollars.trim()
  let cents: bigint | null = null
  if (cost) {
    const dollars = Number(cost)
    if (!Number.isFinite(dollars) || dollars < 0) {
      toast.error('Cost is in dollars, for example 18.00.')
      return false
    }
    cents = BigInt(Math.round(dollars * 100))
  }
  const res = await run(pendingKey.preview(incidentId), 'The note was not added.', async () => {
    const id = await moduleId(incidentId)
    await addIncidentNote(id, note.trim() || 'Path opened from the entrance.', cents)
    return true
  }, false)
  return res === true
}

export async function previewGuidance(incidentId: string, corridorId?: string): Promise<GuidanceCommand | null> {
  if (incidentId === scriptedIncidentId()) {
    guideHallAcknowledge()
    return useWorld.getState().commands[HALL_PATH] ?? null
  }
  if (isModuleIncident(incidentId)) return null
  const res = await run(pendingKey.preview(incidentId), 'Could not preview a path.', () =>
    getAdapter()!.previewGuidance({ incidentId, corridorId }),
  )
  return mergeCommand(res)
}

export async function approveGuidance(commandId: string): Promise<GuidanceCommand | null> {
  if (commandId === HALL_PATH) {
    guideHallPath()
    return useWorld.getState().commands[HALL_PATH] ?? null
  }
  const res = await run(pendingKey.approve(commandId), 'Not sent. No band has changed.', () => getAdapter()!.approveGuidance(commandId))
  return mergeCommand(res)
}

export async function cancelGuidance(commandId: string): Promise<GuidanceCommand | null> {
  if (commandId === HALL_PATH) return mergeCommand(guideHallClosePath())
  const res = await run(pendingKey.cancel(commandId), 'Could not stop the signals.', () => getAdapter()!.cancelGuidance(commandId))
  return mergeCommand(res)
}

export async function resendGuidance(commandId: string): Promise<GuidanceCommand | null> {
  const res = await run(pendingKey.resend(commandId), 'Could not resend.', () => getAdapter()!.resendGuidance(commandId))
  return mergeCommand(res)
}

export async function resetSimulation(): Promise<boolean> {
  const res = await run(pendingKey.reset, 'Reset failed.', async () => {
    await getAdapter()!.resetSimulation()
    return true
  })
  return res === true
}
