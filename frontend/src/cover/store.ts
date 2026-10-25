import { create } from 'zustand'
import { cloneClaims, settleClaim, type Claim } from './claims'

interface ClaimsState {
  claims: Claim[]
  settle: (id: string) => void
  reset: () => void
}

/** Session copy of the sample night. A refresh restores the scripted claims. */
export const useClaims = create<ClaimsState>((set) => ({
  claims: cloneClaims(),
  settle: (id) => set((state) => ({ claims: state.claims.map((claim) => (claim.id === id ? settleClaim(claim) : claim)) })),
  reset: () => set({ claims: cloneClaims() }),
}))
