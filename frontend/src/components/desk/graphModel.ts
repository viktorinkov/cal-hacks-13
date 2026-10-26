import Graph from 'graphology'
import louvain from 'graphology-communities-louvain'
import type { GraphLink } from '@/stdb/catalog'
import { KIND_NAMES, NODE_VALS, PALETTE, SMALL, type GLink, type GNode, type Kind, type LegendLine, type Mode, type Summary, type SummaryItem, type SummarySection } from './graphView'

/** Names by node id, one map per kind. A person keeps whatever name the page gave them. */
export interface Labels {
  person: Map<string, string>
  booth: Map<string, string>
  company: Map<string, string>
}

const UNNAMED: Record<Kind, string> = { person: 'Unnamed attendee', booth: 'Booth', company: 'Company' }
const LIST = 8

export const end = (x: string | GNode) => (typeof x === 'string' ? x : x.id)
export const other = (link: GLink, id: string) => (end(link.source) === id ? end(link.target) : end(link.source))
const isKind = (kind: string): kind is Kind => kind in NODE_VALS
const jitter = () => Math.random() * 10 - 5

export function labelOf(labels: Labels, kind: Kind, id: string): string {
  return labels[kind].get(id) || UNNAMED[kind]
}

/** Whether the node has a real name rather than its kind's placeholder. */
export const named = (n: GNode) => n.label !== UNNAMED[n.kind]

export interface Built {
  nodes: Map<string, GNode>
  links: Map<string, GLink>
  /** A node or link came or went. A rename alone does not count. */
  changed: boolean
  /** A name changed, so its floating label needs drawing again. */
  renamed: boolean
}

/**
 * Turns the link rows into nodes and links. Nodes and links already on screen keep their objects, so
 * they keep their positions; a new node starts next to the node it links to, so the layout does not jump.
 */
export function buildGraph(rows: GraphLink[], labels: Labels, prev: Pick<Built, 'nodes' | 'links'>, born: number): Built {
  const nodes = new Map<string, GNode>()
  const links = new Map<string, GLink>()
  let renamed = false
  const node = (kind: Kind, id: string, nearKey?: string) => {
    const key = `${kind}:${id}`
    let n = nodes.get(key) ?? prev.nodes.get(key)
    if (!n) {
      const at = nearKey ? (nodes.get(nearKey) ?? prev.nodes.get(nearKey)) : undefined
      n = { id: key, kind, label: labelOf(labels, kind, id), born }
      if (at?.x !== undefined) Object.assign(n, { x: at.x + jitter(), y: (at.y ?? 0) + jitter(), z: (at.z ?? 0) + jitter() })
    }
    // A name can arrive after the node's first link.
    const label = labelOf(labels, kind, id)
    if (n.label !== label) {
      renamed = true
      n.label = label
    }
    nodes.set(key, n)
    return key
  }
  for (const row of rows) {
    if (!isKind(row.fromKind) || !isKind(row.toKind)) continue
    const to = `${row.toKind}:${row.toId}`
    const from = node(row.fromKind, row.fromId, to)
    node(row.toKind, row.toId, from)
    const link = prev.links.get(row.id) ?? { id: row.id, kind: row.kind, source: from, target: to, weight: row.weight, born }
    link.weight = row.weight
    links.set(row.id, link)
  }
  const changed =
    nodes.size !== prev.nodes.size ||
    links.size !== prev.links.size ||
    [...links.keys()].some((key) => !prev.links.has(key)) ||
    [...nodes.keys()].some((key) => !prev.nodes.has(key))
  return { nodes, links, changed, renamed }
}

export function adjacency(links: Iterable<GLink>): Map<string, GLink[]> {
  const out = new Map<string, GLink[]>()
  for (const link of links) {
    for (const id of [end(link.source), end(link.target)]) {
      const list = out.get(id)
      if (list) list.push(link)
      else out.set(id, [link])
    }
  }
  return out
}

/** The node and everything one link away. */
export function neighbourhood(id: string, adjacent: Map<string, GLink[]>): Set<string> {
  return new Set([id, ...(adjacent.get(id) ?? []).map((link) => other(link, id))])
}

/** A fixed random generator, so the same links give the same clusters each time. */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface Clusters {
  /** The cluster each node belongs to, by node id. */
  groups: Map<string, string>
  legend: LegendLine[]
}

/**
 * Groups the nodes for a colour mode. Memories are communities over time together and booth visits, each
 * named after the booth its people spent the most minutes at; company groups follow who works or exhibits
 * where. The biggest groups get a colour that stays with them in `colours` across calls.
 */
