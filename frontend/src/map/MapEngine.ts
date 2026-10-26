/**
 * The venue map renderer. Owns one PixiJS 8 Application and draws the whole spatial picture each
 * animation frame from the stores, without going through React. React mounts it, positions labels
 * through anchors (moved here every frame), and calls the controller for camera moves.
 */
import { Application, Container } from 'pixi.js'
import { boothHandle, moveBooth, resizeBooth, saveBooth, useBooth } from '@/booth/circle'
import { demoDevices as layDemoDevices, demoIsActive, demoRingHandle, moveDemoRing, resizeDemoRing, saveDemoRing, useDemoRing, useHardware, withDemoIncidents } from '@/booth/demoRing'
import { characterAt } from '@/mock/calhacksCrowd'
import { castRoster } from '@/stdb/cast'
import { personWidthPx, pickPerson } from './personPicking'
import { presentCalhacks } from '@/stdb/floor'
import type { Device, GuidanceCommand, Incident, LedPattern, Vec2, Venue } from '@/contracts/domain'
import { EntityKind } from '@/contracts/domain'
import { createElevation, type ElevationAt } from '@/lib/elevation'
import { newProjectResult, pointInPolygon } from '@/lib/geometry'
import { isLive, useConnection } from '@/stores/connection'
import { useSession } from '@/stdb/session'
import { baselineFrames, frames, useMapStats } from '@/stores/frames'
import { useUi, type HoverInfo } from '@/stores/ui'
import { useWorld } from '@/stores/world'
import { CLASS_LANE, CLASS_NEAR, CrowdLayer, raisedCovers } from './layers/crowdLayer'
import { DensityLayer } from './layers/densityLayer'
import { BAND_Z, BEACON_TOP, MarksLayer, type ActiveRoute } from './layers/marksLayer'
import { StageLayer } from './layers/stageLayer'
import { chosenModel, type ChosenModel } from '@/venue/chosenModel'
import { HallMesh, PALACE_HALL } from './hallMesh'
import { VenueLayer } from './layers/venueLayer'
import { mapPalette } from './palette'
import {
  DEFAULT_TILT,
  DEFAULT_YAW,
  MAX_TILT,
  easeCamera,
  fitCamera,
  focusCamera,
  panBy,
  project,
  unproject,
  zoomAt,
  type Camera,
  type Rect,
} from './projection'

const NEAR_RADIUS = 4
/** Metres past the test ring that turn red while an SOS is up. */
const RING_HALO = 2.8
const LANE_HALF = 1.5
const REVEAL_SPEED = 40

export interface Anchor {
  el: HTMLElement
  resolve: () => { x: number; y: number; z: number } | null
  /** Hide when the camera is zoomed out past this scale. */
  minScale?: number
}

export class MapEngine {
  private app: Application | null = null
  private host: HTMLElement | null = null
  private destroyed = false
  private venue: Venue | null = null
  private venueLayer: VenueLayer | null = null
  private hall: HallMesh | null = null
  /** A chosen venue that is not the Palace: only its model is drawn, nothing traced on the Palace. */
  private modelOnly: ChosenModel | null = null
  private hallKey = PALACE_HALL.venueId
  private stage: StageLayer | null = null
  private crowd: CrowdLayer | null = null
  private density: DensityLayer | null = null
  private marks: MarksLayer | null = null
  private root = new Container()
  private cam: Camera = { cx: 50, cy: 32, scale: 10, yaw: DEFAULT_YAW, tilt: DEFAULT_TILT, ax: 600, ay: 400 }
  private target: Camera = { ...this.cam }
  private camDirty = true
  private userMoved = false
  private time = 0
  private positions = new Float32Array(0)
  private ghostPositions = new Float32Array(0)
  private classes = new Uint8Array(0)
  private densityT = 0
  private statsT = 0
  private fpsAcc = { n: 0, t: 0 }
  private slowSince = -1
  private lowQuality = false
  private reveal = new Map<string, { at: number }>()
  private devicePos = new Map<string, Vec2>()
  private anchors = new Map<string, Anchor>()
  private unsubs: (() => void)[] = []
  private resizeObserver: ResizeObserver | null = null
  private drag: { x: number; y: number; moved: boolean; button: number; id: number; booth?: 'move' | 'resize' } | null = null
  private hoverPoint: { x: number; y: number } | null = null
  private reducedMotion = false
  private readonly pr = newProjectResult()
  private lastLayers = ''
  private lastVenue: Venue | null = null
  private elevation: ElevationAt = () => 0

