import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PersonPanel } from '@/components/dashboard/PersonPanel'
import { RouteProvider } from '@/cover/route'
import { pickPerson } from '@/map/personPicking'
import { stagePersonAction } from '@/stdb/personActions'
import { useRun } from '@/stdb/runOps'
import { useSession } from '@/stdb/session'
import { useDesk } from '@/stdb/deskOps'
import { useUi } from '@/stores/ui'

const { stageCrowdAction, fileClaim } = vi.hoisted(() => ({ stageCrowdAction: vi.fn<(args: { bandId: number; action: string }) => Promise<void>>(), fileClaim: vi.fn<(...args: string[]) => Promise<void>>() }))
vi.mock('@/stdb/link', async (original) => ({ ...await original<typeof import('@/stdb/link')>(), linkReducers: () => ({ stageCrowdAction }) }))
vi.mock('@/stdb/deskOps', async (original) => ({ ...await original<typeof import('@/stdb/deskOps')>(), fileClaim }))

const originalRun = useRun.getState()
const originalSession = useSession.getState()

beforeEach(() => {
  vi.clearAllMocks()
  stageCrowdAction.mockResolvedValue(undefined)
  fileClaim.mockResolvedValue(undefined)
  useDesk.setState({ injuries: [], busy: false })
  useSession.setState({ owner: false, roles: ['ops'], phase: 'live' })
  useRun.setState({
    ...originalRun,
    linked: true,
    run: { phase: 'running', crowd: 1000, pace: 8, startedAt: 1, endsAt: 10000, closingAt: 0, endedAt: 0, nextIncidentAt: 0, step: 1, seed: '42' },
    attendees: [
      { nodeId: '400', displayName: 'Jordan Alvarez', bandId: 100, crowd: true, organization: '' },
      { nodeId: '401', displayName: 'Nia Patel', bandId: 101, crowd: false, organization: '' },
    ],
    bands: [100, 101].map((id) => ({ id, online: true, lastSeen: 10, zone: 2, neigh: 0, sos: false, fall: false, hasPosition: true })),
    zones: [{ id: '9', name: 'Sponsor booths', stationId: 2, capacity: 100, exitColour: 0, xM: 1, yM: 2 }],
  })
  useUi.setState({ selection: { kind: 'device', id: 'band-100' } })
  window.history.replaceState(null, '', '/organizer')
})

afterEach(() => {
  cleanup()
  useRun.setState(originalRun, true)
  useSession.setState(originalSession, true)
  useUi.setState({ selection: { kind: 'none' } })
  useDesk.setState({ injuries: [] })
})

function showPerson() {
  return render(<RouteProvider><PersonPanel /></RouteProvider>)
}

