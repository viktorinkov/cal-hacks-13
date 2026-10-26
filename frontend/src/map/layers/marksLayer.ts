/**
 * Everything that marks a decision or a device: incident rings and beacons, responder corridors in
 * preview and active states, step-aside arrows, bands with their 12-pixel LED rings, camera
 * coverage, stations and the selected zone. Redrawn every frame; it is a few hundred segments.
 */
import { Graphics, Matrix, Sprite } from 'pixi.js'
import type { CameraObservation, Device, GuidanceCommand, Incident, LedPattern, Vec2, Venue, ZoneState } from '@/contracts/domain'
import { floorZ } from '@/booth/hallRoute'
import type { ElevationAt } from '@/lib/elevation'
import { newProjectResult, Path, type ProjectResult } from '@/lib/geometry'
import { px } from '@/lib/tokens'
import { dashedPath, dashedPathZ, groundCircle, groundDisc, pathLine, pathLineZ, projectPoly } from '../draw'
import { groundMatrix, project, type Camera, type ScreenPoint } from '../projection'
import { haloTexture } from '../textures'
import { CONGESTION_TINT } from '../palette'

export const BAND_Z = 2.3
export const BEACON_TOP = 11

export interface ActiveRoute {
  path: Path
  command: GuidanceCommand
  mode: 'preview' | 'active'
  reveal: number
}

export interface MarksInput {
  cam: Camera
  time: number
  animate: boolean
  layers: { routes: boolean; incidents: boolean; bands: boolean; cameras: boolean; zones: boolean }
  incidents: Incident[]
  focusIncidentId: string | null
  routes: ActiveRoute[]
  devices: { device: Device; at: Vec2; pending: boolean; failed: boolean; targeted: LedPattern | null }[]
  observations: CameraObservation[]
  zones: Record<string, ZoneState>
  selectedZoneId: string | null
  hoverZoneId: string | null
  /** The hall mesh is the floor, so an unknown zone is not painted over it. */
  plainZones?: boolean
  stale: boolean
  laneArrows: { x: number; y: number; nx: number; ny: number; i: number }[]
  /** The live booth on the concert plan, or the test ring on CalHacks. */
  booth?: { x: number; y: number; r: number; live: boolean; editing: boolean; demo?: boolean; lost?: boolean; alert?: boolean }
}

const LED_PIXELS = 12
/** The responder path's core: champagne pushed toward white so it is the brightest line on the map. */
const PATH_CORE = 0xfff1d6

export class MarksLayer {
  readonly under = new Graphics()
  readonly zoneG = new Graphics()
  readonly over = new Graphics()
  /** Additive light under the responder path, so it reads as lit from above the crowd. */
  readonly glow = new Graphics()
  readonly halo: Sprite
  private readonly venue: Venue
  private readonly corridors: { id: string; path: Path }[]
  private extra: { id: string; path: Path; z: number[] | null } | null = null
  private readonly hit: ProjectResult = newProjectResult()
  private readonly a: ScreenPoint = { x: 0, y: 0, depth: 0 }
  private readonly b: ScreenPoint = { x: 0, y: 0, depth: 0 }
  private haloAlpha = 0

  private readonly elevation: ElevationAt

  constructor(venue: Venue, elevation: ElevationAt) {
    this.venue = venue
    this.elevation = elevation
    this.corridors = venue.responderCorridors.map((c) => ({ id: c.corridorId, path: new Path(c.path) }))
    this.halo = new Sprite(haloTexture([255, 59, 48]))
    this.halo.alpha = 0
    this.glow.blendMode = 'add'
  }

  /** First Aid's walk to the live booth, or the hall route. Rebuilt when the circle moves. `z` is the floor height at each point. */
  setBoothPath(points: Vec2[] | null, id = 'COR-BOOTH', z: number[] | null = null): void {
    if (!points) {
      this.extra = null
      return
    }
    this.extra = { id, path: new Path(points), z }
  }

  /** Floor height along a routed path, a little above the surface so the line is not buried in it. */
  private zAlong(path: Path): ((s: number) => number) | null {
    const extra = this.extra
    if (!extra || extra.path !== path || !extra.z || extra.z.length !== path.points.length) return null
    const z = extra.z
    const cum = path.cumulative
    return (s: number) => {
      const t = Math.max(0, Math.min(path.length, s))
      let k = 0
      while (k < cum.length - 2 && cum[k + 1]! < t) k++
      const span = (cum[k + 1] ?? t) - (cum[k] ?? 0) || 1
      const f = (t - (cum[k] ?? 0)) / span
      const z0 = z[k] ?? 0
      const z1 = z[Math.min(k + 1, z.length - 1)] ?? z0
      return z0 + (z1 - z0) * f + 0.08
    }
  }