  async mount(host: HTMLElement): Promise<void> {
    this.host = host
    const app = new Application()
    await app.init({
      background: mapPalette.void,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(2, window.devicePixelRatio || 1),
      width: Math.max(1, host.clientWidth),
      height: Math.max(1, host.clientHeight),
      preference: 'webgl',
    })
    if (this.destroyed) {
      app.destroy(true, { children: true, texture: true })
      return
    }
    this.app = app
    app.canvas.style.position = 'absolute'
    app.canvas.style.inset = '0'
    app.canvas.style.width = '100%'
    app.canvas.style.height = '100%'
    app.canvas.setAttribute('aria-hidden', 'true')
    this.hall = new HallMesh(host, () => {
      this.camDirty = true
    })
    this.hall.resize(host.clientWidth, host.clientHeight)
    host.appendChild(app.canvas)
    app.stage.addChild(this.root)

    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    this.reducedMotion = !!mq?.matches
    const onMq = (e: MediaQueryListEvent) => (this.reducedMotion = e.matches)
    mq?.addEventListener?.('change', onMq)
    this.unsubs.push(() => mq?.removeEventListener?.('change', onMq))

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(host)
    this.bindInput(app.canvas)

    this.unsubs.push(
      useUi.subscribe((s, prev) => {
        if (s.insets !== prev.insets && !this.userMoved) this.fit(false)
        if (s.view !== prev.view) this.applyView(s.view)
        this.camDirty = true
      }),
    )
    app.ticker.add((t) => this.tick(t.deltaMS / 1000))
  }

  destroy(): void {
    this.destroyed = true
    this.unsubs.forEach((u) => u())
    this.unsubs = []
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.crowd?.destroy()
    this.density?.destroy()
    this.hall?.destroy()
    this.hall = null
    if (this.app) {
      this.app.destroy(true, { children: true, texture: true })
      this.app = null
    }
    this.anchors.clear()
  }

  // ---------------------------------------------------------------- public camera API

  registerAnchor(key: string, anchor: Anchor | null): void {
    if (anchor) this.anchors.set(key, anchor)
    else this.anchors.delete(key)
  }

  fit(animate = true): void {
    if (!this.venue) return
    const size = this.modelOnly ?? this.venue
    const t = fitCamera(size.width, size.height, 9, this.target.yaw, this.target.tilt, this.openArea())
    this.setTarget(t, animate)
    this.userMoved = false
  }

  focus(point: Vec2, scale = 20, animate = true): void {
    const t = focusCamera(point.x, point.y, scale, this.target.yaw, this.target.tilt, this.openArea())
    this.setTarget(t, animate)
    this.userMoved = true
  }

  /** Frame a set of ground points (an incident and its corridor) in the open area. */
  frame(points: Vec2[], maxScale = 22): void {
    if (!points.length) return
    const area = this.openArea()
    const probe: Camera = { ...this.target, scale: 1, ax: 0, ay: 0 }
    const cx = points.reduce((a, p) => a + p.x, 0) / points.length
    const cy = points.reduce((a, p) => a + p.y, 0) / points.length
    probe.cx = cx
    probe.cy = cy
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (const p of points) {
      for (const z of [0, 6]) {
        const s = project(probe, p.x, p.y, z)
        minX = Math.min(minX, s.x)
        maxX = Math.max(maxX, s.x)
        minY = Math.min(minY, s.y)
        maxY = Math.max(maxY, s.y)
      }
    }
    const scale = Math.min(maxScale, (area.w * 0.8) / Math.max(1, maxX - minX), (area.h * 0.78) / Math.max(1, maxY - minY))
    const t: Camera = {
      ...this.target,
      cx,
      cy,
      scale,
      ax: area.x + area.w / 2 - (scale * (minX + maxX)) / 2,
      ay: area.y + area.h / 2 - (scale * (minY + maxY)) / 2,
    }
    this.setTarget(t, true)
    this.userMoved = true
  }

  focusIncident(incidentId: string): boolean {
    const inc = useWorld.getState().incidents[incidentId]
    if (!inc?.location) return false
    this.focus(inc.location, 19)
    return true
  }

  zoom(factor: number): void {
    const a = this.openArea()
    this.setTarget(zoomAt(this.target, factor, a.x + a.w / 2, a.y + a.h / 2), true)
    this.userMoved = true
  }

  rotate(deg: number): void {
    this.setTarget({ ...this.target, yaw: this.target.yaw + (deg * Math.PI) / 180 }, true)
  }

  setTilt(tilt: number): void {
    this.setTarget({ ...this.target, tilt: Math.max(0, Math.min(MAX_TILT, tilt)) }, true)
  }

  resetView(): void {
    this.target = { ...this.target, yaw: DEFAULT_YAW, tilt: useUi.getState().view === 'plan' ? 0 : DEFAULT_TILT }
    this.fit(true)
  }

