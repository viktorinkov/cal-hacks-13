/**
 * The deployed organizer at band1t.vip publishes this document. The command center reads it so the
 * database, socket, and sign-in client stay the ones that portal uses.
 */
export interface HostConfig {
  authClientId: string
  database: string
  spacetimeUrl: string
  kibanaUrl: string
  testMode: boolean
}

export const HOST_FALLBACK: HostConfig = {
  authClientId: '',
  database: import.meta.env.VITE_SPACETIMEDB_DB || 'bandit-calhacks13-sp82j',
  spacetimeUrl: import.meta.env.VITE_SPACETIMEDB_URI || 'https://maincloud.spacetimedb.com',
  kibanaUrl: '',
  testMode: false,
}

export function parseHostConfig(value: unknown, fallback: HostConfig = HOST_FALLBACK): HostConfig {
  if (!value || typeof value !== 'object') return fallback
  const row = value as Record<string, unknown>
  const database = typeof row.database === 'string' && row.database ? row.database : fallback.database
  const spacetimeUrl = typeof row.spacetimedb_url === 'string' && row.spacetimedb_url ? row.spacetimedb_url : fallback.spacetimeUrl
  return {
    authClientId: typeof row.auth_client_id === 'string' ? row.auth_client_id : '',
    database,
    spacetimeUrl,
    kibanaUrl: typeof row.kibana_url === 'string' ? row.kibana_url : '',
    testMode: row.test_mode === true,
  }
}

let pending: Promise<HostConfig> | null = null

export function loadHostConfig(): Promise<HostConfig> {
  if (import.meta.env.MODE === 'test') return Promise.resolve(HOST_FALLBACK)
  if (!pending) {
    pending = fetch('/config.json')
      .then(async (res) => (res.ok ? parseHostConfig(await res.json()) : HOST_FALLBACK))
      .catch(() => HOST_FALLBACK)
  }
  return pending
}