  corridorPath(id: string | undefined): Path | null {
    if (id && this.extra?.id === id) return this.extra.path
    return this.corridors.find((c) => c.id === id)?.path ?? null
  }

  draw(m: MarksInput, dt: number): void {
    const { under, over, zoneG, glow } = this
    under.clear()
    over.clear()
    zoneG.clear()
    glow.clear()
    this.drawZones(m)
    this.drawBooth(m)
    if (m.layers.cameras) this.drawCameras(m)
    this.drawRoutes(m)
    this.drawIncidents(m, dt)
    if (m.layers.bands) this.drawBands(m)
    this.drawStations(m)
    void under
  }

  private drawBooth(m: MarksInput): void {
    const booth = m.booth
    if (!booth) return
    const g = this.over
    const alerting = !!booth.alert
    const flick = alerting && m.animate ? 0.5 + 0.5 * Math.sin(m.time * 8) : 1
    const color = alerting ? px.red : booth.lost ? px.grey : booth.demo ? px.champagne : booth.live ? px.green : px.grey
    const z = booth.demo ? floorZ(booth.x, booth.y) : 0
    groundDisc(g, m.cam, booth.x, booth.y, booth.r, 48, z)
    g.fill({ color, alpha: alerting ? 0.08 + 0.2 * flick : booth.lost ? 0.08 : booth.demo ? 0.1 : booth.live ? 0.16 : 0.08 })
    if (alerting) {
      groundCircle(g, m.cam, booth.x, booth.y, booth.r + 0.85, 72, 1, 0, z)
      g.stroke({ width: 10, color: px.red, alpha: 0.28 * flick })
    }
    groundCircle(g, m.cam, booth.x, booth.y, booth.r, 64, 1, 0, z)
    g.stroke({ width: alerting ? 2.8 : booth.editing ? 2.4 : 1.75, color, alpha: alerting ? 0.4 + 0.6 * flick : booth.live ? 0.95 : 0.7 })
    if (booth.editing) {
      const handle = Math.max(1.15, 14 / Math.max(m.cam.scale, 1))
      groundDisc(g, m.cam, booth.x, booth.y, handle, 20, z)
      g.fill({ color: px.champagne, alpha: 0.95 })
    }
  }

  // ---------------------------------------------------------------- zones

  private drawZones(m: MarksInput): void {
    const { cam } = m
    for (const z of this.venue.zones) {
      const st = m.zones[z.zoneId]
      // raised zones draw over their stand, so they go in the top layer
      const raised = (z.elevationM ?? 0) > 0
      const g = raised ? this.over : this.zoneG
      const poly = projectPoly(cam, z.polygon, (z.elevationM ?? 0) + 0.03)
      const unknown = m.stale || !st || st.congestionStatus === 'unknown'
      if (m.layers.zones && unknown && !m.plainZones) {
        // unknown is never drawn as safe. The hall mesh is its own floor, so it stays unpainted.
        g.poly(poly, true).fill({ color: 0x7d7d83, alpha: 0.12 })
      } else if (m.layers.zones && st?.congestionStatus === 'caution') {
        // a light reddish wash says "congested"; the outline says how much
        g.poly(poly, true).fill({ color: CONGESTION_TINT, alpha: 0.12 }).stroke({ width: 1.5, color: px.caution, alpha: 0.85 })
      } else if (m.layers.zones && st?.congestionStatus === 'critical') {
        const pulse = m.animate ? 0.55 + 0.45 * Math.sin(m.time * 4) : 1
        g.poly(poly, true).fill({ color: CONGESTION_TINT, alpha: 0.2 }).stroke({ width: 2, color: px.red, alpha: 0.6 + 0.4 * pulse })
      }
      if (z.zoneId === m.hoverZoneId && z.zoneId !== m.selectedZoneId) {
        g.poly(poly, true).stroke({ width: 1, color: px.ink, alpha: 0.35 })
      }
      if (z.zoneId === m.selectedZoneId) this.brackets(g, poly)
    }
  }