  /** Where a device marker currently is on screen, for tests and tooltips. */
  screenOf(x: number, y: number, z = 0): { x: number; y: number } {
    const p = project(this.cam, x, y, z)
    return { x: p.x, y: p.y }
  }

  get camera(): Camera {
    return { ...this.cam }
  }

  // ---------------------------------------------------------------- internals

  private applyView(view: '3d' | 'plan'): void {
    const tilt = view === 'plan' ? 0 : DEFAULT_TILT
    const yaw = view === 'plan' ? 0 : DEFAULT_YAW
    if (this.userMoved) this.setTarget({ ...this.target, tilt, yaw }, true)
    else {
      this.target = { ...this.target, tilt, yaw }
      this.fit(true)
    }
  }

  private setTarget(t: Camera, animate: boolean): void {
    this.target = { ...t }
    if (!animate || this.reducedMotion) this.cam = { ...t }
    this.camDirty = true
  }

  private openArea(): Rect {
    const w = this.host?.clientWidth ?? 1200
    const h = this.host?.clientHeight ?? 800
    const i = useUi.getState().insets
    const x = Math.min(w - 200, i.left)
    const y = Math.min(h - 200, i.top)
    return { x, y, w: Math.max(200, w - i.left - i.right), h: Math.max(200, h - i.top - i.bottom) }
  }

  private resize(): void {
    if (!this.app || !this.host) return
    const width = Math.max(1, this.host.clientWidth)
    const height = Math.max(1, this.host.clientHeight)
    this.app.renderer.resize(width, height)
    this.hall?.resize(width, height)
    if (!this.userMoved) this.fit(false)
    this.camDirty = true
  }

