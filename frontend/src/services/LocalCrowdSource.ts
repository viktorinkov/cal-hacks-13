/**
 * Hybrid mode: physical bands, incidents and commands come from the live backend, while the crowd
 * comes from the in-browser simulator until the backend streams its own entities. Everything this
 * produces is labelled simulated. It follows live incidents and approved guidance so the simulated
 * crowd reacts to real events.
 */
import type { EntityFrame, StreamEvent, Venue, ZoneState } from '@/contracts/domain'
import { Path } from '@/lib/geometry'
import { CrowdSim, SIM_DT } from '@/mock/sim/crowd'

export class LocalCrowdSource {
  private sim: CrowdSim
  private timer: ReturnType<typeof setInterval> | null = null
  private last = 0
  private accum = 0
  private steps = 0
  private frameListeners = new Set<(f: EntityFrame) => void>()
  private zoneListeners = new Set<(z: ZoneState[]) => void>()
  private readonly venue: Venue
  private activeIncidentId: string | null = null
  /** Turned off as soon as the backend sends entities of its own. */
  enabled = true

  constructor(venue: Venue, seed = 2026, count = 1500) {
    this.venue = venue
    this.sim = new CrowdSim({ seed, count, venue, anchors: [], compliance: 0.75 })
    for (let k = 0; k < 400; k++) this.sim.step()
  }

  start(): void {
    if (this.timer) return
    this.last = performance.now()
    this.timer = setInterval(() => {
      const now = performance.now()
      this.accum += now - this.last
      this.last = now
      let n = 0
      while (this.accum >= SIM_DT * 1000 && n < 5) {
        this.accum -= SIM_DT * 1000
        this.step()
        n++
      }
    }, 50)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  onFrame(cb: (f: EntityFrame) => void): () => void {
    this.frameListeners.add(cb)
    return () => this.frameListeners.delete(cb)
  }

  onZones(cb: (z: ZoneState[]) => void): () => void {
    this.zoneListeners.add(cb)
    return () => this.zoneListeners.delete(cb)
  }

  /** Mirror live events into the simulated crowd. */
  observe(event: StreamEvent): void {
    if (event.type === 'incident') {
      const inc = event.incident
      if (inc.status !== 'resolved' && inc.location && this.activeIncidentId !== inc.incidentId) {
        this.activeIncidentId = inc.incidentId
        this.sim.setIncident(inc.location, null)
      } else if (inc.status === 'resolved' && this.activeIncidentId === inc.incidentId) {
        this.activeIncidentId = null
        this.sim.setIncident(null, null)
        this.sim.setGuidance(null, null)
      }
    } else if (event.type === 'guidance') {
      const cmd = event.command
      const corridor = this.venue.responderCorridors.find((c) => c.corridorId === cmd.corridorId)
      if (cmd.approvalStatus === 'approved' && corridor) this.sim.setGuidance(new Path(corridor.path), this.sim.incident)
      else if (cmd.approvalStatus === 'cancelled' || cmd.approvalStatus === 'expired') this.sim.setGuidance(null, null)
    } else if (event.type === 'entities' && event.entities.some((e) => e.type === 'simulated_person' || e.type === 'observed_person')) {
      this.enabled = false
      this.stop()
    }
  }

  triggerCongestion(): void {
    this.sim.startSurge(50)
  }

  private step(): void {
    if (!this.enabled) return
    this.sim.step()
    this.steps++
    const now = Date.now()
    const n = this.sim.n
    const positions = new Float32Array(n * 2)
    const velocities = new Float32Array(n * 2)
    for (let i = 0; i < n; i++) {
      positions[2 * i] = this.sim.x[i]
      positions[2 * i + 1] = this.sim.y[i]
      velocities[2 * i] = this.sim.vx[i]
      velocities[2 * i + 1] = this.sim.vy[i]
    }
    const frame: EntityFrame = { seq: this.steps, t: now, source: 'simulation', count: n, positions, velocities, kinds: new Uint8Array(n) }
    this.frameListeners.forEach((l) => l(frame))
    if (this.steps % 5 === 0) {
      const samples = this.sim.zoneSamples()
      const zones: ZoneState[] = this.venue.zones.map((z) => {
        const s = samples.get(z.zoneId)
        // the same lines the mock backend uses: the stage pit is rated higher than the rest
        const caution = z.section === 'front' ? 5.6 : 3.1
        const critical = z.section === 'front' ? 6.4 : caution + 1
        return {
          zoneId: z.zoneId,
          timestamp: now,
          occupancyEstimate: s?.count,
          estimatedDensity: s ? Math.round(s.density * 100) / 100 : undefined,
          peakDensity: s ? Math.round(s.peak * 100) / 100 : undefined,
          flowIn: s?.flowIn,
          flowOut: s?.flowOut,
          congestionStatus: !s ? 'unknown' : s.peak >= critical ? 'critical' : s.peak >= caution ? 'caution' : 'normal',
          source: 'simulation',
          dataQuality: 'good',
          updatedAt: now,
        }
      })
      this.zoneListeners.forEach((l) => l(zones))
    }
  }
}
