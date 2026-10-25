import { create } from 'zustand'

/** Which floor the map is drawing. CalHacks is the indoor plan; Simulation is the old concert hall. */
export type VenuePlan = 'calhacks' | 'simulation'

interface VenuePlanStore {
  plan: VenuePlan
  setPlan: (plan: VenuePlan) => void
}

/** `?venue=simulation` opens on the concert hall, and keeps it there across reloads. */
function initialPlan(): VenuePlan {
  if (typeof window === 'undefined') return 'calhacks'
  return new URLSearchParams(window.location.search).get('venue') === 'simulation' ? 'simulation' : 'calhacks'
}

export const useVenuePlan = create<VenuePlanStore>()((set) => ({
  plan: initialPlan(),
  setPlan: (plan) => set({ plan }),
}))

export function currentPlan(): VenuePlan {
  return useVenuePlan.getState().plan
}