  private ensureVenue(venue: Venue | null): void {
    if (!venue || venue === this.lastVenue || !this.app) return
    this.lastVenue = venue
    this.venue = venue
    this.root.removeChildren()
    this.crowd?.destroy()
    this.density?.destroy()
    this.elevation = createElevation(venue)
    this.venueLayer = new VenueLayer(venue)
    // lights on the PA and delay towers as well as the truss
    const towers = venue.structures
      .filter((st) => st.kind === 'tower' || st.kind === 'speaker')
      .map((st) => {
        const xs = st.footprint.map((q) => q.x)
        const ys = st.footprint.map((q) => q.y)
        return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2, z: st.baseM + st.heightM }
      })
    this.stage = new StageLayer(venue.stages[0], towers)
    // one crowd bucket in front of each structure, plus one behind them all
    this.crowd = new CrowdLayer(venue.width, venue.height, this.venueLayer.count + 1, this.elevation, raisedCovers(venue))
    this.density = new DensityLayer(venue, this.elevation)
    this.marks = new MarksLayer(venue, this.elevation)
    const { venueLayer, stage, crowd, density, marks } = this
    this.root.addChild(venueLayer.root, density.heat, crowd.trails, crowd.cover, marks.zoneG, marks.halo, marks.under, density.flow)
    this.root.addChild(crowd.slices[0])
    for (let k = 0; k < venueLayer.count; k++) this.root.addChild(venueLayer.solids[k], crowd.slices[k + 1])
    this.root.addChild(stage.wall, density.heatUpper, crowd.ghosts, density.columns, stage.beams, marks.glow, marks.over)
    this.fit(false)
  }

  /** Draw the chosen venue's model in place of the Palace, or bring the Palace back. */
  private swapHall(model: ChosenModel | null, key: string): void {
    if (!this.host) return
    this.hallKey = key
    this.modelOnly = model
    this.hall?.destroy()
    const source = model ? { url: model.url, venueId: model.venueId, fit: 'bounds' as const } : PALACE_HALL
    this.hall = new HallMesh(
      this.host,
      () => {
        this.camDirty = true
      },
      source,
    )
    this.hall.resize(this.host.clientWidth, this.host.clientHeight)
    this.root.visible = !model
    if (useUi.getState().hover) useUi.getState().setHover(null)
    this.userMoved = false
    this.fit(false)
  }

  private tick(dtRaw: number): void {
    if (!this.app) return
    const dt = Math.min(0.1, dtRaw)
    const world = useWorld.getState()
    const ui = useUi.getState()
    this.ensureVenue(world.venue)
    if (!this.venue || !this.venueLayer || !this.crowd || !this.density || !this.marks || !this.stage) return
    const animate = !this.reducedMotion
    this.time += dt
    const connection = useConnection.getState()
    const stale = !isLive(connection)

    // camera
    if (easeCamera(this.cam, this.target, 1 - Math.exp(-dt * 5))) this.camDirty = true
    const layers = ui.layers
    const layerKey = JSON.stringify(layers)
    if (layerKey !== this.lastLayers) {
      this.lastLayers = layerKey
      this.camDirty = true
    }
    // A chosen venue other than the Palace replaces the event floor: its model alone, no zones,
    // crowd, bands or incidents, which are all placed on the Palace's traced plan.
    const wanted = this.venue.venueId === PALACE_HALL.venueId ? chosenModel() : null
    const key = wanted ? `${wanted.venueId}|${wanted.url}` : PALACE_HALL.venueId
    if (key !== this.hallKey) this.swapHall(wanted, key)
    if (this.modelOnly) {
      const on = this.hall?.showing(this.modelOnly.venueId) ?? false
      if (this.hall) this.hall.canvas.style.visibility = on ? 'visible' : 'hidden'
      if (on) this.hall?.render(this.cam)
      this.placeAnchors()
      this.camDirty = false
      return
    }

    const venueLayer = this.venueLayer
    // people go after every structure they stand in front of, tested at their own place across the view
    const bucketOf = (rx: number, ry: number) => venueLayer.bucketOf(rx, ry)

    // positions
    const latest = frames.latest()
    const count = latest?.count ?? 0
    if (this.positions.length < count * 2) {
      this.positions = new Float32Array(count * 2 + 256)
      this.classes = new Uint8Array(count + 128)
    }
    const n = frames.sample(performance.now(), this.positions)

    // incidents, routes, classification
    const incidents = Object.values(world.incidents)
    const open = incidents.filter((i) => i.status !== 'resolved')
    const floorBands = this.venue.venueId === 'calhacks' ? useHardware.getState().bands : []
    const shown = this.venue.venueId === 'calhacks' ? withDemoIncidents(open, floorBands, useDemoRing.getState()) : open
    const focus = ui.selection.kind === 'incident' ? ui.selection.id : (shown[0]?.incidentId ?? null)
    const routes = this.routes(world.commands, dt)
    this.classify(n, shown, routes, latest?.kinds)

    // density field every half second
    this.densityT -= dt
    if (this.densityT <= 0 && n > 0) {
      this.densityT = 0.5
      this.density.refresh(this.positions, n, latest?.velocities ?? null, (z) => world.zones[z]?.congestionStatus ?? 'unknown')
      this.camDirty = true
    }

    const hallOn = this.hall?.showing(this.venue.venueId) ?? false
    this.hall?.canvas && (this.hall.canvas.style.visibility = hallOn ? 'visible' : 'hidden')
    if (hallOn) this.hall?.render(this.cam)
    if (this.camDirty) {
      this.venueLayer.draw(this.cam, { grid: layers.grid, structures: layers.structures && !hallOn, floor: !hallOn })
      this.density.place(this.cam, layers.heatmap && !stale, layers.flow && !stale)
      this.crowd.placeTrails(this.cam, layers.trails)
    }

    this.crowd.update({
      renderer: this.app.renderer,
      cam: this.cam,
      positions: this.positions,
      count: n,
      kinds: latest?.kinds,
      poses: latest?.pose,
      heights: latest?.heights,
      classes: this.classes,
      showPeople: layers.people,
      showTrails: layers.trails,
      // The CalHacks crowd is drawn locally, so a quiet live link must not turn the cylinders gray.
      stale: stale && this.venue.venueId !== 'calhacks',
      inking: !stale && frames.rate > 0.01,
      bucketOf,
    })
    const ghosts = baselineFrames.latest()
    if (ghosts && layers.baseline) {
      if (this.ghostPositions.length < ghosts.count * 2) this.ghostPositions = new Float32Array(ghosts.count * 2 + 64)
      const gn = baselineFrames.sample(performance.now(), this.ghostPositions)
      this.crowd.updateGhosts(this.cam, this.ghostPositions, gn, true)
    } else this.crowd.updateGhosts(this.cam, null, 0, false)

    this.stage.draw(this.cam, this.time, dt, shown.length > 0, animate, layers.structures)

    this.marks.draw(
      {
        cam: this.cam,
        time: this.time,
        animate,
        layers,
        incidents: shown,
        focusIncidentId: focus,
        routes,
        devices:
          this.venue.venueId === 'calhacks'
            ? this.bandMarkers(this.demoDevices(), {}, dt)
            : this.showBandSignals()
              ? this.bandMarkers(world.devices, world.commands, dt)
              : this.clearBandSignals(),
        observations: Object.values(world.observations),
        zones: world.zones,
        selectedZoneId: ui.selection.kind === 'zone' ? ui.selection.id : null,
        hoverZoneId: ui.hover?.kind === 'zone' ? ui.hover.id : null,
        plainZones: hallOn,
        stale,
        laneArrows: this.laneArrows(n, routes),
        booth:
          this.venue.venueId === 'main-stage'
            ? { ...useBooth.getState(), live: useSession.getState().phase === 'live' }
            : this.venue.venueId === 'calhacks'
              ? {
                  ...useDemoRing.getState(),
                  live: useSession.getState().phase === 'live',
                  lost: useSession.getState().phase === 'error',
                  demo: true,
                  alert: demoIsActive(floorBands, incidents),
                }
              : undefined,
      },
      dt,
    )

    this.placeAnchors()
    this.camDirty = false
    this.updateHover()
    this.publishStats(dt, n)
  }

  /** Corridors to draw: previews and active guidance, with the active lane revealed over time. */
  private routes(commands: Record<string, GuidanceCommand>, dt: number): ActiveRoute[] {
    const out: ActiveRoute[] = []
    const marks = this.marks
    if (!marks) return out
    const booth = useBooth.getState()
    if (this.venue?.venueId === 'main-stage') marks.setBoothPath([{ x: 10.3, y: 56 }, { x: booth.x, y: booth.y }])
    else marks.setBoothPath(null)
    const seen = new Set<string>()
    for (const c of Object.values(commands)) {
      const path = marks.corridorPath(c.corridorId)
      if (!path) continue
      if (c.approvalStatus === 'pending_approval') out.push({ path, command: c, mode: 'preview', reveal: path.length })
      else if (c.approvalStatus === 'approved' && c.deliveryStatus !== 'cancelled') {
        seen.add(c.commandId)
        const r = this.reveal.get(c.commandId) ?? { at: 0 }
        r.at = this.reducedMotion ? path.length : Math.min(path.length, r.at + REVEAL_SPEED * dt)
        this.reveal.set(c.commandId, r)
        out.push({ path, command: c, mode: 'active', reveal: r.at })
      }
    }
    for (const k of [...this.reveal.keys()]) if (!seen.has(k)) this.reveal.delete(k)
    return out
  }

  private classify(n: number, open: Incident[], routes: ActiveRoute[], kinds: Uint8Array | undefined): void {
    const cls = this.classes
    const pos = this.positions
    const near = open.filter((i) => i.location).map((i) => i.location!)
    const active = routes.filter((r) => r.mode === 'active')
    const r2 = NEAR_RADIUS * NEAR_RADIUS
    const ringAlert = this.venue?.venueId === 'calhacks' && demoIsActive(useHardware.getState().bands, open)
    const ring = ringAlert ? useDemoRing.getState() : null
    const halo = ring ? (ring.r + RING_HALO) * (ring.r + RING_HALO) : 0
    for (let i = 0; i < n; i++) {
      cls[i] = 0
      if (kinds && kinds[i] !== EntityKind.SimAttendee) continue
      const x = pos[2 * i]
      const y = pos[2 * i + 1]
      let c = 0
      for (const p of near) {
        const dx = x - p.x
        const dy = y - p.y
        if (dx * dx + dy * dy <= r2) {
          c = CLASS_NEAR
          break
        }
      }
      if (!c && ring) {
        const dx = x - ring.x
        const dy = y - ring.y
        if (dx * dx + dy * dy <= halo) c = CLASS_NEAR
      }
      if (!c) {
        for (const r of active) {
          r.path.project(x, y, this.pr)
          const half = LANE_HALF
          if (this.pr.distance <= half && this.pr.along <= r.reveal) {
            c = CLASS_LANE
            break
          }
        }
      }
      cls[i] = c
    }
  }

  private laneArrows(n: number, routes: ActiveRoute[]): { x: number; y: number; nx: number; ny: number; i: number }[] {
    const active = routes.filter((r) => r.mode === 'active')
    if (!active.length) return []
    const out: { x: number; y: number; nx: number; ny: number; i: number }[] = []
    const taken = new Set<number>()
    for (let i = 0; i < n; i++) {
      if (this.classes[i] !== CLASS_LANE) continue
      const x = this.positions[2 * i]
      const y = this.positions[2 * i + 1]
      // at most one arrow per 1.8 m cell, so the passage stays readable
      const key = Math.floor(x / 1.8) * 1000 + Math.floor(y / 1.8)
      if (taken.has(key)) continue
      taken.add(key)
      active[0].path.project(x, y, this.pr)
      out.push({ x, y, nx: this.pr.nx, ny: this.pr.ny, i })
    }
    return out
  }

  /**
   * CalHacks draws database people as figures. Wristband icons stay with the few hardware bands
   * in the ring, never one pin per row. The concert plan still shows its bands.
   */
  private demoDevices(): Record<string, Device> {
    const devices: Record<string, Device> = {}
    for (const device of layDemoDevices(useHardware.getState().bands, useDemoRing.getState())) devices[device.deviceId] = device
    return devices
  }

  private showBandSignals(): boolean {
    return useUi.getState().layers.bands && this.venue?.venueId !== 'calhacks'
  }

  private clearBandSignals(): { device: Device; at: Vec2; pending: boolean; failed: boolean; targeted: LedPattern | null }[] {
    if (this.devicePos.size) this.devicePos.clear()
    return []
  }

  private bandMarkers(devices: Record<string, Device>, commands: Record<string, GuidanceCommand>, dt: number) {
    const out: { device: Device; at: Vec2; pending: boolean; failed: boolean; targeted: LedPattern | null }[] = []
    const preview = Object.values(commands).filter((c) => c.approvalStatus === 'pending_approval')
    const active = Object.values(commands).filter((c) => c.approvalStatus === 'approved')
    const k = 1 - Math.exp(-dt * 6)
    for (const d of Object.values(devices)) {
      if (!d.location) {
        this.devicePos.delete(d.deviceId)
        continue
      }
      const prev = this.devicePos.get(d.deviceId)
      const at = prev && Math.hypot(prev.x - d.location.x, prev.y - d.location.y) < 6
        ? { x: prev.x + (d.location.x - prev.x) * k, y: prev.y + (d.location.y - prev.y) * k }
        : { ...d.location }
      this.devicePos.set(d.deviceId, at)
      const targetedIn = preview.flatMap((c) => c.targets).find((t) => t.deviceId === d.deviceId)
      const activeTarget = active.flatMap((c) => c.targets).find((t) => t.deviceId === d.deviceId)
      out.push({
        device: d,
        at,
        pending: activeTarget?.status === 'sent',
        failed: activeTarget?.status === 'failed',
        targeted: targetedIn?.patternCode ?? null,
      })
    }
    return out
  }

  /** Eased marker position of a band, for its label anchor. */
  deviceAt(deviceId: string): Vec2 | null {
    return this.devicePos.get(deviceId) ?? null
  }

  /** Height of the walking surface at a point (stands, stairs). */
  elevationAt(x: number, y: number): number {
    return this.elevation(x, y)
  }

  /** Current interpolated position of the simulated responder, if one is out. */
  responderAt(): Vec2 | null {
    const latest = frames.latest()
    if (!latest) return null
    for (let i = latest.count - 1; i >= 0; i--) {
      if (latest.kinds[i] === EntityKind.SimResponder) return { x: this.positions[2 * i], y: this.positions[2 * i + 1] }
    }
    return null
  }

  private placeAnchors(): void {
    const area = this.host
    if (!area) return
    const w = area.clientWidth
    const h = area.clientHeight
    for (const a of this.anchors.values()) {
      const p = a.resolve()
      const hidden = !p || (a.minScale !== undefined && this.cam.scale < a.minScale)
      if (hidden) {
        if (a.el.style.visibility !== 'hidden') a.el.style.visibility = 'hidden'
        continue
      }
      const s = project(this.cam, p.x, p.y, p.z)
      const off = s.x < -50 || s.y < -50 || s.x > w + 50 || s.y > h + 50
      const vis = off ? 'hidden' : 'visible'
      if (a.el.style.visibility !== vis) a.el.style.visibility = vis
      const tf = `translate3d(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px, 0)`
      if (a.el.style.transform !== tf) a.el.style.transform = tf
    }
  }

  private publishStats(dt: number, n: number): void {
    this.fpsAcc.n++
    this.fpsAcc.t += dt
    this.statsT -= dt
    if (this.statsT > 0) return
    this.statsT = 0.25
    const fps = this.fpsAcc.t > 0 ? this.fpsAcc.n / this.fpsAcc.t : 0
    this.fpsAcc = { n: 0, t: 0 }
    // quality fallback: drop trails when the machine cannot keep up
    if (fps < 38 && fps > 0) {
      if (this.slowSince < 0) this.slowSince = this.time
      else if (this.time - this.slowSince > 3 && !this.lowQuality) {
        this.lowQuality = true
        useUi.getState().toggleLayer('trails', false)
      }
    } else this.slowSince = -1
    let near = 0
    let lane = 0
    for (let i = 0; i < n; i++) {
      if (this.classes[i] === CLASS_NEAR) near++
      else if (this.classes[i] === CLASS_LANE) lane++
    }
    useMapStats.getState().set({ nearIncident: near, onCorridor: lane, fps: Math.round(fps) })
  }

  // ---------------------------------------------------------------- input

  private bindInput(cv: HTMLCanvasElement): void {
    const local = (e: PointerEvent | WheelEvent | MouseEvent) => {
      const b = cv.getBoundingClientRect()
      return { x: e.clientX - b.left, y: e.clientY - b.top }
    }
    const down = (e: PointerEvent) => {
      const l = local(e)
      const booth = useBooth.getState()
      const ring = useDemoRing.getState()
      let handle: 'move' | 'resize' | undefined
      const editingBooth = booth.editing && this.venue?.venueId === 'main-stage'
      const editingRing = ring.editing && this.venue?.venueId === 'calhacks'
      if ((editingBooth || editingRing) && !this.modelOnly && e.button === 0 && !e.shiftKey && !e.altKey) {
        const ground = unproject(this.cam, l.x, l.y)
        const pxPerM = this.cam.scale * Math.max(0.35, Math.cos(this.cam.tilt))
        handle = (editingRing ? demoRingHandle(ground.x, ground.y, ring, pxPerM) : boothHandle(ground.x, ground.y, booth, pxPerM)) ?? undefined
      }
      this.drag = { x: l.x, y: l.y, moved: false, button: e.shiftKey || e.altKey ? 2 : e.button, id: e.pointerId, booth: handle }
      cv.setPointerCapture(e.pointerId)
    }
    const move = (e: PointerEvent) => {
      const l = local(e)
      this.hoverPoint = l
      if (!this.drag) return
      const dx = l.x - this.drag.x
      const dy = l.y - this.drag.y
      if (!this.drag.moved && Math.hypot(dx, dy) < 4) return
      this.drag.moved = true
      this.userMoved = true
      if (this.drag.booth) {
        const ground = unproject(this.cam, l.x, l.y)
        if (this.venue?.venueId === 'calhacks') {
          const ring = useDemoRing.getState()
          if (this.drag.booth === 'move') moveDemoRing(ground.x, ground.y)
          else resizeDemoRing(Math.hypot(ground.x - ring.x, ground.y - ring.y))
        } else {
          const booth = useBooth.getState()
          if (this.drag.booth === 'move') moveBooth(ground.x, ground.y)
          else resizeBooth(Math.hypot(ground.x - booth.x, ground.y - booth.y))
        }
        this.drag.x = l.x
        this.drag.y = l.y
        return
      }
      if (this.drag.button === 2) {
        // rotate and tilt
        const next = { ...this.cam, yaw: this.cam.yaw + dx * 0.006, tilt: Math.max(0, Math.min(MAX_TILT, this.cam.tilt + dy * 0.004)) }
        this.cam = next
        this.target = { ...next }
      } else {
        const next = panBy(this.cam, this.drag.x, this.drag.y, l.x, l.y)
        this.cam = next
        this.target = { ...next }
      }
      this.drag.x = l.x
      this.drag.y = l.y
      this.camDirty = true
    }
    const up = (e: PointerEvent) => {
      if (this.drag?.booth && this.drag.moved) {
        if (this.venue?.venueId === 'calhacks') {
          saveDemoRing()
          presentCalhacks()
        } else saveBooth()
      }
      else if (this.drag && !this.drag.moved && this.drag.button === 0) this.pick(local(e))
      this.drag = null
    }
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const l = local(e)
      const next = zoomAt(this.cam, Math.exp(-e.deltaY * 0.0015), l.x, l.y)
      this.cam = next
      this.target = { ...next }
      this.userMoved = true
      this.camDirty = true
    }
    const leave = () => {
      this.hoverPoint = null
      if (useUi.getState().hover) useUi.getState().setHover(null)
    }
    const ctx = (e: MouseEvent) => e.preventDefault()
    cv.addEventListener('pointerdown', down)
    cv.addEventListener('pointermove', move)
    cv.addEventListener('pointerup', up)
    cv.addEventListener('pointerleave', leave)
    cv.addEventListener('wheel', wheel, { passive: false })
    cv.addEventListener('contextmenu', ctx)
    this.unsubs.push(() => {
      cv.removeEventListener('pointerdown', down)
      cv.removeEventListener('pointermove', move)
      cv.removeEventListener('pointerup', up)
      cv.removeEventListener('pointerleave', leave)
      cv.removeEventListener('wheel', wheel)
      cv.removeEventListener('contextmenu', ctx)
    })
  }

  /** Keyboard control, called by the React container that holds focus. */
  handleKey(e: KeyboardEvent): boolean {
    const step = 60
    const a = this.openArea()
    const cx = a.x + a.w / 2
    const cy = a.y + a.h / 2
    const pan = (dx: number, dy: number) => {
      this.setTarget(panBy(this.target, cx, cy, cx + dx, cy + dy), true)
      this.userMoved = true
    }
    switch (e.key) {
      case 'ArrowLeft':
        pan(step, 0)
        return true
      case 'ArrowRight':
        pan(-step, 0)
        return true
      case 'ArrowUp':
        pan(0, step)
        return true
      case 'ArrowDown':
        pan(0, -step)
        return true
      case '+':
      case '=':
        this.zoom(1.25)
        return true
      case '-':
      case '_':
        this.zoom(1 / 1.25)
        return true
      case 'q':
      case 'Q':
        this.rotate(-15)
        return true
      case 'e':
      case 'E':
        this.rotate(15)
        return true
      case '0':
        this.fit(true)
        return true
      case 'Escape':
        useUi.getState().select({ kind: 'none' })
        return true
      default:
        return false
    }
  }

  private hitTest(l: { x: number; y: number }): HoverInfo | null {
    if (this.modelOnly) return null
    const world = useWorld.getState()
    // incidents: beacon base or top
    for (const inc of Object.values(world.incidents)) {
      if (inc.status === 'resolved' || !inc.location) continue
      const base = project(this.cam, inc.location.x, inc.location.y, 0)
      const top = project(this.cam, inc.location.x, inc.location.y, BEACON_TOP)
      if (Math.hypot(l.x - base.x, l.y - base.y) < 16 || Math.hypot(l.x - top.x, l.y - top.y) < 14) {
        return { kind: 'incident', id: inc.incidentId, x: l.x, y: l.y }
      }
    }
    if (this.venue?.venueId === 'calhacks' && useUi.getState().layers.people) {
      const size = personWidthPx(this.cam.scale)
      const person = pickPerson(l, castRoster(), characterAt, (at) => {
        const feet = project(this.cam, at.x, at.y, this.elevation(at.x, at.y))
        return { x: feet.x, y: feet.y - size * 0.95 }
      }, Math.max(14, size))
      if (person != null) return { kind: 'device', id: `band-${person}`, x: l.x, y: l.y }
    }
    // The visible hardware bands remain selectable on either floor.
    if (useUi.getState().layers.bands) {
      for (const [id, at] of this.devicePos) {
        const p = project(this.cam, at.x, at.y, BAND_Z + this.elevation(at.x, at.y))
        if (Math.hypot(l.x - p.x, l.y - p.y) < 12) return { kind: 'device', id, x: l.x, y: l.y }
      }
    }
    // raised stands first (they sit in front of what is under them), then the floor
    const v = this.venue
    if (v) {
      const raised = v.zones.filter((z) => (z.elevationM ?? 0) > 0)
      for (const z of raised) {
        const g = unproject(this.cam, l.x, l.y + (z.elevationM ?? 0) * this.cam.scale * Math.sin(this.cam.tilt))
        if (pointInPolygon(g.x, g.y, z.polygon)) return { kind: 'zone', id: z.zoneId, x: l.x, y: l.y }
      }
      const g = unproject(this.cam, l.x, l.y)
      for (const z of v.zones) if (!(z.elevationM ?? 0) && pointInPolygon(g.x, g.y, z.polygon)) return { kind: 'zone', id: z.zoneId, x: l.x, y: l.y }
    }
    return null
  }

  private pick(l: { x: number; y: number }): void {
    const hit = this.hitTest(l)
    const ui = useUi.getState()
    if (!hit) {
      ui.select({ kind: 'none' })
      return
    }
    if (hit.kind === 'zone' || hit.kind === 'device' || hit.kind === 'incident') ui.select({ kind: hit.kind, id: hit.id })
    if (hit.kind === 'incident') ui.setIncidentOpen(true)
  }

  private hoverFrame = 0
  private updateHover(): void {
    if (!this.hoverPoint || this.drag?.moved) return
    if ((this.hoverFrame++ & 3) !== 0) return
    const hit = this.hitTest(this.hoverPoint)
    const cur = useUi.getState().hover
    if (!hit && !cur) return
    if (hit && cur && hit.kind === cur.kind && hit.id === cur.id && Math.abs(hit.x - cur.x) < 6 && Math.abs(hit.y - cur.y) < 6) return
    useUi.getState().setHover(hit)
    if (!this.app) return
    const ring = useDemoRing.getState()
    const booth = useBooth.getState()
    const editingRing = ring.editing && this.venue?.venueId === 'calhacks'
    const editingBooth = booth.editing && this.venue?.venueId === 'main-stage'
    let cursor = hit ? 'pointer' : 'grab'
    if ((editingRing || editingBooth) && this.hoverPoint) {
      const ground = unproject(this.cam, this.hoverPoint.x, this.hoverPoint.y)
      const pxPerM = this.cam.scale * Math.max(0.35, Math.cos(this.cam.tilt))
      const which = editingRing ? demoRingHandle(ground.x, ground.y, ring, pxPerM) : boothHandle(ground.x, ground.y, booth, pxPerM)
      if (which === 'move') cursor = 'move'
      else if (which === 'resize') cursor = 'ew-resize'
    }
    this.app.canvas.style.cursor = cursor
  }
}

/** Helper for label anchors: a fixed world point. */
export function fixedPoint(x: number, y: number, z = 0) {
  return () => ({ x, y, z })
}

