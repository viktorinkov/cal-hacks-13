import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KibanaPage } from '@/components/desk/KibanaPage'
import { TestBandsPage } from '@/components/desk/TestBandsPage'
import { RouteProvider } from '@/cover/route'
import type { HostConfig } from '@/stdb/host'
import { attachLink, dropLink } from '@/stdb/link'
import type { DbConnection } from '@/stdb/module_bindings'
import { useSession } from '@/stdb/session'
import { KIBANA_JOBS, isOnline, kibanaHref, postDev, useTestBands } from '@/stdb/testBands'

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

function host(patch: Partial<HostConfig>) {
  hostState.config = { ...hostState.config, ...patch }
}

type Row = Record<string, unknown>

function table(rows: Row[]) {
  const listeners: (() => void)[] = []
  return {
    rows,
    iter: () => rows[Symbol.iterator](),
    onInsert: (cb: () => void) => listeners.push(cb),
    onDelete: (cb: () => void) => listeners.push(cb),
    onUpdate: (cb: () => void) => listeners.push(cb),
    fire: () => listeners.forEach((cb) => cb()),
  }
}

const stamp = (ms: number) => ({ toDate: () => new Date(ms) })

function fakeLink() {
  const now = Date.now()
  const db = {
    band: table([
      { id: 90, online: true, zone: 1, lastSeen: stamp(now) },
      { id: 91, online: true, zone: 2, lastSeen: stamp(now - 10_000) },
      { id: 94, online: true, zone: 3, lastSeen: stamp(now) },
      { id: 96, online: false, zone: 0, lastSeen: stamp(now) },
      { id: 140, online: true, zone: 1, lastSeen: stamp(now) },
    ]),
    zone: table([
      { id: 12n, name: 'Food court', stationId: 3 },
      { id: 10n, name: 'Main stage', stationId: 1 },
      { id: 11n, name: 'Sponsor hall', stationId: 2 },
    ]),
    boardAttendees: table([
      { nodeId: 1n, displayName: 'Maya Chen', bandId: 90 },
      { nodeId: 2n, displayName: '', bandId: 94 },
      { nodeId: 3n, displayName: 'Not a test band', bandId: 12 },
    ]),
  }
  const openIncident = vi.fn(async (args: unknown) => args)
  const conn = { db, reducers: { openIncident } }
  attachLink(conn as unknown as DbConnection)
  return { db, openIncident }
}

function answer(ok: boolean, body: unknown = {}, status = ok ? 200 : 409) {
  return { ok, status, json: async () => body } as unknown as Response
}

const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => answer(true))

function renderPage(page: React.ReactElement) {
  return render(<RouteProvider>{page}</RouteProvider>)
}

beforeEach(() => {
  window.history.replaceState(null, '', '/')
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => answer(true))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  dropLink()
  vi.unstubAllGlobals()
  useTestBands.setState({ host: null, busy: null, failure: null })
  useSession.setState({ phase: 'idle', owner: false, roles: [] })
  host({ kibanaUrl: '', testMode: false })
})

