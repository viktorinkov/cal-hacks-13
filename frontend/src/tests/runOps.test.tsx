import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RunPage } from '@/components/desk/RunPage'
import { RouteProvider } from '@/cover/route'
import { attachLink, dropLink } from '@/stdb/link'
import type { DbConnection } from '@/stdb/module_bindings'
import {
  RUN_QUERIES,
  approveRunClaim,
  endRun,
  evacuateRun,
  pauseRun,
  phaseLine,
  placeRunBand,
  placeableBands,
  resumeRun,
  shownDecisions,
  startRun,
  summarize,
  unplaceRunBand,
  useRun,
  wearerMatches,
} from '@/stdb/runOps'
import { useSession } from '@/stdb/session'

type Row = Record<string, unknown>

function table(rows: Row[] = []) {
  const listeners: (() => void)[] = []
  return {
    rows,
    iter: () => rows.values(),
    onInsert: (cb: () => void) => listeners.push(cb),
    onUpdate: (cb: () => void) => listeners.push(cb),
    onDelete: (cb: () => void) => listeners.push(cb),
    /** Replace the rows and tell every watcher, as the SDK does on a row event. */
    set(next: Row[]) {
      rows.splice(0, rows.length, ...next)
      for (const cb of listeners) cb()
    },
  }
}

const ts = (ms: number) => ({ toDate: () => new Date(ms) })

const NOW = Date.UTC(2026, 9, 25, 20, 0, 0)
const START = NOW - 5 * 60_000

function reducers() {
  const ok = () => vi.fn((..._args: unknown[]) => Promise.resolve())
  return {
    startLiveRun: ok(),
    pauseLiveRun: ok(),
    resumeLiveRun: ok(),
    evacuateLiveRun: ok(),
    endLiveRun: ok(),
    endEvent: ok(),
    reopenEvent: ok(),
    startCrowd: ok(),
    stopCrowd: ok(),
    approveClaim: ok(),
    giveBand: ok(),
    placeBand: ok(),
    unplaceBand: ok(),
    setLowVis: ok(),
  }
}

