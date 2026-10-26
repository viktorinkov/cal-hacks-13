// The portal's 3D hall under the desk: the same WebGL view, crowd, incident pins and zone
// circles the old organizer page ran, mounted once and wired to the live connection.

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { liveConnection, useSession } from '@/stdb/session'
import { useUi } from '@/stores/ui'
import { venueView, suspendVenue, type LiveView } from './venue-view'
import { Crowd, isDown } from './crowd-3d'
import { Incidents } from './incidents-3d'
import { ZoneCircles, zoneWords, type ZoneCircle } from './zones-3d'
import { h, money } from './dom'
import { bandCode } from '@/lib/bandCode'
import type { DbConnection } from '@/stdb/module_bindings'
import type { Band, IncidentMarker, LiveRun } from '@/stdb/module_bindings/types'

/** A click moves the pointer less than this; more is a drag of the camera. */
const CLICK_PX = 5
/** An incident is picked this far off the pointer's ray per metre from the camera, as a person is. */
const PICK_RADIANS = 0.006
const LIGHTS = ['Calm around them', 'Busy around them', 'Very busy around them']
/** Tables the view reads beyond the floor subscription, each asked for on its own. */
const VIEW_QUERIES = [
  'SELECT * FROM crowd_walk',
  'SELECT * FROM live_pause',
  'SELECT * FROM live_run',
  'SELECT * FROM incident_marker',
  'SELECT * FROM band_place',
  'SELECT * FROM venue_spot',
  'SELECT * FROM venue_setup',
  'SELECT * FROM chosen_venue',
]

let conn: DbConnection | null = null
let v: LiveView | undefined
let crowd: Crowd | undefined
let incidentPins: Incidents | undefined
let zones: ZoneCircles | undefined
let tip: HTMLElement | undefined
let listenersOn = false

/** A dark ring on the floor under the opened person. */
const mark = new THREE.Mesh(
  new THREE.RingGeometry(0.8, 1.15, 40).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: '#111111', side: THREE.DoubleSide, depthWrite: false }),
)

function run(): LiveRun | undefined {
  return conn?.db.liveRun.id.find(0) ?? undefined
}

/** This run's incidents. */
function markers(r: LiveRun | undefined): IncidentMarker[] {
  if (!conn || !r) return []
  return [...conn.db.incidentMarker.iter()].filter((m) => m.openedAt.microsSinceUnixEpoch >= r.startedAt.microsSinceUnixEpoch)
}

/** The incident on the floor whose ring the ray passes, or a few pixels from it when it is far away. */
function incidentAt(ray: THREE.Ray): IncidentMarker | undefined {
  const at = new THREE.Vector3()
  let best: IncidentMarker | undefined
  let score = 1
  for (const m of incidentPins?.shown() ?? []) {
    at.set(m.xM, 1, m.yM)
    const along = at.clone().sub(ray.origin).dot(ray.direction)
    if (along <= 0) continue
    const reach = Math.max(2.5, along * PICK_RADIANS)
    const off = ray.distanceSqToPoint(at) / (reach * reach)
    if (off < score) {
      score = off
      best = m
    }
  }
  return best
}

function capital(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s
}

function personWords(b: Band): [string, string[]] {
  const a = conn ? [...conn.db.boardAttendees.iter()].find((x) => x.bandId === b.id) : undefined
  const light = b.fall ? 'Fell' : isDown(b) ? 'Pressed SOS' : b.state === 4 ? 'In the light circle around someone down' : LIGHTS[Math.min(b.state, 2)]
  return [
    a ? a.displayName || 'Unnamed' : `Band ${bandCode(b.id)}`,
    [`${a ? `${capital(a.role)}, band` : 'Band'} ${bandCode(b.id)}${a?.organization ? `, ${a.organization}` : ''}`, `${light}.`],
  ]
}

function incidentWords(m: IncidentMarker): [string, string[]] {
  return [
    `Incident ${m.incidentId}: ${m.kind}`,
    [
      'Click to open it.',
      [m.person, m.place && `at ${m.place}`].filter(Boolean).join(' '),
      m.status === 'responding' && m.medic ? `${m.medic} responding` : m.status,
      m.claimId ? `Claim: ${m.claimStatus}${m.payoutCents && m.claimStatus !== 'refused' ? `, ${money(m.payoutCents)}` : ''}` : '',
    ].filter(Boolean),
  ]
}

/** What is under the pointer, nearest first: a person, an incident's ring, then a zone's circle. */
function hover(e: PointerEvent) {
  if (!v || !crowd || !tip) return
  tip.hidden = true
  v.canvas.style.cursor = ''
  if (e.buttons) return zones?.hover(undefined)
  const ray = v.rayAt(e)
  const b = crowd.pick(ray)
  const incident = b ? undefined : incidentAt(ray)
  const floor = ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3())
  const circle: ZoneCircle | undefined = b || incident || !floor ? undefined : zones?.at(floor.x, floor.z)
  zones?.hover(circle)
  const [title, lines] = b ? personWords(b) : incident ? incidentWords(incident) : circle && conn ? zoneWords(conn, circle) : ['', []]
  if (!title) return
  if (b) v.canvas.style.cursor = 'pointer'
  tip.replaceChildren(h('b', {}, title), ...lines.map((l) => h('div', {}, l)))
  tip.hidden = false
  const r = v.view.getBoundingClientRect()
  const x = e.clientX - r.left
  const y = e.clientY - r.top
  tip.style.left = `${x + 14 + tip.offsetWidth > r.width ? Math.max(0, x - 14 - tip.offsetWidth) : x + 14}px`
  tip.style.top = `${y + 14 + tip.offsetHeight > r.height ? Math.max(0, y - 14 - tip.offsetHeight) : y + 14}px`
}

