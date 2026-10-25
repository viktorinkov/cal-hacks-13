import { DEFAULT_SETUP_ID, useVenueSetup, type VenueSetupView } from '@/stdb/venueSetup'
import { modelHref } from './runs'

/** Ground left around a model on the map, in metres, so its walls do not touch the frame. */
export const MODEL_MARGIN = 8

/**
 * A venue the organizer chose that is not the Palace: the map draws its saved model and nothing
 * else, because its zones, bands and crowd have not been set up.
 */
export interface ChosenModel {
  setupId: string
  /** The map's id for it, apart from the event floor's `calhacks`. */
  venueId: string
  url: string
  venueName: string
  eventName: string
  /** Plan size in metres, margin included: x east, y south. */
  width: number
  height: number
}

export function chosenModelOf(chosenId: string, setup: VenueSetupView | null | undefined): ChosenModel | null {
  if (chosenId === DEFAULT_SETUP_ID || !setup || setup.id !== chosenId) return null
  if (setup.status !== 'ready' || !setup.modelUrl) return null
  return {
    setupId: setup.id,
    venueId: `setup-${setup.id}`,
    url: modelHref(setup.modelUrl),
    venueName: setup.venueName || setup.eventName,
    eventName: setup.eventName,
    width: Math.max(1, setup.sizeX) + 2 * MODEL_MARGIN,
    height: Math.max(1, setup.sizeZ) + 2 * MODEL_MARGIN,
  }
}

/** The chosen setup's row, as one stable reference between store updates. */
export function useChosenSetup(): VenueSetupView | null {
  return useVenueSetup((s) => (s.chosenId === DEFAULT_SETUP_ID ? null : (s.setups.find((x) => x.id === s.chosenId) ?? null)))
}

export function chosenModel(): ChosenModel | null {
  const s = useVenueSetup.getState()
  return chosenModelOf(s.chosenId, s.setups.find((x) => x.id === s.chosenId))
}