describe('selected person actions', () => {
  it.each([['Gets injured', 'injury'], ['Steals equipment', 'theft']])('starts %s for the exact selected bot', async (label, action) => {
    showPerson()
    expect(screen.getByRole('heading', { name: 'Jordan Alvarez' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: label }))
    expect(stageCrowdAction).toHaveBeenCalledExactlyOnceWith({ bandId: 100, action })
    expect(screen.getByRole('status')).toHaveTextContent('started')
  })

  it('does not offer bot actions for a real attendee, even with a crowd-range band ID', async () => {
    useUi.setState({ selection: { kind: 'device', id: 'band-101' } })
    showPerson()
    expect(screen.getByRole('heading', { name: 'Nia Patel' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Gets injured' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open band' })).toBeInTheDocument()
    await expect(stagePersonAction(101, 'injury')).rejects.toThrow('only for the test crowd')
    expect(stageCrowdAction).not.toHaveBeenCalled()
  })

  it('keeps controls hidden for a non-organizer', async () => {
    useSession.setState({ roles: ['medic'], owner: false })
    showPerson()
    expect(screen.queryByRole('button', { name: 'Steals equipment' })).not.toBeInTheDocument()
    await expect(stagePersonAction(100, 'theft')).rejects.toThrow('Only an organizer')
    expect(stageCrowdAction).not.toHaveBeenCalled()
  })

  it.each([
    ['paused', { pausedAt: 1 }],
    ['evacuating', { evacuatingAt: 1 }],
    ['ended', { eventEnded: true, run: null }],
  ])('still stages an action while %s', async (_state, values) => {
    useRun.setState(values)
    showPerson()
    await userEvent.click(screen.getByRole('button', { name: 'Gets injured' }))
    expect(stageCrowdAction).toHaveBeenCalledExactlyOnceWith({ bandId: 100, action: 'injury' })
  })

  it.each([
    ['unplaced', { bands: [] }, 'recorded place'],
    ['disconnected', { linked: false }, 'connection'],
  ])('blocks actions while %s', async (_state, values, reason) => {
    useRun.setState(values)
    showPerson()
    expect(screen.getByRole('button', { name: 'Gets injured' })).toBeDisabled()
    await expect(stagePersonAction(100, 'injury')).rejects.toThrow(reason as string)
    expect(stageCrowdAction).not.toHaveBeenCalled()
  })

  it('blocks an existing property plan and links its exact settlement', async () => {
    useRun.setState({
      plans: [{ incidentId: '81', culpritBand: 100 }],
      incidents: [{ id: '81', kind: 'theft', status: 'open', zoneId: '9', subjectBand: 0, openedAt: 5 }],
      claims: [{ id: '91', incidentId: '81', status: 'routed', payoutCents: 100, packHash: 'pack' }],
    })
    showPerson()
    expect(screen.getByRole('button', { name: 'Steals equipment' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'View settlement' }))
    expect(window.location.pathname + window.location.search).toBe('/claims?claim=91')
  })

  it('shows a reducer refusal without claiming an incident started', async () => {
    stageCrowdAction.mockRejectedValue(new Error('This attendee has left the event.'))
    showPerson()
    await userEvent.click(screen.getByRole('button', { name: 'Gets injured' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('has left')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Gets injured' })).toBeEnabled()
  })

  it('waits for the current incident settlement and preserves the active view in its link', async () => {
    window.history.replaceState(null, '', '/organizer?as=ops')
    useRun.setState({
      markers: [{ incidentId: '72', kind: 'fall', bandId: 100, xM: 1, yM: 2, person: 'Jordan Alvarez', stationId: 2, place: 'Sponsor booths', status: 'resolved', medic: 'Medic', openedAt: 1, respondingAt: 2, resolvedAt: 3, claimId: '73', claimStatus: 'paid', payoutCents: 100 }],
      incidents: [{ id: '81', kind: 'fall', status: 'open', zoneId: '9', subjectBand: 100, openedAt: 5 }],
      claims: [{ id: '73', incidentId: '72', status: 'paid', payoutCents: 100, packHash: 'older' }],
    })
    showPerson()
    expect(screen.queryByRole('button', { name: 'View settlement' })).not.toBeInTheDocument()
    act(() => useRun.setState({ claims: [{ id: '91', incidentId: '81', status: 'routed', payoutCents: 100, packHash: 'current' }] }))
    await userEvent.click(screen.getByRole('button', { name: 'View settlement' }))
    expect(window.location.pathname + window.location.search).toBe('/claims?as=ops&claim=91')
  })

  it('opens the real incident from an empty claim board and clears stale person messages', async () => {
    showPerson()
    await userEvent.click(screen.getByRole('button', { name: 'Gets injured' }))
    act(() => useRun.setState({ incidents: [{ id: '19', kind: 'fall', status: 'open', zoneId: '9', subjectBand: 100, openedAt: 5 }] }))
    await userEvent.click(screen.getByRole('button', { name: 'View incident' }))
    expect(useUi.getState().selection).toEqual({ kind: 'incident', id: '19' })
    expect(useUi.getState().incidentOpen).toBe(true)
    act(() => useUi.setState({ selection: { kind: 'device', id: 'band-101' } }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('files the first claim from the selected wearer without a prior claim row', async () => {
    useUi.setState({ selection: { kind: 'device', id: 'band-101' } })
    useSession.setState({ claims: [] })
    useDesk.setState({ injuries: [{ incidentId: '31', kind: 'fall', zoneName: 'Sponsor booths', bandId: 101, wearerName: 'Nia Patel', openedAt: 100, resolvedAt: 200, notes: [] }] })
    showPerson()
    await userEvent.click(screen.getByRole('button', { name: 'File injury claim' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'What happened to Nia Patel' }), 'I slipped near the booth.')
    await userEvent.click(screen.getByRole('button', { name: 'File the claim as Nia Patel' }))
    expect(fileClaim).toHaveBeenCalledExactlyOnceWith('31', 'I slipped near the booth.', 'random')
    expect(screen.getByRole('status')).toHaveTextContent('Claim filed')
    expect(stageCrowdAction).not.toHaveBeenCalled()
  })

  it('does not offer a historical injury under a different wearer name', () => {
    useDesk.setState({ injuries: [{ incidentId: '31', kind: 'fall', zoneName: 'Sponsor booths', bandId: 100, wearerName: 'Another wearer', openedAt: 100, resolvedAt: 200, notes: [] }] })
    showPerson()
    expect(screen.queryByRole('button', { name: 'File injury claim' })).not.toBeInTheDocument()
  })
})

describe('picking a person on the floor', () => {
  it('uses the nearest drawn character and never makes up an absent band position', () => {
    const positions = new Map([[100, { x: 9, y: 10 }], [102, { x: 12, y: 10 }]])
    const bands = [{ id: 100 }, { id: 101 }, { id: 102 }]
    const at = (id: number) => positions.get(id) ?? null
    expect(pickPerson({ x: 12, y: 10 }, bands, at, (point) => point)).toBe(102)
    expect(pickPerson({ x: 100, y: 100 }, bands, at, (point) => point)).toBeNull()
  })
})