  private brackets(g: Graphics, poly: number[]): void {
    g.poly(poly, true).stroke({ width: 1, color: px.ink, alpha: 0.3 })
    const n = poly.length / 2
    for (let i = 0; i < n; i++) {
      const x = poly[2 * i]
      const y = poly[2 * i + 1]
      const px1 = poly[2 * ((i + 1) % n)]
      const py1 = poly[2 * ((i + 1) % n) + 1]
      const px0 = poly[2 * ((i + n - 1) % n)]
      const py0 = poly[2 * ((i + n - 1) % n) + 1]
      const l1 = Math.hypot(px1 - x, py1 - y) || 1
      const l0 = Math.hypot(px0 - x, py0 - y) || 1
      const arm = Math.min(12, l1 / 3, l0 / 3)
      g.moveTo(x + ((px1 - x) / l1) * arm, y + ((py1 - y) / l1) * arm)
        .lineTo(x, y)
        .lineTo(x + ((px0 - x) / l0) * arm, y + ((py0 - y) / l0) * arm)
    }
    g.stroke({ width: 1.6, color: px.ink, alpha: 0.95 })
  }

  // ---------------------------------------------------------------- cameras and stations

  private drawCameras(m: MarksInput): void {
    const { cam } = m
    for (const c of this.venue.cameraLocations) {
      this.under.poly(projectPoly(cam, c.coverage, 0.03), true).fill({ color: px.sectionFront, alpha: 0.07 }).stroke({ width: 1, color: px.sectionFront, alpha: 0.45 })
      project(cam, c.position.x, c.position.y, c.mountHeightM, this.a)
      project(cam, c.position.x, c.position.y, 0, this.b)
      this.over.moveTo(this.b.x, this.b.y).lineTo(this.a.x, this.a.y).stroke({ width: 1, color: px.sectionFront, alpha: 0.7 })
      this.over.rect(this.a.x - 4, this.a.y - 3, 8, 6).fill({ color: px.sectionFront })
    }
  }

  private drawStations(m: MarksInput): void {
    const { cam } = m
    for (const s of this.venue.stationLocations) {
      if (s.kind === 'first_aid') continue
      const h = s.kind === 'gateway' ? 3.6 : 1.8
      project(cam, s.position.x, s.position.y, 0, this.b)
      project(cam, s.position.x, s.position.y, h, this.a)
      this.over.moveTo(this.b.x, this.b.y).lineTo(this.a.x, this.a.y).stroke({ width: 1, color: px.teal, alpha: 0.6 })
      const r = s.kind === 'gateway' ? 4.5 : 3
      this.over
        .poly([this.a.x, this.a.y - r, this.a.x + r, this.a.y, this.a.x, this.a.y + r, this.a.x - r, this.a.y], true)
        .fill({ color: m.stale ? px.grey : px.teal, alpha: 0.95 })
    }
  }

  // ---------------------------------------------------------------- routes