function tables() {
  return {
    liveRun: table([{
      id: 0,
      phase: { tag: 'Running' },
      crowd: 1000,
      pace: 8,
      startedAt: ts(START),
      endsAt: ts(START + 12 * 60_000),
      closingAt: undefined,
      endedAt: undefined,
      nextIncidentAt: ts(NOW + 30_000),
      step: 40,
      seed: 18_446_744_073_709_551_615n,
      startedBy: {},
    }]),
    livePause: table(),
    liveEvacuation: table(),
    incidentMarker: table([
      // Before this run started: left out.
      { incidentId: 1n, kind: 'fall', bandId: 140, person: 'Old', xM: 0, yM: 0, stationId: 1, place: 'Hall', status: 'resolved', medic: '', openedAt: ts(START - 60_000), respondingAt: undefined, resolvedAt: undefined, claimId: 0n, claimStatus: '', payoutCents: 0n },
      { incidentId: 2n, kind: 'sos', bandId: 141, person: 'Ada', xM: 3, yM: 4, stationId: 1, place: 'Main stage', status: 'responding', medic: 'Nia', openedAt: ts(START + 60_000), respondingAt: ts(START + 70_000), resolvedAt: undefined, claimId: 7n, claimStatus: 'waiting for the organizer', payoutCents: 12_500n },
      { incidentId: 3n, kind: 'fall', bandId: 142, person: 'Ben', xM: 5, yM: 6, stationId: 2, place: 'Bar', status: 'resolved', medic: 'Nia', openedAt: ts(START + 120_000), respondingAt: ts(START + 130_000), resolvedAt: ts(START + 200_000), claimId: 8n, claimStatus: 'paid by the insurer', payoutCents: 9_000n },
      { incidentId: 4n, kind: 'property', bandId: 0, person: '', xM: 7, yM: 8, stationId: 2, place: 'Bar', status: 'open', medic: '', openedAt: ts(START + 180_000), respondingAt: undefined, resolvedAt: undefined, claimId: 9n, claimStatus: 'refused', payoutCents: 0n },
    ]),
    decision: table([
      { id: 10n, at: ts(START + 75_000), incidentId: 2n, claimId: 7n, actor: 'agent', who: 'Claims agent', what: 'Routed the claim to the organizer', why: 'Above the rule ceiling' },
      { id: 11n, at: ts(START + 130_000), incidentId: 3n, claimId: 8n, actor: 'rule', who: 'Rule v2', what: 'Paid the claim', why: '' },
      { id: 12n, at: ts(START + 190_000), incidentId: 4n, claimId: 0n, actor: 'ops', who: 'Edward', what: 'Opened a property incident', why: 'Speaker fell' },
    ]),
    station: table([{ id: 1, exitColour: 1, rssi: -40, online: true, lastSeen: ts(NOW) }]),
    gateway: table([{ id: 0, mac: 'aa', fw: '1', online: true, lastLine: ts(NOW - 2_000) }]),
    bandPlace: table([{ bandId: 92, xM: 10.25, yM: 4, stationId: 1, label: 'Ada', placedBy: {}, placedAt: ts(NOW) }]),
    band: table([
      { id: 140, online: true, lastSeen: ts(NOW - 60_000), zone: 1, neigh: 4, sos: false, fall: false },
      { id: 141, online: true, lastSeen: ts(NOW - 60_000), zone: 1, neigh: 6, sos: true, fall: false },
      { id: 142, online: false, lastSeen: ts(NOW - 60_000), zone: 2, neigh: 0, sos: false, fall: false },
      // A real band heard a minute ago is not at the event any more; one heard a second ago is.
      { id: 7, online: true, lastSeen: ts(NOW - 60_000), zone: 1, neigh: 1, sos: false, fall: false },
      { id: 12, online: true, lastSeen: ts(NOW - 1_000), zone: 1, neigh: 1, sos: false, fall: false },
    ]),
    zone: table([
      { id: 1n, name: 'Main stage', stationId: 1, capacity: 400, exitColour: 1, planXM: 12, planYM: 9 },
      { id: 2n, name: 'Bar', stationId: 2, capacity: 120, exitColour: 5, planXM: 30, planYM: 4 },
    ]),
    settings: table([{ id: 0, yellow: 3, red: 5, lowVis: false }]),
    eventState: table([{ id: 0, ended: false, endedAt: undefined }]),
    boardAttendees: table([
      { nodeId: 21n, displayName: 'Ada Lovelace', bandId: 141, findable: true, crowd: false, organization: 'Analytical', role: 'hacker' },
      { nodeId: 22n, displayName: 'Ada Crowd', bandId: 150, findable: true, crowd: true, organization: '', role: 'attendee' },
      { nodeId: 23n, displayName: 'Grace Hopper', bandId: 0, findable: true, crowd: false, organization: 'Navy', role: 'speaker' },
    ]),
    claimsBoard: table([
      { id: 7n, incidentId: 2n, status: { tag: 'Routed' }, payoutCents: 12_500n, packHash: 'pack-7' },
      { id: 8n, incidentId: 3n, status: { tag: 'Settled' }, payoutCents: 9_000n, packHash: 'pack-8' },
    ]),
    boardCharges: table([
      { id: 31n, incidentId: 4n, attendeeName: 'Ben', status: 'proposed', amountCents: 50_000n },
      { id: 32n, incidentId: 1n, attendeeName: 'Old', status: 'paid', amountCents: 100n },
    ]),
    boardMerchOrders: table([
      { id: 41n, createdAt: ts(START + 10_000), status: 'paid', amountCents: 3_500n },
      { id: 42n, createdAt: ts(START + 20_000), status: 'paying', amountCents: 2_000n },
      { id: 43n, createdAt: ts(START + 30_000), status: 'failed', amountCents: 2_000n },
      { id: 44n, createdAt: ts(START - 30_000), status: 'paid', amountCents: 9_900n },
    ]),
    openIncidents: table([
      { id: 4n, kind: { tag: 'Property' }, status: { tag: 'Open' }, resolved: false, zoneId: 2n, stationId: 2, subjectBand: 0, openedAt: ts(START + 180_000) },
    ]),
  }
}

function fakeConnection(db = tables(), calls = reducers()) {
  const subscribed: string[] = []
  const conn = {
    db,
    reducers: calls,
    subscriptionBuilder() {
      let applied: () => void = () => {}
      const builder = {
        onApplied(cb: () => void) {
          applied = cb
          return builder
        },
        onError() {
          return builder
        },
        subscribe(query: string) {
          subscribed.push(query)
          applied()
          return {}
        },
      }
      return builder
    },
  }
  return { conn: conn as unknown as DbConnection, db, calls, subscribed }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  cleanup()
  dropLink()
  vi.useRealTimers()
  useRun.setState({ focus: null })
  useSession.setState({ phase: 'idle', owner: false, roles: [] })
})

