import ForceGraph3D, { type ForceGraph3DInstance } from '3d-force-graph'
import * as THREE from 'three'
import { color } from '@/lib/tokens'
import type { GraphLink } from '@/stdb/catalog'
import { adjacency, buildGraph, cluster, describe, end, named, neighbourhood, type Labels } from './graphModel'
import { BACKGROUND, FRESH, KIND_COLOURS, LINK_COLOURS, LINK_LENGTHS, NODE_VALS, SMALL, useGraphView, type GLink, type GNode, type Mode } from './graphView'

/**
 * The event graph in 3D, drawn the way the organizer portal drew it: people, booths and companies from the
 * live `event_graph` rows, laid out by force, coloured by kind, by memories or by company. A click flies to
 * a node, names everything it links to and dims the rest. A link that just arrived flashes.
 *
 * One drawing serves every visit to the page, so the layout survives a trip to another desk.
 */

/** A link that just arrived stays lit this long. */
const FRESH_MS = 6000
/** How often the engine checks for new rows, faded flashes and an idle camera. */
const TICK_MS = 1500
/** The layout takes new nodes at most this often; the old nodes then hold still while newcomers settle. */
const STRUCTURE_MS = 5000
const PIN_MS = 2500
const ROTATE_AFTER_MS = 15000
const TAG_LIMIT = 60
/** A node with more links than this is a hub; its links pull gently. */
const HUB = 20
const FONT = '"Geist Variable", ui-sans-serif, system-ui, sans-serif'
/** Dimmed nodes and links stay faintly visible so the lit ones are never hidden behind them. */
const DIM_NODE = 'rgba(58, 58, 66, 0.22)'
const DIM_LINK = 'rgba(58, 58, 66, 0.12)'

export interface EventGraph {
  attach(container: HTMLElement): void
  detach(): void
  setData(rows: GraphLink[], labels: Labels): void
  setMode(mode: Mode): void
  select(id: string | undefined): void
  fit(ms?: number): void
}

type Placed = GNode & { x: number; y: number; z: number }
type WithObject = GNode & { __threeObj?: THREE.Object3D }

let instance: EventGraph | undefined

/** The page's one drawing. Throws when the browser cannot start WebGL. */
export function eventGraph(): EventGraph {
  instance ??= create()
  return instance
}

/**
 * A line of text that always faces the camera, floating `lift` above its node. A `fixed` label keeps one
 * size on screen and draws over the spheres, so a selection stays readable however far the camera is.
 */
function textSprite(text: string, size: number, lift: number, fill: string, fixed = false): THREE.Sprite {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  const font = `600 40px ${FONT}`
  if (ctx) ctx.font = font
  canvas.width = Math.ceil(ctx?.measureText(text).width ?? text.length * 22) + 24
  canvas.height = 60
  if (ctx) {
    ctx.font = font
    ctx.textBaseline = 'middle'
    ctx.shadowColor = 'rgba(10, 10, 11, 0.95)'
    ctx.shadowBlur = 10
    ctx.fillStyle = fill
    ctx.fillText(text, 12, 31)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: !fixed, sizeAttenuation: !fixed })
  const sprite = new THREE.Sprite(material)
  sprite.userData.aspect = canvas.width / canvas.height
  sprite.scale.set(size * sprite.userData.aspect, size, 1)
  sprite.position.y = lift
  if (fixed) {
    sprite.center.set(0.5, 0)
    sprite.renderOrder = 10
  }
  return sprite
}

function dispose(sprite: THREE.Sprite) {
  sprite.parent?.remove(sprite)
  sprite.material.map?.dispose()
  sprite.material.dispose()
}