  private drawRoutes(m: MarksInput): void {
    const { cam, time } = m
    const g = this.under
    const o = this.over
    const live = m.routes.filter((r) => r.mode === 'active')
    const preview = m.routes.filter((r) => r.mode === 'preview')
    if (m.layers.routes && !live.length && !preview.length) {
      // preapproved corridors, faint, so staff know where paths can open
      for (const c of this.corridors) {
        dashedPath(g, cam, c.path, 0, c.path.length, 0.03, 0.8, 1.6)
      }
      g.stroke({ width: 1, color: px.champagne, alpha: 0.28 })
    }
    const s = cam.scale
    for (const r of preview) {
      const tone = this.pathColors(r.command.commandId)
      const len = r.path.length
      const zAt = this.zAlong(r.path)
      this.lane(g, cam, r.path, len, 0.1, tone.wash, zAt)
      this.glowLine(cam, r.path, len, 0.55, tone.wash, zAt)
      if (zAt) dashedPathZ(o, cam, r.path, 0, len, zAt, 1.4, 1.0, m.animate ? -time * 1.5 : 0)
      else dashedPath(o, cam, r.path, 0, len, 0.06, 1.4, 1.0, m.animate ? -time * 1.5 : 0)
      o.stroke({ width: Math.max(3.5, 0.3 * s), color: tone.core, alpha: 0.95, cap: 'round' })
      this.startMark(o, cam, r.path, tone.wash, zAt)
    }
    for (const r of live) {
      const tone = this.pathColors(r.command.commandId)
      const rev = r.reveal
      const zAt = this.zAlong(r.path)
      this.lane(g, cam, r.path, rev, tone.wash === px.aside ? 0.28 : 0.16, tone.wash, zAt)
      const breathe = m.animate ? 0.85 + 0.15 * Math.sin(time * 2.2) : 1
      this.glowLine(cam, r.path, rev, breathe, tone.wash, zAt)
      // a dark edge under the core keeps it legible over the pale crowd
      if (zAt) pathLineZ(o, cam, r.path, rev, zAt)
      else pathLine(o, cam, r.path, rev, 0.06)
      o.stroke({ width: Math.max(7, 0.5 * s), color: 0x14120e, alpha: 0.55, cap: 'round', join: 'round' })
      if (zAt) pathLineZ(o, cam, r.path, rev, zAt)
      else pathLine(o, cam, r.path, rev, 0.06)
      o.stroke({ width: Math.max(4.5, 0.32 * s), color: tone.core, alpha: 1, cap: 'round', join: 'round' })
      // survey ticks every 2.5 m
      for (let t = 2.5; t < Math.min(rev, r.path.length - 2); t += 2.5) {
        const p = r.path.at(t)
        const tz = zAt ? zAt(t) : 0.06
        project(cam, p.x - p.uy * 0.6, p.y + p.ux * 0.6, tz, this.a)
        project(cam, p.x + p.uy * 0.6, p.y - p.ux * 0.6, tz, this.b)
        o.moveTo(this.a.x, this.a.y).lineTo(this.b.x, this.b.y)
      }
      o.stroke({ width: 1, color: tone.wash, alpha: 0.8 })
      // bright dashes flowing from First Aid toward the person
      if (zAt) dashedPathZ(o, cam, r.path, 0, Math.max(0, rev - 0.5), zAt, 1.1, 3.9, m.animate ? time * 4 : 0)
      else dashedPath(o, cam, r.path, 0, Math.max(0, rev - 0.5), 0.08, 1.1, 3.9, m.animate ? time * 4 : 0)
      o.stroke({ width: Math.max(2.5, 0.18 * s), color: 0xffffff, alpha: 0.95, cap: 'round' })
      this.startMark(o, cam, r.path, tone.wash, zAt)
      // step-aside arrows on people in the lane, on the same floor as the path
      const AL = Math.max(1.1, 14 / s)
      for (const ar of m.laneArrows) {
        const nudge = m.animate ? (0.5 + 0.5 * Math.sin(time * 4 + ar.i * 0.7)) * 0.25 : 0
        const bx = ar.x + ar.nx * (0.35 + nudge)
        const by = ar.y + ar.ny * (0.35 + nudge)
        const tx = bx + ar.nx * AL
        const ty = by + ar.ny * AL
        const hl = AL * 0.38
        let az = 0.1
        if (zAt) {
          r.path.project(ar.x, ar.y, this.hit)
          az = zAt(this.hit.along)
        }
        project(cam, bx, by, az, this.a)
        project(cam, tx, ty, az, this.b)
        o.moveTo(this.a.x, this.a.y).lineTo(this.b.x, this.b.y)
        const l = project(cam, tx - ar.nx * hl - ar.ny * hl * 0.7, ty - ar.ny * hl + ar.nx * hl * 0.7, az, { x: 0, y: 0, depth: 0 })
        const rr = project(cam, tx - ar.nx * hl + ar.ny * hl * 0.7, ty - ar.ny * hl - ar.nx * hl * 0.7, az, { x: 0, y: 0, depth: 0 })
        o.moveTo(l.x, l.y).lineTo(this.b.x, this.b.y).lineTo(rr.x, rr.y)
      }
      if (m.laneArrows.length) o.stroke({ width: 1.4, color: px.aside, alpha: 0.95, cap: 'round', join: 'round' })
    }
  }

  private pathColors(commandId: string | undefined): { wash: number; core: number } {
    if (commandId === 'demo-path') return { wash: px.aside, core: 0xffe3a3 }
    return { wash: px.champagne, core: PATH_CORE }
  }

  private lane(g: Graphics, cam: Camera, path: Path, to: number, alpha: number, color = px.champagne, zAt: ((s: number) => number) | null = null): void {
    if (to <= 0.1) return
    if (zAt) pathLineZ(g, cam, path, to, zAt)
    else pathLine(g, cam, path, to, 0.02)
    g.stroke({ width: Math.max(4, 3 * cam.scale), color, alpha, cap: 'round', join: 'round' })
  }