describe('reading the run', () => {
  it('subscribes the run tables one at a time and reads the rows into the store', () => {
    const { conn, subscribed } = fakeConnection()
    attachLink(conn)
    expect(subscribed).toEqual([...RUN_QUERIES])
    const state = useRun.getState()
    expect(state.linked).toBe(true)
    expect(Object.values(state.queries).every((answer) => answer === 'open')).toBe(true)
    expect(state.run?.phase).toBe('running')
    expect(state.run?.seed).toBe('18446744073709551615')
    expect(state.pausedAt).toBeNull()
    expect(state.evacuatingAt).toBeNull()
    expect(state.claims.find((claim) => claim.id === '7')?.status).toBe('routed')
    expect(state.placed).toEqual([expect.objectContaining({ bandId: 92, label: 'Ada' })])
  })

  it('counts this run only: incidents, claims, purchases, charges and people', () => {
    attachLink(fakeConnection().conn)
    const summary = summarize(useRun.getState(), NOW)
    expect(summary.incidents.map((row) => row.incidentId)).toEqual(['4', '3', '2'])
    expect(summary.open).toBe(2)
    expect(summary.nextIn).toBe(30)
    expect(summary.claims).toEqual({ paid: 1, waiting: 1, refused: 1 })
    expect(summary.purchases).toEqual({ paying: 1, paid: 1, failed: 1, salesCents: 3_500 })
    expect(summary.charges).toEqual({ named: 1, waiting: 1, toPay: 0, paid: 0, waived: 0 })
    expect(summary.people).toBe(2)
    expect(summary.line).toBe('Running')
  })

  it('follows a pause and an evacuation as their rows arrive', () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const { conn, db } = fakeConnection()
    attachLink(conn)
    db.livePause.set([{ id: 0, pausedAt: ts(NOW - 10_000), pausedBy: {} }])
    expect(useRun.getState().pausedAt).toBeNull()
    vi.advanceTimersByTime(200)
    let state = useRun.getState()
    expect(state.pausedAt).toBe(NOW - 10_000)
    let summary = summarize(state, NOW)
    expect(summary.paused).toBe(true)
    expect(summary.nextIn).toBeNull()
    expect(summary.line).toMatch(/^Paused since /)

    db.livePause.set([])
    db.liveEvacuation.set([{ id: 0, startedAt: ts(NOW - 5_000), startedBy: {} }])
    vi.advanceTimersByTime(200)
    state = useRun.getState()
    summary = summarize(state, NOW)
    expect(state.pausedAt).toBeNull()
    expect(summary.evacuating).toBe(true)
    expect(summary.line).toMatch(/^Evacuating since .+, everyone walking out$/)

    db.liveRun.set([{ ...db.liveRun.rows[0], phase: { tag: 'Ended' }, endedAt: ts(NOW) }])
    vi.advanceTimersByTime(200)
    expect(useRun.getState().run?.phase).toBe('ended')
  })

  it('words the idle and closing phases as the dev portal does', () => {
    expect(phaseLine(null, null, null)).toBe('Not started')
    const closing = { phase: 'closing' as const, crowd: 1, pace: 1, startedAt: START, endsAt: NOW, closingAt: NOW, endedAt: 0, nextIncidentAt: 0, step: 0, seed: '0' }
    expect(phaseLine(closing, null, null)).toMatch(/^Doors closed at .+, everyone walking out$/)
  })

  it('lets the test bands, placed bands and real bands online go on the map', () => {
    attachLink(fakeConnection().conn)
    const { bands, placed } = useRun.getState()
    expect(placeableBands(bands, placed, NOW)).toEqual([12, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99])
  })

  it('finds wearers among real attendees only', () => {
    attachLink(fakeConnection().conn)
    const { attendees } = useRun.getState()
    expect(wearerMatches(attendees, 'ada').map((person) => person.displayName)).toEqual(['Ada Lovelace'])
    expect(wearerMatches(attendees, '').map((person) => person.displayName)).toEqual(['Ada Lovelace', 'Grace Hopper'])
  })

  it('narrows the decisions to one incident and to every search word', () => {
    attachLink(fakeConnection().conn)
    const { decisions } = useRun.getState()
    expect(shownDecisions(decisions, null, '').rows.map((row) => row.id)).toEqual(['12', '11', '10'])
    expect(shownDecisions(decisions, '2', '').rows.map((row) => row.id)).toEqual(['10'])
    expect(shownDecisions(decisions, null, 'speaker edward').rows.map((row) => row.id)).toEqual(['12'])
  })
})

