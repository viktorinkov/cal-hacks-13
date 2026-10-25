import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { KibanaPage } from '@/components/desk/KibanaPage'
import { RouteProvider } from '@/cover/route'
import type { HostConfig } from '@/stdb/host'
import { KIBANA_JOBS, kibanaHref, useHost } from '@/stdb/kibana'

const hostState = vi.hoisted(() => ({
  config: {
    authClientId: '',
    database: 'bandit-test',
    spacetimeUrl: 'https://maincloud.spacetimedb.com',
    kibanaUrl: '',
    testMode: false,
  } as HostConfig,
}))

vi.mock('@/stdb/host', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/stdb/host')>()
  return { ...actual, loadHostConfig: vi.fn(async () => hostState.config) }
})

afterEach(() => {
  cleanup()
  useHost.setState({ host: null })
  hostState.config.kibanaUrl = ''
})

describe('kibana page', () => {
  it('builds every Kibana link from the config address and opens it in a new tab', async () => {
    hostState.config.kibanaUrl = 'https://bandit.kb.us-east-1.aws.elastic.cloud/'
    render(<RouteProvider><KibanaPage /></RouteProvider>)
    const radio = await screen.findByRole('link', { name: 'Band radio and photos' })
    expect(radio).toHaveAttribute('href', 'https://bandit.kb.us-east-1.aws.elastic.cloud/app/dashboards#/view/bandit-radio')
    let count = 0
    for (const job of KIBANA_JOBS) {
      const section = screen.getByRole('region', { name: job.job })
      expect(within(section).getByText(job.what)).toBeInTheDocument()
      for (const [label, path] of job.views) {
        const link = within(section).getByRole('link', { name: label })
        expect(link).toHaveAttribute('href', `https://bandit.kb.us-east-1.aws.elastic.cloud${path}`)
        expect(link).toHaveAttribute('target', '_blank')
        expect(link).toHaveAttribute('rel', 'noreferrer')
        count += 1
      }
    }
    expect(count).toBe(14)
    expect(screen.getByText('Elastic, the Evidence Engine')).toBeInTheDocument()
  })

  it('names the views without links when the host has no Kibana address', async () => {
    render(<RouteProvider><KibanaPage /></RouteProvider>)
    expect(await screen.findByText('This host has no Kibana address, so the views below cannot open.')).toBeInTheDocument()
    expect(screen.getByText('Band radio and photos')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Band radio and photos' })).not.toBeInTheDocument()
  })

  it('joins the address and the path the way the dev portal does', () => {
    expect(kibanaHref('https://kb.example', '/app/workflows/bandit-organize')).toBe('https://kb.example/app/workflows/bandit-organize')
  })
})
