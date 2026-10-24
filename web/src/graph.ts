// The event graph for the big screen: the anonymous `event_graph` view drawn with Sigma.js. People stay
// anonymous; booths and companies carry their names. Rows arrive live from the subscription, and the
// ForceAtlas2 layout runs in a web worker for a few seconds after each new node or link.

import Graph from 'graphology';
import FA2Layout from 'graphology-layout-forceatlas2/worker';
import Sigma from 'sigma';
import { h } from './lib';
import type { DbConnection } from './module_bindings';
import type { EventLink } from './module_bindings/types';

const NODE_COLOURS: Record<string, string> = { person: '#888', booth: '#4c8dff', company: '#f5a623' };
const NODE_SIZES: Record<string, number> = { person: 4, booth: 7, company: 11 };
const LINK_COLOURS: Record<string, string> = { met: '#ff5c8a', visited: '#9bbcff', works_at: '#3ecf8e', exhibits: '#f5c26b' };
const LINK_NAMES: Record<string, string> = { met: 'met (minutes together)', visited: 'visited booth', works_at: 'works at', exhibits: 'exhibits' };
const LAYOUT_MS = 8000;

let graph: Graph | undefined;
let box: HTMLElement;
let layout: FA2Layout | undefined;
let layoutStop: ReturnType<typeof setTimeout> | undefined;

function label(conn: DbConnection, kind: string, id: bigint): string {
  if (kind === 'booth') return conn.db.booth.id.find(id)?.name ?? 'booth';
  if (kind === 'company') return conn.db.organization.id.find(id)?.name ?? 'company';
  return '';
}

function addNode(conn: DbConnection, g: Graph, kind: string, id: bigint, near?: string) {
  const key = `${kind}:${id}`;
  if (g.hasNode(key)) return key;
  // A new node starts next to the node it links to, so the layout does not jump.
  const at = near && g.hasNode(near) ? g.getNodeAttributes(near) : { x: 0, y: 0 };
  g.addNode(key, {
    x: at.x + Math.random() * 10 - 5, y: at.y + Math.random() * 10 - 5,
    size: NODE_SIZES[kind] ?? 4, color: NODE_COLOURS[kind] ?? '#888', label: label(conn, kind, id), kind,
  });
  return key;
}

function addLink(conn: DbConnection, g: Graph, l: EventLink) {
  const key = String(l.id);
  const attrs = { color: LINK_COLOURS[l.kind] ?? '#ccc', size: 0.5 + Math.log2(1 + l.weight) / 2, weight: Math.log2(2 + l.weight), kind: l.kind };
  if (g.hasEdge(key)) return g.mergeEdgeAttributes(key, attrs);
  const to = `${l.toKind}:${l.toId}`;
  const from = addNode(conn, g, l.fromKind, l.fromId, to);
  addNode(conn, g, l.toKind, l.toId, from);
  if (!g.hasEdge(from, to)) g.addEdgeWithKey(key, from, to, attrs);
}

function dropLink(g: Graph, l: EventLink) {
  const key = String(l.id);
  if (!g.hasEdge(key)) return;
  const ends = g.extremities(key);
  g.dropEdge(key);
  for (const n of ends) if (g.degree(n) === 0) g.dropNode(n);
}

/** Runs the layout for a few seconds after the graph changed. */
function settle(g: Graph) {
  if (!g.order) return;
  layout ??= new FA2Layout(g, { settings: { gravity: 1, scalingRatio: 8, slowDown: 6, barnesHutOptimize: g.order > 500 } });
  layout.start();
  clearTimeout(layoutStop);
  layoutStop = setTimeout(() => layout?.stop(), LAYOUT_MS);
}

function setup(conn: DbConnection) {
  const g = new Graph({ type: 'undirected' });
  for (const l of conn.db.eventGraph.iter()) addLink(conn, g, l);
  box = h('div', { class: 'graph' });
  const sigma = new Sigma(g, box, { allowInvalidContainer: true, labelRenderedSizeThreshold: 6, zIndex: true });
  new ResizeObserver(() => sigma.resize()).observe(box);
  conn.db.eventGraph.onInsert((_ctx, l) => { addLink(conn, g, l); settle(g); });
  conn.db.eventGraph.onUpdate((_ctx, _old, l) => addLink(conn, g, l));
  conn.db.eventGraph.onDelete((_ctx, l) => { dropLink(g, l); settle(g); });
  graph = g;
  settle(g);
}

/** The Event graph tab. The drawing keeps its element across the portal's redraws. */
export function graphTab(conn: DbConnection) {
  if (!graph) setup(conn);
  const g = graph!;
  const count = (kind: string) => g.filterNodes((_n, a) => a.kind === kind).length;
  return h('section', {},
    h('h3', {}, 'Event graph'),
    h('p', { class: 'muted' }, `Live from SpacetimeDB: ${count('person')} people, ${count('booth')} booths, ${count('company')} companies, ${g.size} links. People are anonymous on this screen.`),
    h('p', { class: 'legend' },
      Object.entries(NODE_COLOURS).map(([kind, c]) => h('span', {}, h('i', { class: 'dot', style: `background:${c}` }), kind)),
      Object.entries(LINK_COLOURS).map(([kind, c]) => h('span', {}, h('i', { style: `background:${c}` }), LINK_NAMES[kind]))),
    box);
}