describe('run reducers', () => {
  it('sends u64 arguments as BigInt and the small ones as numbers', async () => {
    const { conn, calls } = fakeConnection()
    attachLink(conn)

    expect(await startRun({ crowd: 1000, minutes: 12, pace: 8, fresh: true })).toBe(true)
    expect(calls.startLiveRun).toHaveBeenCalledWith({ crowdSize: 1000, minutes: 12, pace: 8, fresh: true, seed: 0n })

    await pauseRun()
    await resumeRun()
    await endRun()
    expect(calls.pauseLiveRun).toHaveBeenCalledWith({})
    expect(calls.resumeLiveRun).toHaveBeenCalledWith({})
    expect(calls.endLiveRun).toHaveBeenCalledWith({})

    await evacuateRun(true)
    await evacuateRun(false)
    expect(calls.evacuateLiveRun.mock.calls).toEqual([[{ on: true }], [{ on: false }]])

    await approveRunClaim({ id: '7', incidentId: '2', status: 'routed', payoutCents: 12_500, packHash: 'pack-7' })
    expect(calls.approveClaim).toHaveBeenCalledWith({ claimId: 7n, amountSeenCents: 12_500n, packHashSeen: 'pack-7' })

    await placeRunBand({ bandId: 92, xM: 10.5, yM: 4, wearer: { nodeId: '0', name: 'Ada' } })
    expect(calls.giveBand).toHaveBeenCalledWith({ bandId: 92, nodeId: 0n, name: 'Ada' })
    expect(calls.placeBand).toHaveBeenCalledWith({ bandId: 92, xM: 10.5, yM: 4, label: 'Ada' })
    expect(calls.giveBand.mock.invocationCallOrder[0]).toBeLessThan(calls.placeBand.mock.invocationCallOrder[0])

    await placeRunBand({ bandId: 93, xM: 1, yM: 2, wearer: null })
    expect(calls.giveBand).toHaveBeenCalledTimes(1)
    expect(calls.placeBand).toHaveBeenLastCalledWith({ bandId: 93, xM: 1, yM: 2, label: '' })

    // Moving a band already on the floor keeps who it was labelled for.
    await placeRunBand({ bandId: 92, xM: 2, yM: 3, wearer: null })
    expect(calls.placeBand).toHaveBeenLastCalledWith({ bandId: 92, xM: 2, yM: 3, label: 'Ada' })

    await unplaceRunBand(92)
    expect(calls.unplaceBand).toHaveBeenCalledWith({ bandId: 92 })
    expect(useRun.getState().error).toBeNull()
  })

  it('refuses a bad start form before it reaches the database', async () => {
    const { conn, calls } = fakeConnection()
    attachLink(conn)
    expect(await startRun({ crowd: 0, minutes: 12, pace: 8, fresh: true })).toBe(false)
    expect(useRun.getState().error).toEqual({ key: 'start', message: 'People must be a whole number from 1 to 2,000.' })
    expect(await placeRunBand({ bandId: 92, xM: Number.NaN, yM: 1, wearer: null })).toBe(false)
    expect(useRun.getState().error?.key).toBe('place')
    expect(calls.startLiveRun).not.toHaveBeenCalled()
    expect(calls.placeBand).not.toHaveBeenCalled()
  })

  it('keeps the database refusal as a message', async () => {
    const { conn, calls } = fakeConnection()
    calls.pauseLiveRun.mockImplementationOnce(() => Promise.reject(new Error('Only organizers can pause the run.')))
    attachLink(conn)
    expect(await pauseRun()).toBe(false)
    expect(useRun.getState().error).toEqual({ key: 'pause', message: 'Only organizers can pause the run.' })
    expect(useRun.getState().busy).toBeNull()
  })

  it('says so when nothing is connected', async () => {
    expect(await endRun()).toBe(false)
    expect(useRun.getState().error).toEqual({ key: 'end', message: 'The database is not connected.' })
  })
})

