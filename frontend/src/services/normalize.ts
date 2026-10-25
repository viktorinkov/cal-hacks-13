/**
 * Boundary between wire payloads and frontend domain objects. Nothing outside services/ sees raw
 * backend JSON.
 */
import type { EntityFrame, StreamEvent, TrackedEntity, WorldSnapshot } from '@/contracts/domain'
import { EntityKind } from '@/contracts/domain'
import {
  guidanceSchema,
  incidentSchema,
  snapshotSchema,
  streamEventSchema,
} from '@/contracts/schemas'

function camel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())
}

/** Deep-convert snake_case keys to camelCase. Arrays and primitives pass through. */
export function camelizeKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(camelizeKeys)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[camel(k)] = camelizeKeys(v)
    return out
  }
  return value
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

function result<T>(parsed: { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } }): ParseResult<T> {
  if (parsed.success) return { ok: true, value: parsed.data }
  const first = parsed.error.issues[0]
  return { ok: false, error: first ? `${first.path.join('.') || '(root)'}: ${first.message}` : 'invalid payload' }
}

export function parseStreamEvent(raw: unknown): ParseResult<StreamEvent> {
  return result(streamEventSchema.safeParse(camelizeKeys(raw)))
}

export function parseSnapshot(raw: unknown): ParseResult<WorldSnapshot> {
  return result(snapshotSchema.safeParse(camelizeKeys(raw)))
}

export function parseIncident(raw: unknown) {
  return result(incidentSchema.safeParse(camelizeKeys(raw)))
}

export function parseGuidance(raw: unknown) {
  return result(guidanceSchema.safeParse(camelizeKeys(raw)))
}

/**
 * Pack a list of tracked entities into a frame. Simulated and observed people are packed into
 * separate frames so they can never be drawn as one another; physical bands are not entities on
 * the map (they are drawn from device state).
 */
export function framesFromEntities(entities: TrackedEntity[], seq: number, at: number): EntityFrame[] {
  const sim = entities.filter((e) => e.type === 'simulated_person')
  const observed = entities.filter((e) => e.type === 'observed_person')
  const frames: EntityFrame[] = []
  const pack = (list: TrackedEntity[], source: EntityFrame['source']): EntityFrame => {
    const positions = new Float32Array(list.length * 2)
    const velocities = new Float32Array(list.length * 2)
    const kinds = new Uint8Array(list.length)
    list.forEach((e, i) => {
      positions[2 * i] = e.x
      positions[2 * i + 1] = e.y
      velocities[2 * i] = e.velocity?.x ?? 0
      velocities[2 * i + 1] = e.velocity?.y ?? 0
      kinds[i] =
        source === 'camera' ? EntityKind.ObservedPerson : e.role === 'responder' ? EntityKind.SimResponder : EntityKind.SimAttendee
    })
    return { seq, t: at, source, count: list.length, positions, velocities, kinds }
  }
  if (sim.length) frames.push(pack(sim, 'simulation'))
  if (observed.length) frames.push(pack(observed, 'camera'))
  return frames
}
