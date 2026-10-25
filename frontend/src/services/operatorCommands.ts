/**
 * Operator actions (layer E). Each one marks itself pending, waits for the backend to accept it,
 * then applies the backend's reply. Nothing is shown as done until the backend says so, and band
 * delivery is tracked separately through guidance events.
 */
import { toast } from 'sonner'
import type { GuidanceCommand, Incident, ResolutionReason } from '@/contracts/domain'
import { useUi } from '@/stores/ui'
import { useWorld } from '@/stores/world'
import { BackendError } from './BackendAdapter'
import { getAdapter } from './runtime'

const TIMEOUT_MS = 8000

async function run<T>(key: string, failure: string, fn: () => Promise<T>): Promise<T | null> {
  const adapter = getAdapter()
  if (!adapter) return null
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

export async function acknowledgeIncident(incidentId: string): Promise<Incident | null> {
  const res = await run(pendingKey.ack(incidentId), 'Not acknowledged. The incident is still open', () =>
    getAdapter()!.acknowledgeIncident(incidentId),
  )
  return mergeIncident(res)
}

export async function resolveIncident(incidentId: string, reason: ResolutionReason): Promise<Incident | null> {
  const res = await run(pendingKey.resolve(incidentId), 'Not resolved. The incident is still open', () =>
    getAdapter()!.resolveIncident(incidentId, reason),
  )
  return mergeIncident(res)
}

export async function previewGuidance(incidentId: string, corridorId?: string): Promise<GuidanceCommand | null> {
  const res = await run(pendingKey.preview(incidentId), 'Could not preview a path', () =>
    getAdapter()!.previewGuidance({ incidentId, corridorId }),
  )
  return mergeCommand(res)
}

export async function approveGuidance(commandId: string): Promise<GuidanceCommand | null> {
  const res = await run(pendingKey.approve(commandId), 'Not sent. No band has changed', () => getAdapter()!.approveGuidance(commandId))
  return mergeCommand(res)
}

export async function cancelGuidance(commandId: string): Promise<GuidanceCommand | null> {
  const res = await run(pendingKey.cancel(commandId), 'Could not stop the signals', () => getAdapter()!.cancelGuidance(commandId))
  return mergeCommand(res)
}

export async function resendGuidance(commandId: string): Promise<GuidanceCommand | null> {
  const res = await run(pendingKey.resend(commandId), 'Could not resend', () => getAdapter()!.resendGuidance(commandId))
  return mergeCommand(res)
}

export async function resetSimulation(): Promise<boolean> {
  const res = await run(pendingKey.reset, 'Reset failed', async () => {
    await getAdapter()!.resetSimulation()
    return true
  })
  return res === true
}
