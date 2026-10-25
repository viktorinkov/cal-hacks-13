import { create } from 'zustand'

export type LayerKey =
  | 'grid'
  | 'structures'
  | 'zones'
  | 'heatmap'
  | 'flow'
  | 'people'
  | 'trails'
  | 'bands'
  | 'incidents'
  | 'routes'
  | 'cameras'
  | 'labels'
  | 'baseline'

export const LAYERS: { key: LayerKey; label: string; hint: string }[] = [
  { key: 'people', label: 'People', hint: 'Simulated attendees' },
  { key: 'trails', label: 'Movement trails', hint: 'Where people walked in the last few seconds' },
  { key: 'heatmap', label: 'Density', hint: 'Reddish amber where people mass, columns where packed' },
  { key: 'zones', label: 'Zone status', hint: 'Caution and critical zones outlined' },
  { key: 'flow', label: 'Flow arrows', hint: 'Average walking direction' },
  { key: 'bands', label: 'Bands', hint: 'Physical wristbands with a known position' },
  { key: 'incidents', label: 'Incidents', hint: 'SOS and fall markers' },
  { key: 'routes', label: 'Responder corridors', hint: 'Preapproved paths for First Aid' },
  { key: 'cameras', label: 'Camera coverage', hint: 'What each camera can see' },
  { key: 'structures', label: 'Structures', hint: 'Stage, towers, tents and walls in 3D' },
  { key: 'grid', label: 'Floor grid', hint: '5 m grid' },
  { key: 'labels', label: 'Labels', hint: 'Zone and band names' },
  { key: 'baseline', label: 'Without-guidance ghosts', hint: 'Same seed, no bands: the comparison run' },
]

export type Selection =
  | { kind: 'none' }
  | { kind: 'zone'; id: string }
  | { kind: 'device'; id: string }
  | { kind: 'incident'; id: string }

export interface HoverInfo {
  kind: 'zone' | 'device' | 'incident' | 'camera' | 'structure'
  id: string
  x: number
  y: number
}

export interface Insets {
  left: number
  right: number
  top: number
  bottom: number
}

interface UiStore {
  selection: Selection
  hover: HoverInfo | null
  layers: Record<LayerKey, boolean>
  view: '3d' | 'plan'
  /** Commands in flight, keyed like `ack:inc-0142`. The UI waits for the backend before showing a result. */
  pending: Record<string, true>
  /** Screen space the panels cover, so the map can fit and focus into the open area. */
  insets: Insets
  demoOpen: boolean
  layersOpen: boolean
  /** The incident panel can be folded to a small card. */
  incidentOpen: boolean
  /** The zones / comparison and bands panel starts as a small box. */
  sidePanelOpen: boolean
  select(s: Selection): void
  setHover(h: HoverInfo | null): void
  toggleLayer(k: LayerKey, on?: boolean): void
  setView(v: '3d' | 'plan'): void
  setPending(key: string, on: boolean): void
  setInsets(i: Partial<Insets>): void
  setDemoOpen(open: boolean): void
  setLayersOpen(open: boolean): void
  setIncidentOpen(open: boolean): void
  setSidePanelOpen(open: boolean): void
}

export const useUi = create<UiStore>()((set) => ({
  selection: { kind: 'none' },
  hover: null,
  layers: {
    grid: true,
    structures: true,
    zones: true,
    heatmap: true,
    flow: false,
    people: true,
    trails: true,
    bands: true,
    incidents: true,
    routes: true,
    cameras: false,
    labels: true,
    baseline: false,
  },
  view: '3d',
  pending: {},
  insets: { left: 0, right: 0, top: 0, bottom: 0 },
  demoOpen: true,
  layersOpen: false,
  incidentOpen: true,
  sidePanelOpen: false,
  select: (selection) => set({ selection }),
  setHover: (hover) => set({ hover }),
  toggleLayer: (k, on) => set((s) => ({ layers: { ...s.layers, [k]: on ?? !s.layers[k] } })),
  setView: (view) => set({ view }),
  setPending: (key, on) =>
    set((s) => {
      const pending = { ...s.pending }
      if (on) pending[key] = true
      else delete pending[key]
      return { pending }
    }),
  setInsets: (i) => set((s) => ({ insets: { ...s.insets, ...i } })),
  setDemoOpen: (demoOpen) => set({ demoOpen }),
  setLayersOpen: (layersOpen) => set({ layersOpen }),
  setIncidentOpen: (incidentOpen) => set({ incidentOpen }),
  setSidePanelOpen: (sidePanelOpen) => set({ sidePanelOpen }),
}))