export function cluster(mode: Mode, nodes: Map<string, GNode>, links: Map<string, GLink>, colours: Map<string, string>): Clusters {
  const groups = new Map<string, string>()
  const named = new Map<string, string>()
  if (mode === 'company') {
    for (const link of links.values()) if (link.kind === 'works_at' || link.kind === 'exhibits') groups.set(end(link.source), end(link.target))
    for (const n of nodes.values()) {
      if (n.kind !== 'company') continue
      groups.set(n.id, n.id)
      named.set(n.id, n.label)
    }
  } else if (mode === 'memories') {
    const g = new Graph({ type: 'undirected' })
    for (const link of links.values()) {
      if (link.kind !== 'met' && link.kind !== 'visited') continue
      const a = end(link.source)
      const b = end(link.target)
      if (a === b) continue
      g.mergeNode(a)
      g.mergeNode(b)
      g.updateEdge(a, b, (attr) => ({ weight: ((attr.weight as number | undefined) ?? 0) + Math.max(1, link.weight) }))
    }
    if (g.size) {
      const parts = louvain(g, { getEdgeWeight: 'weight', rng: seeded(13) })
      const best = new Map<number, [string, number]>()
      for (const link of links.values()) {
        if (link.kind !== 'visited') continue
        const booth = end(link.target)
        const part = parts[end(link.source)]
        if (part !== parts[booth]) continue
        const held = best.get(part)
        if (!held || link.weight > held[1]) best.set(part, [booth, link.weight])
      }
      for (const [id, part] of Object.entries(parts)) {
        const anchor = best.get(part)?.[0] ?? `group:${part}`
        groups.set(id, anchor)
        if (!named.has(anchor)) {
          const booth = nodes.get(anchor)
          named.set(anchor, booth ? `Around ${booth.label}` : 'A group')
        }
      }
    }
  }
  const people = new Map<string, number>()
  for (const [id, group] of groups) if (id.startsWith('person:')) people.set(group, (people.get(group) ?? 0) + 1)
  const ranked = [...people.entries()].sort((a, b) => b[1] - a[1]).slice(0, PALETTE.length)
  const keep = new Set(ranked.map(([group]) => group))
  for (const group of [...colours.keys()]) if (!keep.has(group)) colours.delete(group)
  for (const [group] of ranked) {
    if (colours.has(group)) continue
    const used = new Set(colours.values())
    colours.set(group, PALETTE.find((c) => !used.has(c)) ?? SMALL)
  }
  const legend = ranked.map(([group, count]) => ({
    colour: colours.get(group) ?? SMALL,
    label: `${named.get(group) ?? 'A group'} · ${count} ${count === 1 ? 'person' : 'people'}`,
  }))
  return { groups, legend }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** What a node is and what it links to: who a person met and which booths they stood at. */
export function describe(n: GNode, adjacent: Map<string, GLink[]>, nodes: Map<string, GNode>): Summary {
  const mine = adjacent.get(n.id) ?? []
  const of = (kind: string) => mine.filter((link) => link.kind === kind)
  const section = (title: string, list: GLink[], minutes: boolean): SummarySection => {
    const items: SummaryItem[] = [...list]
      .sort((a, b) => b.weight - a.weight)
      .flatMap((link) => {
        const target = nodes.get(other(link, n.id))
        if (!target) return []
        return [{ id: target.id, kind: target.kind, label: target.label, note: minutes && link.weight > 0 ? `${Math.round(link.weight)} min` : '' }]
      })
    return { title, items: items.slice(0, LIST), more: Math.max(0, items.length - LIST) }
  }
  const met = of('met')
  const visited = of('visited')
  const works = of('works_at')
  const exhibits = of('exhibits')
  const summary = { id: n.id, kind: n.kind, title: n.label }
  if (n.kind === 'person') {
    const employer = works.map((link) => nodes.get(other(link, n.id))?.label).find(Boolean)
    return {
      ...summary,
      eyebrow: employer ? `Person · ${employer}` : KIND_NAMES.person,
      stats: `Met ${plural(met.length, 'person', 'people')} · visited ${plural(visited.length, 'booth', 'booths')}`,
      sections: [section('Booths visited', visited, true), section('Met', met, true)].filter((s) => s.items.length),
    }
  }
  if (n.kind === 'booth') {
    return {
      ...summary,
      eyebrow: KIND_NAMES.booth,
      stats: plural(visited.length, 'visitor', 'visitors'),
      sections: [section('Exhibited by', exhibits, false), section('Visitors', visited, true)].filter((s) => s.items.length),
    }
  }
  return {
    ...summary,
    eyebrow: KIND_NAMES.company,
    stats: `${plural(works.length, 'person works', 'people work')} here · ${plural(exhibits.length, 'booth', 'booths')}`,
    sections: [section('Booths', exhibits, false), section('People', works, false)].filter((s) => s.items.length),
  }
}