describe('kibana page', () => {
  it('builds every Kibana link from the config address and opens it in a new tab', async () => {
    host({ kibanaUrl: 'https://bandit.kb.us-east-1.aws.elastic.cloud/' })
    renderPage(<KibanaPage />)
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
    renderPage(<KibanaPage />)
    expect(await screen.findByText('This host has no Kibana address, so the views below cannot open.')).toBeInTheDocument()
    expect(screen.getByText('Band radio and photos')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Band radio and photos' })).not.toBeInTheDocument()
  })

  it('joins the address and the path the way the dev portal does', () => {
    expect(kibanaHref('https://kb.example', '/app/workflows/bandit-organize')).toBe('https://kb.example/app/workflows/bandit-organize')
  })
})

describe('test bands page', () => {
  it('lists bands 90 to 99 with their wearer, zone and whether they are online', async () => {
    host({ testMode: true })
    useSession.setState({ owner: true, phase: 'live' })
    fakeLink()
    renderPage(<TestBandsPage />)
    const ninety = await screen.findByRole('listitem', { name: 'Band 90' })
    expect(within(ninety).getByText('Online')).toBeInTheDocument()
    expect(within(ninety).getByText('Maya Chen')).toBeInTheDocument()
    expect(within(ninety).getByText('Main stage', { selector: 'p' })).toBeInTheDocument()
    const ninetyOne = screen.getByRole('listitem', { name: 'Band 91' })
    expect(within(ninetyOne).getByText('Offline')).toBeInTheDocument()
    expect(within(ninetyOne).getByText('Not claimed')).toBeInTheDocument()
    expect(within(screen.getByRole('listitem', { name: 'Band 94' })).getByText('No name yet')).toBeInTheDocument()
    expect(within(screen.getByRole('listitem', { name: 'Band 99' })).getByText('No zone')).toBeInTheDocument()
    expect(within(screen.getByRole('listitem', { name: 'Band 94' })).getByText('Food court', { selector: 'p' })).toBeInTheDocument()
    expect(screen.getAllByRole('listitem').filter((item) => /^Band \d+$/.test(item.getAttribute('aria-label') ?? ''))).toHaveLength(10)
    expect(screen.queryByRole('listitem', { name: 'Band 140' })).not.toBeInTheDocument()
  })

  it('walks a band to a zone, but not to the one it is in', async () => {
    host({ testMode: true })
    useSession.setState({ owner: true, phase: 'live' })
    fakeLink()
    renderPage(<TestBandsPage />)
    expect(await screen.findByRole('button', { name: 'Walk Band 90 to Main stage' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Walk Band 90 to Food court' }))
    expect(fetchMock).toHaveBeenCalledWith('/api/dev/move/90/3', { method: 'POST' })
  })

  it('offers Press from band 94 and Fall here only on claimed bands', async () => {
    host({ testMode: true })
    useSession.setState({ owner: true, phase: 'live' })
    fakeLink()
    renderPage(<TestBandsPage />)
    await screen.findByRole('button', { name: 'Press Band 94' })
    expect(screen.queryByRole('button', { name: 'Press Band 93' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Fall here, Band 95' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fall here, Band 94' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Press Band 94' }))
    expect(fetchMock).toHaveBeenCalledWith('/api/dev/press/94', { method: 'POST' })
    expect(window.location.pathname).toBe('/')
  })

  it('stages a fall and opens the claims desk', async () => {
    host({ testMode: true })
    useSession.setState({ owner: true, phase: 'live' })
    fakeLink()
    renderPage(<TestBandsPage />)
    await userEvent.click(await screen.findByRole('button', { name: 'Fall here, Band 90' }))
    expect(fetchMock).toHaveBeenCalledWith('/api/dev/fall/90', { method: 'POST' })
    await waitFor(() => expect(window.location.pathname).toBe('/claims'))
  })

  it('breaks a speaker in a zone and opens the claims desk', async () => {
    host({ testMode: true })
    useSession.setState({ owner: true, phase: 'live' })
    fakeLink()
    renderPage(<TestBandsPage />)
    expect(await screen.findByRole('heading', { name: 'Property damage' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Speaker breaks in Food court' }))
    expect(fetchMock).toHaveBeenCalledWith('/api/dev/property/3', { method: 'POST' })
    await waitFor(() => expect(window.location.pathname).toBe('/claims'))
  })

  it('shows the host refusal and stays on the page', async () => {
    host({ testMode: true })
    useSession.setState({ owner: true, phase: 'live' })
    fakeLink()
    fetchMock.mockImplementation(async () => answer(false, { error: 'No camera covers that zone.' }))
    renderPage(<TestBandsPage />)
    await userEvent.click(await screen.findByRole('button', { name: 'Speaker breaks in Main stage' }))
    expect(fetchMock).toHaveBeenCalledWith('/api/dev/property/1', { method: 'POST' })
    expect(await screen.findByText('No camera covers that zone.')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/')

    fetchMock.mockImplementation(async () => answer(false, { error: 'Band 90 has not been seen yet.' }))
    await userEvent.click(screen.getByRole('button', { name: 'Fall here, Band 90' }))
    expect(await screen.findByText('Band 90 has not been seen yet.')).toBeInTheDocument()
    expect(screen.queryByText('No camera covers that zone.')).not.toBeInTheDocument()
    expect(window.location.pathname).toBe('/')
  })

  it('redraws when a band row changes', async () => {
    host({ testMode: true })
    useSession.setState({ owner: true, phase: 'live' })
    const { db } = fakeLink()
    renderPage(<TestBandsPage />)
    const ninety = await screen.findByRole('listitem', { name: 'Band 90' })
    expect(within(ninety).getByText('Main stage', { selector: 'p' })).toBeInTheDocument()
    db.band.rows[0] = { ...db.band.rows[0], zone: 2 }
    await act(async () => {
      db.band.fire()
      await Promise.resolve()
    })
    expect(within(screen.getByRole('listitem', { name: 'Band 90' })).getByText('Sponsor hall', { selector: 'p' })).toBeInTheDocument()
  })

  it('reports broken or stolen equipment with the zone id as a u64 and no band', async () => {
    host({ testMode: true })
    useSession.setState({ owner: true, phase: 'live' })
    const { openIncident } = fakeLink()
    renderPage(<TestBandsPage />)
    expect(await screen.findByText('Report something broken or stolen')).toBeInTheDocument()
    const where = screen.getByLabelText('Where')
    expect([...where.querySelectorAll('option')].map((option) => option.textContent)).toEqual(['Main stage', 'Sponsor hall', 'Food court'])
    await userEvent.selectOptions(screen.getByLabelText('What happened'), 'theft')
    await userEvent.selectOptions(where, 'Food court')
    const note = screen.getByLabelText('Note')
    expect(note).toHaveAttribute('placeholder', "What it is and what it is worth, e.g. a sponsor's laptop, $1,299")
    await userEvent.type(note, "A sponsor's laptop, $1,299 ")
    await userEvent.click(screen.getByRole('button', { name: 'Report it' }))
    expect(openIncident).toHaveBeenCalledTimes(1)
    const args = openIncident.mock.calls[0][0] as { kind: string; zoneId: unknown; bandId: number; note: string }
    expect(args).toEqual({ kind: 'theft', zoneId: 12n, bandId: 0, note: "A sponsor's laptop, $1,299" })
    expect(typeof args.zoneId).toBe('bigint')
    expect(await screen.findByText('Reported.')).toBeInTheDocument()
    expect(note).toHaveValue('')
  })

  it('shows the refusal when the database is not connected', async () => {
    host({ testMode: true })
    useSession.setState({ owner: true, phase: 'live' })
    useTestBands.setState({ zones: [{ id: '10', name: 'Main stage', stationId: 1 }] })
    renderPage(<TestBandsPage />)
    await userEvent.click(await screen.findByRole('button', { name: 'Report it' }))
    expect(await screen.findByText('The database is not connected.')).toBeInTheDocument()
  })

  it('hides the test controls when test mode is off', async () => {
    host({ testMode: false })
    useSession.setState({ owner: true, phase: 'live' })
    fakeLink()
    renderPage(<TestBandsPage />)
    expect(await screen.findByText('Test controls are off on this host.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Press Band 94' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Walk Band/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Speaker breaks in/ })).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/api/dev/'), expect.anything())
  })

  it('hides the test controls from staff who are not organizers', async () => {
    host({ testMode: true })
    useSession.setState({ owner: false, roles: ['medic'], phase: 'live' })
    fakeLink()
    renderPage(<TestBandsPage />)
    expect(await screen.findByText('Only an organizer can use the test controls.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Press Band 94' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Report it' })).toBeInTheDocument()
  })
})

describe('test band helpers', () => {
  it('counts a test band online only while it was heard in the last five seconds', () => {
    const now = 1_000_000
    expect(isOnline({ id: 90, online: true, zone: 1, lastSeen: now - 4_999 }, now)).toBe(true)
    expect(isOnline({ id: 90, online: true, zone: 1, lastSeen: now - 5_000 }, now)).toBe(false)
    expect(isOnline({ id: 90, online: false, zone: 1, lastSeen: now }, now)).toBe(false)
    expect(isOnline({ id: 140, online: true, zone: 1, lastSeen: 0 }, now)).toBe(true)
    expect(isOnline(undefined, now)).toBe(false)
  })

  it('turns a refusal without a JSON body into a sentence', async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, status: 502, json: async () => { throw new Error('not json') } }) as unknown as Response)
    await expect(postDev('/api/dev/press/94')).rejects.toThrow('The host refused that (502).')
    fetchMock.mockImplementation(async () => { throw new TypeError('Failed to fetch') })
    await expect(postDev('/api/dev/press/94')).rejects.toThrow('The host did not answer.')
  })
})
