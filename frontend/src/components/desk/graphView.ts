import { create } from 'zustand'
import { color } from '@/lib/tokens'

/**
 * The event graph's shapes, colours and on-screen state. The page reads this module directly; the
 * 3D engine and its layout code load later, on their own.
 */

export type Kind = 'person' | 'booth' | 'company'
export type Mode = 'kind' | 'memories' | 'company'

export interface GNode {
  id: string
  kind: Kind
  label: string
  /** performance.now() when the node arrived; 0 for everything in the first load. */
  born: number
  x?: number
  y?: number
  z?: number
  fx?: number
  fy?: number
  fz?: number
}

export interface GLink {
  id: string
  kind: string
  source: string | GNode
  target: string | GNode
  weight: number
  born: number
}

export const KIND_COLOURS: Record<Kind, string> = { person: color.inkDim, booth: '#7fb2ff', company: color.aside }
export const KIND_NAMES: Record<Kind, string> = { person: 'Person', booth: 'Booth', company: 'Company' }
/** Sphere volume by kind: a company reads from across the room, a person is a speck. */
export const NODE_VALS: Record<Kind, number> = { person: 1, booth: 6, company: 16 }

export const LINK_COLOURS: Record<string, string> = {
  met: color.sectionFood,
  visited: '#7fb2ff',
  works_at: color.sectionWing,
  exhibits: color.sectionPlaza,
}
export const LINK_NAMES: Record<string, string> = {
  met: 'Met (minutes together)',
  visited: 'Visited a booth',
  works_at: 'Works at',
  exhibits: 'Exhibits',
}
/** Rest lengths for the layout: people who met sit close, a booth visit reaches further. */
export const LINK_LENGTHS: Record<string, number> = { met: 14, visited: 34, works_at: 26, exhibits: 20 }

/** Colours for the biggest clusters, in order; smaller clusters stay grey. */
export const PALETTE = [
  color.sectionFood,
  color.sectionWing,
  color.sectionPlaza,
  '#7fb2ff',
  color.sectionConcourse,
  color.sectionFront,
  color.teal,
  color.aside,
  color.green,
  color.champagne,
]
export const SMALL = color.grey
export const FRESH = color.ink
export const BACKGROUND = color.panel

export interface SummaryItem {
  id: string
  kind: Kind
  label: string
  note: string
}

export interface SummarySection {
  title: string
  items: SummaryItem[]
  more: number
}

/** What a node is and what it links to, for the hover label and the card. */
export interface Summary {
  id: string
  kind: Kind
  title: string
  eyebrow: string
  stats: string
  sections: SummarySection[]
}

export interface LegendLine {
  colour: string
  label: string
}

interface GraphViewState {
  mode: Mode
  /** Cluster colours in the memories and company modes; empty in the kind mode. */
  legend: LegendLine[]
  selected: Summary | null
  ready: boolean
}

export const useGraphView = create<GraphViewState>(() => ({ mode: 'kind', legend: [], selected: null, ready: false }))