function create(): EventGraph {
  const host = document.createElement('div')
  host.style.position = 'absolute'
  host.style.inset = '0'

  let nodes = new Map<string, GNode>()
  let links = new Map<string, GLink>()
  let adjacent = new Map<string, GLink[]>()
  let rows: GraphLink[] = []
  let labels: Labels = { person: new Map(), booth: new Map(), company: new Map() }
  let dirty = false
  let lastStructure = 0
  let mode: Mode = 'kind'
  let groups = new Map<string, string>()
  let legend = useGraphView.getState().legend
  const groupColours = new Map<string, string>()
  let selected: GNode | undefined
  let near = new Set<string>()
  let lastTouch = 0
  /** The camera keeps the whole crowd in view while the layout settles, until someone turns, zooms or selects. */
  let framed = true
  let settling = false
  let lastFit = 0
  let attached = false
  let unpin: ReturnType<typeof setTimeout> | undefined
  let tags: THREE.Sprite[] = []
  const names = new Map<string, { label: string; sprite: THREE.Sprite }>()
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

  const fg = new ForceGraph3D(host, { controlType: 'orbit' }) as unknown as ForceGraph3DInstance<GNode, GLink>
  const controls = fg.controls() as { autoRotate: boolean; autoRotateSpeed: number }

  const touches = (link: GLink) => !!selected && (end(link.source) === selected.id || end(link.target) === selected.id)
  const fresh = (link: GLink, now: number) => link.born > 0 && now - link.born < FRESH_MS

  function nodeColour(n: GNode): string {
    if (selected && !near.has(n.id)) return DIM_NODE
    if (mode === 'kind') return KIND_COLOURS[n.kind]
    const group = groups.get(n.id)
    return (group && groupColours.get(group)) || (n.kind === 'person' ? SMALL : KIND_COLOURS[n.kind])
  }

  /** The sprite height that makes a fixed label's text `fontPx` tall on screen. */
  function box(fontPx: number) {
    const camera = fg.camera() as THREE.PerspectiveCamera
    return (fontPx * 1.5 * 2 * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, host.clientHeight || 700)
  }

  function fixedLabel(text: string, fontPx: number, lift: number, fill: string) {
    const sprite = textSprite(text, box(fontPx), lift, fill, true)
    sprite.userData.fontPx = fontPx
    return sprite
  }

  /** Keeps fixed labels at their size on screen after the view changes size. */
  function rescale() {
    for (const sprite of [...[...names.values()].map((held) => held.sprite), ...tags]) {
      const height = box(sprite.userData.fontPx as number)
      sprite.scale.set(height * (sprite.userData.aspect as number), height, 1)
    }
  }

  /** Company names float above their spheres at one size on screen; everything else is named on hover or when selected. */
  function nodeObject(n: GNode): THREE.Object3D {
    if (n.kind !== 'company') return null as unknown as THREE.Object3D
    let held = names.get(n.id)
    if (!held || held.label !== n.label) {
      if (held) dispose(held.sprite)
      held = { label: n.label, sprite: fixedLabel(n.label, 12, 4 * Math.cbrt(NODE_VALS.company) + 2, color.ink) }
      names.set(n.id, held)
    }
    return held.sprite
  }

  function tooltip(n: GNode): string {
    const summary = describe(n, adjacent, nodes)
    const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
    return `<b>${esc(summary.title)}</b><span>${esc(summary.eyebrow)}</span><span>${esc(summary.stats)}</span>`
  }

  /** Names the selected node and everything it links to, so a person shows the booths they stood at. */
  function tag() {
    for (const sprite of tags) dispose(sprite)
    tags = []
    if (!selected) return
    const ids = [selected.id, ...[...near].filter((id) => id !== selected?.id)].slice(0, TAG_LIMIT + 1)
    for (const id of ids) {
      const n = nodes.get(id) as WithObject | undefined
      // Companies carry their names already, and a row of placeholder names says nothing.
      if (!n?.__threeObj || n.kind === 'company' || (id !== selected.id && !named(n))) continue
      const radius = 4 * Math.cbrt(NODE_VALS[n.kind])
      const sprite =
        id === selected.id
          ? fixedLabel(n.label, 16, radius + 3, color.ink)
          : n.kind === 'booth'
            ? fixedLabel(n.label, 13, radius + 2, KIND_COLOURS.booth)
            : fixedLabel(n.label, 12, radius + 2, color.inkDim)
      n.__threeObj.add(sprite)
      tags.push(sprite)
    }
  }

  function restyle() {
    const now = performance.now()
    // A selection's links light up against the faded rest.
    fg.linkOpacity(selected ? 0.8 : 0.28)
      .nodeColor(nodeColour)
      .linkColor((link) => {
        if (selected) return touches(link) ? (LINK_COLOURS[link.kind] ?? FRESH) : DIM_LINK
        return fresh(link, now) ? FRESH : (LINK_COLOURS[link.kind] ?? color.inkMuted)
      })
      .linkWidth((link) => (fresh(link, now) ? 1.2 : touches(link) ? 0.8 : 0))
      .linkDirectionalParticles((link) => (!still && touches(link) ? 3 : 0))
    for (const [id, held] of names) held.sprite.material.opacity = !selected || near.has(id) ? 1 : 0.1
    tag()
  }

  function publish() {
    useGraphView.setState({
      mode,
      legend: mode === 'kind' ? [] : legend,
      selected: selected ? describe(selected, adjacent, nodes) : null,
      ready: nodes.size > 0,
    })
  }

  function regroup() {
    const result = cluster(mode, nodes, links, groupColours)
    groups = result.groups
    legend = result.legend
  }

  /** Points the camera at `placed` from where it already looks, close enough that radius `r` fills the view. */
  function aim(placed: Placed[], r: number, ms: number) {
    const c = { x: 0, y: 0, z: 0 }
    for (const n of placed) {
      c.x += n.x / placed.length
      c.y += n.y / placed.length
      c.z += n.z / placed.length
    }
    const camera = fg.camera() as THREE.PerspectiveCamera
    const half = ((Math.min(camera.fov, camera.fov * camera.aspect) / 2) * Math.PI) / 180
    const at = fg.cameraPosition()
    const dir = new THREE.Vector3(at.x - c.x, at.y - c.y, at.z - c.z)
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1)
    dir.normalize()
    const d = r / Math.sin(half)
    fg.cameraPosition({ x: c.x + dir.x * d, y: c.y + dir.y * d, z: c.z + dir.z * d }, c, still ? 0 : ms)
  }

  const placedOf = (ids: Iterable<string>) =>
    [...ids].map((id) => nodes.get(id)).filter((n): n is Placed => n?.x !== undefined && n.y !== undefined && n.z !== undefined)

  function fit(ms = 800) {
    const placed = placedOf(nodes.keys())
    if (!placed.length) return
    lastFit = performance.now()
    const c = placed.reduce((acc, n) => ({ x: acc.x + n.x / placed.length, y: acc.y + n.y / placed.length, z: acc.z + n.z / placed.length }), { x: 0, y: 0, z: 0 })
    // The few nodes furthest out may sit outside the view.
    const far = placed.map((n) => Math.hypot(n.x - c.x, n.y - c.y, n.z - c.z)).sort((a, b) => a - b)
    aim(placed, far[Math.floor(far.length * 0.95)] || 50, ms)
  }

  function select(n: GNode | undefined) {
    selected = n
    near = n ? neighbourhood(n.id, adjacent) : new Set()
    lastTouch = performance.now()
    controls.autoRotate = false
    if (n) {
      framed = false
      const placed = placedOf(near)
      if (placed.length) {
        const c = placed.reduce((acc, p) => ({ x: acc.x + p.x / placed.length, y: acc.y + p.y / placed.length, z: acc.z + p.z / placed.length }), { x: 0, y: 0, z: 0 })
        const r = Math.max(...placed.map((p) => Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z)))
        aim(placed, Math.max(28, r * 1.25 + 14), 1100)
      }
    }
    restyle()
    publish()
  }

  /** Takes the latest rows into the layout. */
  function apply() {
    const now = performance.now()
    const born = nodes.size ? now : 0
    const built = buildGraph(rows, labels, { nodes, links }, born)
    dirty = false
    if (!built.changed) {
      if (built.renamed) fg.nodeThreeObject((n) => nodeObject(n))
      publish()
      return
    }
    const old = nodes
    nodes = built.nodes
    links = built.links
    lastStructure = now
    settling = true
    adjacent = adjacency(links.values())
    if (selected && !nodes.has(selected.id)) selected = undefined
    near = selected ? neighbourhood(selected.id, adjacent) : new Set()
    // The old nodes hold still while the newcomers settle next to them.
    if (born) {
      for (const n of old.values()) if (nodes.has(n.id) && n.x !== undefined) Object.assign(n, { fx: n.x, fy: n.y, fz: n.z })
      clearTimeout(unpin)
      unpin = setTimeout(() => {
        for (const n of nodes.values()) n.fx = n.fy = n.fz = undefined
      }, PIN_MS)
    }
    for (const id of [...names.keys()]) {
      if (nodes.has(id)) continue
      const held = names.get(id)
      if (held) dispose(held.sprite)
      names.delete(id)
    }
    regroup()
    fg.graphData({ nodes: [...nodes.values()], links: [...links.values()] })
    restyle()
    publish()
    const arrived = [...links.values()].filter((link) => link.born === now)
    if (arrived.length && !still) setTimeout(() => arrived.slice(0, 300).forEach((link) => fg.emitParticle(link)), 400)
  }

  fg.backgroundColor(BACKGROUND)
    .showNavInfo(false)
    .nodeId('id')
    .nodeVal((n) => NODE_VALS[n.kind])
    .nodeRelSize(4)
    .nodeResolution(12)
    .nodeOpacity(0.95)
    .nodeLabel(tooltip)
    .nodeThreeObject((n) => nodeObject(n))
    .nodeThreeObjectExtend(true)
    .linkOpacity(0.28)
    .linkDirectionalParticleWidth(1.8)
    .linkDirectionalParticleSpeed(0.008)
    .linkDirectionalParticleColor((link) => LINK_COLOURS[link.kind] ?? FRESH)
    .d3AlphaDecay(0.03)
    .d3VelocityDecay(0.45)
    // The layout stops when it has cooled (about 230 ticks), not after a set time, so a hidden or slow tab
    // still spreads it out before the camera fits it.
    .d3AlphaMin(0.001)
    .cooldownTicks(300)
    .cooldownTime(Infinity)
    .onNodeClick((n) => select(n === selected ? undefined : n))
    .onBackgroundClick(() => select(undefined))
    .onEngineStop(() => {
      settling = false
      if (framed && !selected && nodes.size) fit()
    })
  type LinkForce = { distance(fn: (link: GLink) => number): LinkForce; strength(fn: (link: GLink) => number): LinkForce }
  const linkForce = fg.d3Force('link') as unknown as LinkForce | undefined
  const degree = (x: string | GNode) => adjacent.get(end(x))?.length ?? 1
  linkForce
    ?.distance((link) => LINK_LENGTHS[link.kind] ?? 30)
    // d3's usual pull, except that a hub (a demo band that walked every booth) pulls each link weakly, so it
    // cannot drag the whole floor into one knot.
    .strength((link) => {
      const most = Math.max(degree(link.source), degree(link.target))
      return 1 / (most > HUB ? most : Math.min(degree(link.source), degree(link.target)))
    })
  const charge = fg.d3Force('charge') as unknown as { strength(n: number): { distanceMax(n: number): void } } | undefined
  charge?.strength(-45).distanceMax(500)
  controls.autoRotate = !still
  controls.autoRotateSpeed = 0.5
  for (const type of ['pointerdown', 'wheel']) {
    host.addEventListener(type, () => {
      lastTouch = performance.now()
      framed = false
      controls.autoRotate = false
    })
  }
  new ResizeObserver(() => {
    if (!host.clientWidth) return
    fg.width(host.clientWidth).height(host.clientHeight)
    rescale()
  }).observe(host)
  fg.pauseAnimation()
  // Names drawn before Geist loaded used a fallback face; draw them again once it is in.
  document.fonts
    ?.load(`600 40px ${FONT}`)
    .then(() => {
      if (!names.size) return
      for (const held of names.values()) dispose(held.sprite)
      names.clear()
      fg.nodeThreeObject((n) => nodeObject(n))
    })
    .catch(() => {})

  window.setInterval(() => {
    if (!attached) return
    const now = performance.now()
    if (dirty && (!nodes.size || now - lastStructure >= STRUCTURE_MS)) apply()
    // A flash that just ran out goes back to its link's colour.
    if ([...links.values()].some((link) => link.born > 0 && now - link.born >= FRESH_MS && now - link.born < FRESH_MS + TICK_MS)) restyle()
    if (!selected && !still && now - lastTouch > ROTATE_AFTER_MS) controls.autoRotate = true
    // A layout still growing keeps the camera with it.
    if (settling && framed && !selected && now - lastFit > 4000) fit(1200)
  }, TICK_MS)

  return {
    attach(container) {
      container.append(host)
      attached = true
      if (host.clientWidth) {
        fg.width(host.clientWidth).height(host.clientHeight)
        rescale()
      }
      fg.resumeAnimation()
      publish()
    },
    detach() {
      attached = false
      host.remove()
      fg.pauseAnimation()
    },
    setData(next, nextLabels) {
      rows = next
      labels = nextLabels
      dirty = true
      // The first rows go in at once; later ones wait for the next tick.
      if (attached && !nodes.size) apply()
    },
    setMode(next) {
      mode = next
      regroup()
      restyle()
      publish()
    },
    select(id) {
      select(id ? nodes.get(id) : undefined)
    },
    fit(ms) {
      // Asking for the whole crowd hands the camera back to the layout.
      framed = true
      fit(ms)
    },
  }
}
