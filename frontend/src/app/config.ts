/**
 * Runtime configuration. Environment variables set the default; a `?mode=` query parameter can
 * override it on the demo laptop without a rebuild.
 */
export type BanditMode = 'mock' | 'live'

export interface AppConfig {
  mode: BanditMode
  apiBaseUrl: string
  wsUrl: string
  /** Hybrid: run the in-browser crowd while bands and incidents come from the backend. */
  localCrowd: boolean
  /** The backend exposes the /v1/demo/* presentation endpoints. */
  demoService: boolean
}

export function readConfig(search: string = typeof window === 'undefined' ? '' : window.location.search): AppConfig {
  const env = import.meta.env
  const params = new URLSearchParams(search)
  const modeParam = params.get('mode')
  const mode: BanditMode = modeParam === 'live' || modeParam === 'mock' ? modeParam : env.VITE_BANDIT_MODE === 'live' ? 'live' : 'mock'
  return {
    mode,
    apiBaseUrl: params.get('api') ?? env.VITE_API_BASE_URL ?? 'http://localhost:8080',
    wsUrl: params.get('ws') ?? env.VITE_WS_URL ?? 'ws://localhost:8080/v1/stream',
    localCrowd: (params.get('crowd') ?? env.VITE_BANDIT_CROWD ?? 'local') === 'local',
    demoService: (params.get('demoApi') ?? env.VITE_BANDIT_DEMO_API) === '1',
  }
}
