/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BANDIT_MODE?: 'mock' | 'live'
  readonly VITE_API_BASE_URL?: string
  readonly VITE_WS_URL?: string
  readonly VITE_BANDIT_CROWD?: 'local' | 'backend'
  readonly VITE_BANDIT_DEMO_API?: '0' | '1'
  readonly VITE_SPACETIMEDB_URI?: string
  readonly VITE_SPACETIMEDB_DB?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
