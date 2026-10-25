import { useEffect, useMemo, useRef } from 'react'
import { useCatalog, type GraphLink } from '@/stdb/catalog'
import { DeskFrame, Figure } from './DeskFrame'

const NODE: Record<string, string> = {
  person: '#85858b',
  booth: '#6fb7ad',
  company: '#dcc79f',
}

const LINK: Record<string, string> = {
  met: 'rgba(220,199,159,0.35)',
  visited: 'rgba(111,183,173,0.4)',
  works_at: 'rgba(207,208,212,0.28)',
  exhibits: 'rgba(184,166,255,0.45)',
}

const LINK_NAME: Record<string, string> = {
  met: 'Met',
  visited: 'Visited',
  works_at: 'Works at',
  exhibits: 'Exhibits',
}

interface Node {
  id: string
  kind: string
  label: string
  x: number
  y: number
}

function layout(links: GraphLink[], labelOf: (kind: string, id: string) => string): { nodes: Node[]; edges: { a: string; b: string; kind: string }[] } {
  const nodes = new Map<string, Node>()
  const edges: { a: string; b: string; kind: string }[] = []
  const ensure = (kind: string, id: string) => {
    const key = `${kind}:${id}`
    if (!nodes.has(key) && nodes.size < 160) {
      const angle = nodes.size * 2.399
      nodes.set(key, { id: key, kind, label: labelOf(kind, id), x: Math.cos(angle) * 80, y: Math.sin(angle) * 80 })
    }
    return nodes.has(key) ? key : ''
  }
  for (const link of links) {
    const from = ensure(link.fromKind, link.fromId)
    const to = ensure(link.toKind, link.toId)
    if (from && to) edges.push({ a: from, b: to, kind: link.kind })
  }
  const list = [...nodes.values()]
  for (let step = 0; step < 70; step++) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]
        const b = list[j]
        let dx = a.x - b.x
        let dy = a.y - b.y
        const dist = Math.max(8, Math.hypot(dx, dy))
        const force = 420 / (dist * dist)
        dx /= dist
        dy /= dist
        a.x += dx * force
        a.y += dy * force
        b.x -= dx * force
        b.y -= dy * force
      }
    }
    for (const edge of edges) {
      const a = nodes.get(edge.a)
      const b = nodes.get(edge.b)
      if (!a || !b) continue
      const dx = b.x - a.x
      const dy = b.y - a.y
      a.x += dx * 0.012
      a.y += dy * 0.012
      b.x -= dx * 0.012
      b.y -= dy * 0.012
    }
    for (const node of list) {
      node.x *= 0.96
      node.y *= 0.96
    }
  }
  return { nodes: list, edges }
}

/** People stay unnamed. Booths and companies keep their names. */
export function GraphPage() {
  const links = useCatalog((s) => s.links)
  const linkCount = useCatalog((s) => s.linkCount)
  const booths = useCatalog((s) => s.booths)
  const companies = useCatalog((s) => s.companies)
  const canvas = useRef<HTMLCanvasElement>(null)
  const names = useMemo(() => {
    const booth = new Map(booths.map((item) => [item.id, item.name]))
    const company = new Map(companies.map((item) => [item.id, item.name]))
    return (kind: string, id: string) => (kind === 'booth' ? booth.get(id) : kind === 'company' ? company.get(id) : '') ?? ''
  }, [booths, companies])
  const graph = useMemo(() => layout(links, names), [links, names])
  const counts = {
    person: graph.nodes.filter((node) => node.kind === 'person').length,
    booth: graph.nodes.filter((node) => node.kind === 'booth').length,
    company: graph.nodes.filter((node) => node.kind === 'company').length,
  }

  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const draw = () => {
      const rect = el.getBoundingClientRect()
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      el.width = Math.max(1, Math.floor(rect.width * dpr))
      el.height = Math.max(1, Math.floor(rect.height * dpr))
      const ctx = el.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, rect.width, rect.height)
      if (graph.nodes.length === 0) return
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const node of graph.nodes) {
        minX = Math.min(minX, node.x)
        minY = Math.min(minY, node.y)
        maxX = Math.max(maxX, node.x)
        maxY = Math.max(maxY, node.y)
      }
      const span = Math.max(40, maxX - minX, maxY - minY)
      const scale = (Math.min(rect.width, rect.height) - 80) / span
      const cx = rect.width / 2
      const cy = rect.height / 2
      const midX = (minX + maxX) / 2
      const midY = (minY + maxY) / 2
      const at = (node: Node) => ({ x: cx + (node.x - midX) * scale, y: cy + (node.y - midY) * scale })
      const byId = new Map(graph.nodes.map((node) => [node.id, node]))
      for (const edge of graph.edges) {
        const a = byId.get(edge.a)
        const b = byId.get(edge.b)
        if (!a || !b) continue
        const pa = at(a)
        const pb = at(b)
        ctx.strokeStyle = LINK[edge.kind] ?? 'rgba(207,208,212,0.2)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(pa.x, pa.y)
        ctx.lineTo(pb.x, pb.y)
        ctx.stroke()
      }
      ctx.font = '13px "Instrument Serif", Georgia, serif'
      ctx.textAlign = 'center'
      const labeled: { x: number; y: number }[] = []
      for (const node of graph.nodes) {
        const p = at(node)
        const r = node.kind === 'company' ? 5 : node.kind === 'booth' ? 3.5 : 2
        ctx.fillStyle = NODE[node.kind] ?? '#85858b'
        ctx.beginPath()
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
        ctx.fill()
        if (!node.label) continue
        const y = p.y - r - 6
        if (labeled.some((mark) => Math.hypot(mark.x - p.x, mark.y - y) < 36)) continue
        labeled.push({ x: p.x, y })
        ctx.fillStyle = '#ecebe6'
        ctx.fillText(node.label, p.x, y)
      }
    }
    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(el)
    return () => observer.disconnect()
  }, [graph])

  return (
    <DeskFrame
      title={linkCount ? 'Who met, and where they stood.' : 'The event graph is empty.'}
      sentence="People stay anonymous on this screen. Booths and companies keep their names. A line is a meeting, a visit, a job, or a booth."
      figures={
        <>
          <Figure lead label="Links" value={linkCount.toLocaleString('en-US')} note={linkCount > links.length ? `${links.length.toLocaleString('en-US')} drawn` : 'in the graph'} />
          <Figure label="People" value={String(counts.person)} note="unnamed dots" />
          <Figure label="Booths" value={String(counts.booth)} note="named" />
          <Figure label="Companies" value={String(counts.company)} note="named" />
        </>
      }
    >
      <div className="mb-4 flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-ink-dim">
        {Object.entries(NODE).map(([kind, color]) => (
          <span key={kind} className="inline-flex items-center gap-2 capitalize">
            <i aria-hidden className="inline-block size-1.5 rounded-full" style={{ background: color }} />
            {kind}
          </span>
        ))}
        {Object.entries(LINK_NAME).map(([kind, label]) => (
          <span key={kind} className="inline-flex items-center gap-2">
            <i aria-hidden className="inline-block h-px w-3" style={{ background: LINK[kind] }} />
            {label}
          </span>
        ))}
      </div>
      <canvas ref={canvas} className="h-[560px] w-full" />
      {linkCount === 0 && <p className="text-[15px] text-ink-dim">The graph has not arrived from the live host yet.</p>}
    </DeskFrame>
  )
}