describe('run page', () => {
  function page() {
    return render(
      <RouteProvider>
        <RunPage />
      </RouteProvider>,
    )
  }

  it('gives no buttons to someone who is not an organizer', () => {
    useSession.setState({ phase: 'live', owner: false, roles: ['medic'] })
    attachLink(fakeConnection().conn)
    page()
    expect(screen.getByText('Only organizers can start, pause, evacuate or end the run.')).toBeInTheDocument()
    expect(screen.getByText('Only organizers can put bands on the map.')).toBeInTheDocument()
    for (const name of [/^pause$/i, /^resume$/i, /^evacuate$/i, /end the event/i, /start the event/i, /^approve/i, /^remove/i, /^place band/i, /low visibility/i, /call off/i]) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
    }
    // The run is still there to read.
    expect(screen.getByText(/^Running: started /)).toBeInTheDocument()
    expect(screen.getByText('1 paid, 1 waiting for the organizer, 1 refused')).toBeInTheDocument()
    expect(screen.getByText('Band 92')).toBeInTheDocument()
  })

  it('offers an organizer the run controls, and evacuates after one confirmation', async () => {
    useSession.setState({ phase: 'live', owner: false, roles: ['ops'] })
    const { conn, calls } = fakeConnection()
    attachLink(conn)
    const user = userEvent.setup()
    page()
    const run = within(screen.getByRole('region', { name: 'Event run' }))
    expect(run.getByRole('button', { name: 'Pause' })).toBeInTheDocument()
    expect(run.getByRole('button', { name: 'End the run' })).toBeInTheDocument()
    expect(run.getByRole('button', { name: 'End the event' })).toBeInTheDocument()
    expect(run.getByRole('button', { name: 'Dim the hall' })).toBeInTheDocument()
    expect(run.getByRole('button', { name: 'Restart the crowd' })).toBeInTheDocument()
    expect(run.getByRole('button', { name: 'Stop the crowd' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Approve claim 7' }).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Remove band 92 from the map' })).toBeInTheDocument()

    await user.click(run.getByRole('button', { name: 'Evacuate' }))
    expect(run.getByText(/nobody comes back in until you call it off/)).toBeInTheDocument()
    expect(calls.evacuateLiveRun).not.toHaveBeenCalled()
    await user.click(run.getByRole('button', { name: 'Evacuate now' }))
    expect(calls.evacuateLiveRun).toHaveBeenCalledWith({ on: true })

    await user.click(run.getByRole('button', { name: 'Dim the hall' }))
    expect(calls.setLowVis).toHaveBeenCalledWith({ on: true })
    await user.click(run.getByRole('button', { name: 'Restart the crowd' }))
    expect(calls.startCrowd).toHaveBeenCalledWith({ size: 1000 })
    await user.click(run.getByRole('button', { name: 'Stop the crowd' }))
    await user.click(run.getByRole('button', { name: 'Stop it' }))
    expect(calls.stopCrowd).toHaveBeenCalledWith({})
  })

  it('shows the start form once the run has ended', async () => {
    useSession.setState({ phase: 'live', owner: true, roles: [] })
    const db = tables()
    db.liveRun.rows[0] = { ...db.liveRun.rows[0], phase: { tag: 'Ended' }, endedAt: ts(NOW) }
    const { conn, calls } = fakeConnection(db)
    attachLink(conn)
    const user = userEvent.setup()
    page()
    const run = within(screen.getByRole('region', { name: 'Event run' }))
    expect(run.getByRole('button', { name: 'Start the event' })).toBeInTheDocument()
    expect(run.getByLabelText('People')).toHaveValue(1000)
    expect(run.getByLabelText('Minutes')).toHaveValue(12)
    expect(run.getByRole('checkbox', { name: /start fresh/i })).toBeChecked()
    expect(run.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument()

    await user.click(run.getByRole('button', { name: 'End the event' }))
    await user.click(run.getByRole('button', { name: 'End it' }))
    expect(calls.endEvent).toHaveBeenCalledWith({})
  })

  it('reopens an ended event from the banner', async () => {
    useSession.setState({ phase: 'live', owner: true, roles: [], eventEnded: true, eventEndedAt: NOW })
    const { conn, calls } = fakeConnection()
    attachLink(conn)
    const user = userEvent.setup()
    page()
    const banner = within(screen.getByRole('region', { name: 'Event ended' }))
    expect(banner.getByText(/The event ended at/)).toBeInTheDocument()
    await user.click(banner.getByRole('button', { name: 'Reopen the event' }))
    expect(calls.reopenEvent).toHaveBeenCalledWith({})
  })
})