  /** Soft light around the path: wide and faint, then narrower and brighter. */
  private glowLine(cam: Camera, path: Path, to: number, level: number, color = px.champagne, zAt: ((s: number) => number) | null = null): void {
    if (to <= 0.1) return
    const g = this.glow
    const s = cam.scale
    for (const [w, a] of [
      [Math.max(26, 2.2 * s), 0.07],
      [Math.max(15, 1.2 * s), 0.14],
      [Math.max(8, 0.65 * s), 0.26],
    ] as const) {
      if (zAt) pathLineZ(g, cam, path, to, zAt)
      else pathLine(g, cam, path, to, 0.06)
      g.stroke({ width: w, color, alpha: a * level, cap: 'round', join: 'round' })
    }
  }

  private startMark(o: Graphics, cam: Camera, path: Path, color = px.champagne, zAt: ((s: number) => number) | null = null): void {
    const p = path.points[0]
    if (!p) return
    project(cam, p.x, p.y, zAt ? zAt(0) : 0, this.a)
    o.circle(this.a.x, this.a.y, Math.max(5, 0.6 * cam.scale)).stroke({ width: 1.4, color, alpha: 1 })
  }

  // ---------------------------------------------------------------- incidents

  private drawIncidents(m: MarksInput, dt: number): void {
    const { cam, time } = m
    const g = this.under
    const o = this.over
    let haloTarget = 0
    let haloAt: Vec2 | null = null
    if (m.layers.incidents) {
      for (const inc of m.incidents) {
        if (inc.status === 'resolved' || !inc.location) continue
        const { x, y } = inc.location
        const z = this.venue.venueId === 'calhacks' ? floorZ(x, y) : 0
        const confirmed = inc.localizationStatus === 'visually_confirmed'
        const focus = inc.incidentId === m.focusIncidentId
        if (focus || !haloAt) {
          haloAt = inc.location
          haloTarget = 1
        }
        const rot = m.animate ? time * 0.12 : 0
        // uncertainty of the estimate, distinct from the 4 m area
        if (!confirmed && inc.locationRadiusM) {
          groundCircle(g, cam, x, y, inc.locationRadiusM, 48, 0.35, -rot, z)
          g.stroke({ width: 1, color: px.red, alpha: 0.55 })
        }
        // the 4 m area around the person
        groundCircle(g, cam, x, y, 4, 28, 0.55, rot, z)
        g.stroke({ width: 1.6, color: px.red, alpha: confirmed ? 1 : 0.7 })
        if (inc.status === 'reported' && m.animate) {
          const pr = (time % 2.4) / 2.4
          groundCircle(g, cam, x, y, 4 * (0.35 + 1.05 * pr), 40, 1, 0, z)
          g.stroke({ width: 1.6, color: px.red, alpha: 0.8 * (1 - pr) })
        }
        // beacon: a light column rising from the spot
        project(cam, x, y, z, this.a)
        project(cam, x, y, z + BEACON_TOP, this.b)
        const flick = m.animate && inc.status === 'reported' ? 0.65 + 0.35 * Math.sin(time * 8) : 1
        o.moveTo(this.a.x, this.a.y).lineTo(this.b.x, this.b.y).stroke({ width: 6, color: px.red, alpha: 0.18 * flick })
        o.moveTo(this.a.x, this.a.y).lineTo(this.b.x, this.b.y).stroke({ width: 1.6, color: px.red, alpha: 0.95 })
        const r = 6
        o.poly([this.b.x, this.b.y - r * 1.3, this.b.x + r, this.b.y, this.b.x, this.b.y + r * 1.3, this.b.x - r, this.b.y], true).fill({ color: px.red })
        o.circle(this.a.x, this.a.y, Math.max(4, 0.45 * cam.scale)).fill({ color: px.red })
        o.circle(this.a.x, this.a.y, Math.max(1.6, 0.16 * cam.scale)).fill({ color: 0xffffff })
        // line of sight from the camera that is checking
        for (const obsId of inc.cameraObservations) {
          const obs = m.observations.find((ob) => ob.detectionId === obsId)
          if (!obs || (obs.status !== 'pending' && obs.status !== 'detected')) continue
          const camLoc = this.venue.cameraLocations.find((c) => c.cameraId === obs.cameraId)
          if (!camLoc) continue
          const from = project(cam, camLoc.position.x, camLoc.position.y, camLoc.mountHeightM, { x: 0, y: 0, depth: 0 })
          const to = project(cam, (obs.worldLocation ?? inc.location).x, (obs.worldLocation ?? inc.location).y, 1, { x: 0, y: 0, depth: 0 })
          const steps = 18
          for (let k = 0; k < steps; k += 2) {
            const f0 = k / steps
            const f1 = (k + 1) / steps
            o.moveTo(from.x + (to.x - from.x) * f0, from.y + (to.y - from.y) * f0).lineTo(from.x + (to.x - from.x) * f1, from.y + (to.y - from.y) * f1)
          }
          o.stroke({ width: 1, color: px.sectionFront, alpha: obs.status === 'detected' ? 0.9 : 0.5 })
        }
      }
    }
    this.haloAlpha += (haloTarget - this.haloAlpha) * Math.min(1, dt * 3)
    this.halo.alpha = this.haloAlpha
    this.halo.visible = this.haloAlpha > 0.01
    if (haloAt && this.halo.visible) {
      const [a, b, c, d, tx, ty] = groundMatrix(cam)
      const mtx = new Matrix(a, b, c, d, tx, ty)
      const R = 11
      mtx.append(new Matrix((2 * R) / 256, 0, 0, (2 * R) / 256, haloAt.x - R, haloAt.y - R))
      this.halo.setFromMatrix(mtx)
    }
  }

