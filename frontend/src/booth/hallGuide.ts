import type { GuidanceCommand, Incident } from '@/contracts/domain'
import { demoEntrance, useDemoRing } from '@/booth/demoRing'
import { mapController } from '@/map/controller'
import { useUi } from '@/stores/ui'
import { useWorld } from '@/stores/world'
import { presentCalhacks } from '@/stdb/floor'
import {
  HALL_PATH,
  acknowledgeHall,
  closeHallPath,
  openHallPath,
  resolveHall,
  scriptedIncidentId,
  triggerHallSos,
  useHallDemo,
} from './hallDemo'

function focusRing(): void {
  const ring = useDemoRing.getState()
  mapController.focus({ x: ring.x, y: ring.y }, 16)
}

function focusPath(): void {
  const ring = useDemoRing.getState()
  mapController.frame([demoEntrance(), { x: ring.x, y: ring.y }])
}

/** Start the distress and frame the ring. A second press clears the rehearsal. */
export function guideHallSos(): void {
  const clearing = useHallDemo.getState().scripted
  const id = scriptedIncidentId()
  triggerHallSos()
  presentCalhacks()
  if (!clearing) {
    focusRing()
    return
  }
  const selection = useUi.getState().selection
  if (selection.kind === 'incident' && (selection.id === id || !useWorld.getState().incidents[selection.id])) {
    useUi.getState().select({ kind: 'none' })
  }
  mapController.fit()
}

/** The operator takes the incident. The path stays closed, and the walk from the entrance is in frame. */
export function guideHallAcknowledge(): void {
  acknowledgeHall()
  presentCalhacks()
  focusPath()
}

/** Open the yellow path and show the walk up from the entrance. */
export function guideHallPath(): void {
  openHallPath()
  presentCalhacks()
  focusPath()
}

/** Drop the rehearsal and the path, and step back to the whole hall. */
export function guideHallResolve(): Incident | null {
  const id = scriptedIncidentId()
  const current = id ? useWorld.getState().incidents[id] : undefined
  resolveHall()
  presentCalhacks()
  mapController.fit()
  if (!current) return null
  return { ...current, status: 'resolved', resolvedAt: Date.now() }
}

/** Close the lit path and leave the incident open, so it can be sent again. */
export function guideHallClosePath(): GuidanceCommand | null {
  closeHallPath()
  presentCalhacks()
  return useWorld.getState().commands[HALL_PATH] ?? null
}
