import { DEFAULT_SETUP_ID, type VenueSetupView, type VenueStepView } from '@/stdb/venueSetup'
import { buildRun, type Run } from './runs'

/**
 * The Cal Hacks 13.0 run at the Palace of Fine Arts, put back together from what was saved: the model
 * in public/venue/venue.glb (exported by pipeline/venue_model.py with three r186 from
 * hive.hackberkeley.org/venue-map, which embeds palace-interior.vercel.app), the worker's own step
 * wording and search queries (crates/bandit-workers/src/venue.rs), and the plan source in
 * pipeline/venues/palace-of-fine-arts.json. No run of it was recorded in the database, so the step
 * times are approximate and the screen says so.
 */

/** venue.glb's export, Oct 24 2026 at 14:14 in San Francisco. */
export const PALACE_SAVED_AT = Date.UTC(2026, 9, 24, 21, 14)

const EVENT = 'Cal Hacks 13.0'

/** Seconds into the run. Approximate: search and page reads are quick, the browser capture is not. */
const AT = { search: 0, found: 14, read: 31, open: 58, saved: 172 }

const start = PALACE_SAVED_AT - AT.saved * 1000

/** Measured from public/venue/venue.glb: 106 meshes, 115,545 triangles, 213.9 × 16.5 × 96.7 m. */
export const PALACE_SETUP: VenueSetupView = {
  id: DEFAULT_SETUP_ID,
  eventName: EVENT,
  status: 'ready',
  eventSite: '',
  venueName: 'Palace of Fine Arts',
  address: '3601 Lyon St, San Francisco, CA 94123',
  mapUrl: 'https://hive.hackberkeley.org/venue-map',
  method: 'three.js scene',
  modelUrl: '/venue/venue.glb',
  layoutUrl: '',
  modelBytes: 11_612_520,
  meshes: 106,
  triangles: 115_545,
  places: 0,
  sizeX: 213.9,
  sizeY: 16.5,
  sizeZ: 96.7,
  floorPlans: ['https://palaceoffinearts.com/wp-content/uploads/sites/4/2024/09/Palace-of-Fine-Arts-Venue-Presentation.pdf'],
  sources: [
    { label: 'Venue map', value: 'https://hive.hackberkeley.org/venue-map' },
    { label: '3D map it embeds', value: 'https://palace-interior.vercel.app/' },
  ],
  error: '',
  createdAt: start,
  updatedAt: PALACE_SAVED_AT,
}

function step(n: number, name: string, seconds: number, detail: string): VenueStepView {
  return { id: `palace-${n}`, setupId: DEFAULT_SETUP_ID, step: name, detail, at: start + seconds * 1000 }
}

export const PALACE_STEPS: VenueStepView[] = [
  step(1, 'Searching', AT.search, `Searching the web for "${EVENT}", "${EVENT} venue map", "${EVENT} venue 3D map floor plan"`),
  step(2, 'Found the event', AT.found, 'Palace of Fine Arts, 3601 Lyon St, San Francisco, CA 94123'),
  step(3, 'Reading pages', AT.read, 'hive.hackberkeley.org/venue-map, palaceoffinearts.com'),
  step(4, 'Opening the 3D map', AT.open, 'https://hive.hackberkeley.org/venue-map'),
  step(5, 'Saved the model', AT.saved, '106 meshes, 115545 triangles, through three.js scene'),
]

export function palaceRun(): Run {
  return buildRun(PALACE_SETUP, PALACE_STEPS, { reconstructed: true, savedAt: PALACE_SAVED_AT })
}