/** A person clicked: their panel opens and the camera flies to them. An incident's ring opens it too. */
function openBand(b: Band) {
  if (!v || !crowd) return
  if (tip) tip.hidden = true
  useUi.getState().select({ kind: 'device', id: `band-${b.id}` })
  const at = crowd.where(b.id) ?? { x: b.xM, z: b.yM }
  v.lookAt(at.x, at.z)
}

function openIncident(m: IncidentMarker) {
  if (!v) return
  if (tip) tip.hidden = true
  useUi.getState().select({ kind: 'incident', id: String(m.incidentId) })
  v.lookAt(m.xM, m.yM)
}

function setUp(c: DbConnection) {
  const view = venueView(c)
  if (conn === c) return
  conn = c
  v = view
  crowd = new Crowd(view.layer)
  for (const b of c.db.band.iter()) crowd.upsert(b)
  c.db.band.onInsert((_ctx, b) => crowd?.upsert(b))
  c.db.band.onUpdate((_ctx, _old, b) => crowd?.upsert(b))
  c.db.band.onDelete((_ctx, b) => crowd?.remove(b.id))
  // Each table the portal view reads is asked for on its own, so one refusal leaves the rest working.
  for (const query of VIEW_QUERIES) {
    c.subscriptionBuilder()
      .onError(() => console.warn('[portal3d] query refused', query))
      .subscribe(query)
  }
  c.db.crowdWalk.onInsert((_ctx, w) => crowd?.walk(w))
  c.db.crowdWalk.onUpdate((_ctx, _old, w) => crowd?.walk(w))
  c.db.crowdWalk.onDelete((_ctx, w) => crowd?.unwalk(w.bandId))
  const pause = () => crowd?.setPaused(conn?.db.livePause.id.find(0)?.pausedAt.toDate().getTime())
  c.db.livePause.onInsert(pause)
  c.db.livePause.onDelete(pause)
  pause()
  incidentPins = new Incidents(view, () => crowd?.moduleNow() ?? Date.now())
  const sync = () => incidentPins?.sync(markers(run()))
  for (const t of [c.db.incidentMarker, c.db.liveRun]) {
    t.onInsert(sync)
    t.onUpdate(sync)
    t.onDelete(sync)
  }
  sync()
  zones = new ZoneCircles(view.layer)
  mark.renderOrder = 3
  view.layer.add(mark)
  tip = h('div', {
    style:
      'position:absolute;z-index:20;pointer-events:none;max-width:260px;padding:8px 10px;border-radius:6px;background:rgba(12,12,14,0.92);color:#f4f4f2;font-size:12px;line-height:1.4;box-shadow:0 4px 14px rgba(0,0,0,0.4)',
    hidden: true,
  })
  view.view.append(tip)
  view.onFrame((now) => {
    crowd?.frame(now)
    incidentPins?.frame(now)
    if (conn && crowd) {
      const ours = crowd.ours()
      view.names.setBands(ours.map((b) => ({ ...b, name: conn!.db.bandPlace.bandId.find(b.id)?.label ?? '', code: bandCode(b.id) })))
    }
    if (conn) zones?.update(conn, now)
    const selection = useUi.getState().selection
    const at = selection.kind === 'device' && /^band-\d+$/.test(selection.id) ? crowd?.where(Number(selection.id.slice(5))) : undefined
    mark.visible = !!at
    if (at) mark.position.set(at.x, 0.06, at.z)
  })
  if (listenersOn) return
  listenersOn = true
  let down: { x: number; y: number } | undefined
  view.canvas.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY }
  })
  view.canvas.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_PX) return
    const ray = v?.rayAt(e)
    if (!ray) return
    const b = crowd?.pick(ray)
    if (b) return openBand(b)
    const incident = incidentAt(ray)
    if (incident) openIncident(incident)
  })
  let moved: PointerEvent | undefined
  view.canvas.addEventListener('pointermove', (e) => {
    if (!moved) requestAnimationFrame(() => {
      if (moved) hover(moved)
      moved = undefined
    })
    moved = e
  })
  view.canvas.addEventListener('pointerleave', () => {
    if (tip) tip.hidden = true
    zones?.hover(undefined)
  })
}

/** The portal's venue view fills the map pane; the desk's panels float over it. */
export function PortalVenue() {
  const box = useRef<HTMLDivElement>(null)
  const live = useSession((s) => s.phase === 'live')
  const me = useSession((s) => s.me)

  useEffect(() => {
    if (!live || !box.current) return
    const c = liveConnection()
    if (!c) return
    setUp(c)
    if (v && v.view.parentElement !== box.current) box.current.append(v.view)
    return () => {
      suspendVenue()
      v?.view.remove()
    }
  }, [live, me])

  return <div ref={box} className="absolute inset-0" aria-label="Venue map" />
}