  // ---------------------------------------------------------------- bands

  private drawBands(m: MarksInput): void {
    const { cam, time } = m
    const o = this.over
    for (const d of m.devices) {
      const { at } = d
      const base = this.elevation(at.x, at.y)
      project(cam, at.x, at.y, base, this.b)
      project(cam, at.x, at.y, base + BAND_Z, this.a)
      o.moveTo(this.b.x, this.b.y).lineTo(this.a.x, this.a.y).stroke({ width: 1, color: px.ink, alpha: 0.4 })
      o.circle(this.b.x, this.b.y, 1.6).fill({ color: px.ink, alpha: 0.5 })
      const R = 9
      o.circle(this.a.x, this.a.y, R + 3).fill({ color: 0x0c0d10, alpha: 0.78 })
      o.circle(this.a.x, this.a.y, R + 3).stroke({ width: 1, color: 0xffffff, alpha: 0.18 })
      this.ledRing(o, this.a.x, this.a.y, R, d.device.currentPattern, time, m.animate, m.stale)
      if (d.pending || d.targeted) {
        // a command is on its way: dashed outer ring until the band confirms
        const steps = 16
        for (let k = 0; k < steps; k += 2) {
          const t0 = (k / steps) * Math.PI * 2 + (m.animate ? time : 0)
          o.moveTo(this.a.x + Math.cos(t0) * (R + 5), this.a.y + Math.sin(t0) * (R + 5)).arc(this.a.x, this.a.y, R + 5, t0, t0 + Math.PI / steps)
        }
        o.stroke({ width: 1.2, color: px.champagne, alpha: 0.95 })
      }
      if (d.failed) {
        o.circle(this.a.x, this.a.y, R + 6).stroke({ width: 1.6, color: px.red, alpha: 1 })
      }
    }
  }

  /** 12-pixel LED ring, as the firmware renders each pattern. */
  private ledRing(o: Graphics, x: number, y: number, R: number, pattern: LedPattern, time: number, animate: boolean, stale: boolean): void {
    const dot = 2
    for (let k = 0; k < LED_PIXELS; k++) {
      const ang = -Math.PI / 2 + (k / LED_PIXELS) * Math.PI * 2
      const lx = x + Math.cos(ang) * R
      const ly = y + Math.sin(ang) * R
      let color = 0x2a2b30
      let alpha = 1
      if (!stale) {
        switch (pattern) {
          case 'ready':
            if (k === 0) {
              color = px.teal
              alpha = animate ? 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(time * 2.1)) : 1
            }
            break
          case 'sos': {
            // triple flash each second: the camera looks for this
            const ph = animate ? (time % 1) / 1 : 0.05
            const on = ph < 0.1 || (ph > 0.2 && ph < 0.3) || (ph > 0.4 && ph < 0.5)
            color = on ? px.red : 0x3a1412
            break
          }
          case 'steady_red':
            color = px.red
            break
          case 'step_aside': {
            const side = (k >= 2 && k <= 4) || (k >= 8 && k <= 10)
            const on = !animate || Math.sin(time * Math.PI * 2 * 1.1) > 0
            if (side) color = on ? px.amber : 0x3b2c18
            break
          }
          case 'help_coming':
            if (k === 0 || k === 4 || k === 8) color = px.green
            break
          case 'off':
            break
          case 'unknown':
            color = 0x3a3b40
            alpha = 0.6
            break
        }
      }
      o.circle(lx, ly, dot).fill({ color, alpha })
    }
  }
}
