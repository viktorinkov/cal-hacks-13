import { create } from 'zustand'
import type { ConnectionState } from '@/contracts/domain'

export type SyncPhase = 'loading' | 'live' | 'resyncing' | 'error'

interface ConnectionStore {
  connection: ConnectionState
  sync: SyncPhase
  syncError: string | null
  /** Wall-clock time the last frame or event arrived, for stale detection. */
  lastDataAt: number | null
  setConnection(c: ConnectionState): void
  setSync(phase: SyncPhase, error?: string | null): void
  touch(): void
}

export const useConnection = create<ConnectionStore>()((set) => ({
  connection: { phase: 'idle', attempt: 0, lastMessageAt: null, nextRetryAt: null },
  sync: 'loading',
  syncError: null,
  lastDataAt: null,
  setConnection: (connection) => set({ connection }),
  setSync: (sync, error = null) => set({ sync, syncError: error }),
  touch: () => set({ lastDataAt: Date.now() }),
}))

/** Data is current only while the link is open and the initial state has loaded. */
export function isLive(s: Pick<ConnectionStore, 'connection' | 'sync'>): boolean {
  return s.connection.phase === 'open' && s.sync === 'live'
}
