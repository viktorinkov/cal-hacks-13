import { describe, expect, it } from 'vitest'
import { HOST_FALLBACK, parseHostConfig } from '@/stdb/host'

describe('organizer host config', () => {
  it('reads the document the live portal publishes', () => {
    const host = parseHostConfig({
      auth_client_id: 'client_x',
      database: 'bandit-calhacks13-sp82j',
      spacetimedb_url: 'wss://maincloud.spacetimedb.com',
      kibana_url: 'https://example.test',
      test_mode: true,
    })
    expect(host.authClientId).toBe('client_x')
    expect(host.database).toBe('bandit-calhacks13-sp82j')
    expect(host.spacetimeUrl).toBe('wss://maincloud.spacetimedb.com')
    expect(host.kibanaUrl).toBe('https://example.test')
    expect(host.testMode).toBe(true)
  })

  it('keeps the local fallback when the document is missing', () => {
    expect(parseHostConfig(null)).toEqual(HOST_FALLBACK)
    expect(parseHostConfig({ database: '' }).database).toBe(HOST_FALLBACK.database)
  })
})
