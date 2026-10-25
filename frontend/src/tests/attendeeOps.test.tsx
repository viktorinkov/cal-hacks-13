import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChargePay } from '@/components/attendee/ChargePay'
import { LeaveEvent } from '@/components/attendee/LeaveEvent'
import { MedicTap } from '@/components/attendee/MedicTap'
import { MyIncidents } from '@/components/attendee/MyIncidents'
import { PlanLookup } from '@/components/attendee/PlanLookup'
import { ProfileMatch } from '@/components/attendee/ProfileMatch'
import { ShippingBuy } from '@/components/attendee/ShippingBuy'
import { Socials } from '@/components/attendee/Socials'
import { RouteProvider } from '@/cover/route'
import type { MerchPick } from '@/payments/rows'
import {
  ATTENDEE_QUERIES, assignMedic, buyMerchWithShipping, canFileClaim, claimPerson, fileClaim, leaveEvent, lookUpPlan,
  payCharge, profileCandidates, requestMedicalCard, resetAttendee, saveSocials, useAttendee,
} from '@/stdb/attendeeOps'
import { attachLink, dropLink } from '@/stdb/link'
import type { DbConnection } from '@/stdb/module_bindings'
import { useSession } from '@/stdb/session'

type Row = Record<string, unknown>

const initialSession = useSession.getState()

function table(initial: Row[] = []) {
  let rows = [...initial]
  const listeners: (() => void)[] = []
  return {
    iter: () => rows.values(),
    count: () => rows.length,
    onInsert: (cb: () => void) => { listeners.push(cb) },
    onDelete: (cb: () => void) => { listeners.push(cb) },
    onUpdate: (cb: () => void) => { listeners.push(cb) },
    set(next: Row[]) {
      rows = [...next]
      for (const cb of listeners) cb()
    },
  }
}

type Table = ReturnType<typeof table>

const id = (hex: string) => ({ toHexString: () => hex })
const at = (iso: string) => ({ toDate: () => new Date(iso) })
const enumOf = (variant: string) => ({ tag: variant })

function reducerMocks() {
  const ok = () => vi.fn<(args: Record<string, unknown>) => Promise<unknown>>().mockResolvedValue(undefined)
  return {
    setSocialHandle: ok(),
    removeSocialHandle: ok(),
    claimPerson: ok(),
    lookUpPlan: ok(),
    payCharge: ok(),
    fileClaim: ok(),
    leaveEvent: ok(),
    assignMedic: ok(),
    requestMedicalCard: ok(),
    buyMerchWithShipping: ok(),
  }
}

function link(tables: Partial<Record<string, Table>> = {}, refuse: string[] = []) {
  const queries: string[] = []
  const reducers = reducerMocks()
  const db: Record<string, Table> = {
    myAttendee: table(), myHandles: table(), person: table(), organization: table(), claimedPeople: table(),
    myPlanLookups: table(), myIncidents: table(), myClaims: table(), myMerchShipping: table(), myRoles: table(),
    openIncidents: table(), medicMedicalCards: table(),
    ...tables,
  } as Record<string, Table>
  const conn = {
    db,
    reducers,
    identity: id('c0ffee'),
    subscriptionBuilder() {
      let applied: (() => void) | undefined
      let refused: ((...args: unknown[]) => void) | undefined
      const builder = {
        onApplied(cb: () => void) { applied = cb; return builder },
        onError(cb: (...args: unknown[]) => void) { refused = cb; return builder },
        subscribe(query: string) {
          queries.push(query)
          if (refuse.some((view) => query.endsWith(view))) refused?.({}, new Error(`No access to ${query.slice(14)}.`))
          else applied?.()
          return {}
        },
      }
      return builder
    },
  }
  attachLink(conn as unknown as DbConnection)
  return { db, queries, reducers }
}

const attendeeRow = (extra: Row = {}): Row => ({
  identity: id('c0ffee'), nodeId: 41n, displayName: 'Nia Ito', photoUrl: '', findable: true, personId: 0n, organizationId: 0n,
  crowd: false, createdAt: at('2026-10-25T19:00:00'), updatedAt: at('2026-10-25T19:00:00'), ...extra,
})

const sosOn = (band: number, extra: Row = {}): Row => ({
  id: 3n, kind: enumOf('Sos'), status: enumOf('Open'), resolved: false, zoneId: 2n, stationId: 1, subjectBand: band,
  openedBy: 'band', openedAt: at('2026-10-25T21:40:00'), lastSignalAt: at('2026-10-25T21:40:00'), assignedMedic: undefined,
  resolvedAt: undefined, resolvedBy: undefined, resolution: '', visionStatus: '', ...extra,
})

const pick: MerchPick = {
  key: '4:7', nodeId: '', attendeeName: '', rank: 1, templateId: '4', photoId: '7', photoUrl: '', title: 'Cal Hacks tee', kind: 'tee',
  priceCents: 2_500, imageUrl: '', area: { width: 0, height: 0, x: 0, y: 0, w: 0, h: 0 }, line: '', reason: '', friends: [],
}

function deferred() {
  let resolve: (value?: unknown) => void = () => {}
  let reject: (error: unknown) => void = () => {}
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

const inRoute = (node: React.ReactNode) => render(<RouteProvider>{node}</RouteProvider>)

afterEach(() => {
  cleanup()
  dropLink()
  resetAttendee()
  useSession.setState(initialSession, true)
})

describe('reading the attendee views', () => {
  it('subscribes each view once and reads every row into the store', async () => {
    const { db, queries } = link({
      myAttendee: table([attendeeRow()]),
      myHandles: table([{ id: 1n, owner: id('c0ffee'), platform: 'instagram', handle: '@nia', updatedAt: at('2026-10-25T19:00:00') }]),
      person: table([{ id: 21n, displayName: 'Nia Okafor', kind: 'speaker', role: '', title: 'Engineer', organizationId: 5n, bio: '', headshotUrl: '', links: ['https://x.test'], sourceUrl: '' }]),
      organization: table([{ id: 5n, name: 'Northline' }]),
      claimedPeople: table([{ personId: 30n }]),
      myPlanLookups: table([{
        id: 2n, kind: 'health', insurer: 'Blue Shield', plan: 'Silver 70 PPO', state: 'CA', limitCents: 500_000n, deductibleCents: 25_000n,
        status: 'found', sourceUrl: 'https://plans.test/sbc.pdf', printedInsurer: 'Blue Shield of California', printedPlan: 'Silver 70 PPO',
        planYear: '2026', note: '', createdAt: at('2026-10-25T19:10:00'), updatedAt: at('2026-10-25T19:11:00'), reusedFrom: 0n,
        matchedChunk: { tag: 'some', value: { chunkId: 'c1', page: 3, text: 'Emergency room: $250 copay', score: 0.9 } },
      }]),
      myIncidents: table([{ incidentId: 9n, kind: 'fall', zoneName: 'Main hall', openedAt: at('2026-10-25T21:40:00'), resolved: true, resolvedAt: at('2026-10-25T21:55:00'), resolution: 'Seen by a medic', claimId: 0n }]),
      myClaims: table([{ id: 15n, incidentKind: 'sos', zoneName: 'Sponsor row', status: enumOf('Routed'), statusNote: '', payoutCents: 12_000n, payoutReference: '', openedAt: at('2026-10-25T20:00:00'), settledAt: undefined, incidentId: 8n, statement: 'I was pushed.' }]),
      myMerchShipping: table([{ orderId: 70n, shippingAddress: 'Nia Ito\n1 Main St' }]),
      myRoles: table([{ id: 1n, identity: id('c0ffee'), role: 'medic', label: 'Nia', grantedBy: id('aa'), grantedAt: at('2026-10-25T18:00:00') }]),
      openIncidents: table([sosOn(94, { assignedMedic: id('beef') })]),
      medicMedicalCards: table([{ incidentId: 3n, bandId: 94, name: 'Sam Lee', card: { attendee: id('dd'), bloodType: 'O+', allergies: ['Peanuts'], conditions: [], medications: ['Inhaler'], emergencyContact: 'Ana 415-555-0101', insurer: 'Blue Shield', plan: 'Silver', memberId: 'M1', groupNumber: 'G1', insurerPhone: '', notes: '', status: 'confirmed', updatedAt: at('2026-10-25T19:00:00') } }]),
    })

    expect(queries).toEqual([...ATTENDEE_QUERIES])
    const state = useAttendee.getState()
    expect(Object.keys(state.applied).sort()).toEqual(ATTENDEE_QUERIES.map((query) => query.slice(14)).sort())
    expect(state.me).toBe('c0ffee')
    expect(state.attendee).toMatchObject({ nodeId: '41', displayName: 'Nia Ito', personId: '0', findable: true })
    expect(state.handles).toEqual([{ platform: 'instagram', handle: '@nia' }])
    expect(state.people[0]).toMatchObject({ id: '21', organizationId: '5', links: ['https://x.test'] })
    expect(state.claimedPeople).toEqual(['30'])
    expect(state.planLookups[0]).toMatchObject({ id: '2', status: 'found', limitCents: 500_000, matchedChunk: { page: 3, text: 'Emergency room: $250 copay' } })
    expect(state.incidents[0]).toMatchObject({ incidentId: '9', kind: 'fall', resolved: true, claimId: '0' })
    expect(state.claims[0]).toMatchObject({ id: '15', status: 'routed', payoutCents: 12_000, incidentId: '8', settledAt: 0 })
    expect(state.shipping).toEqual({ '70': 'Nia Ito\n1 Main St' })
    expect(state.roles).toEqual(['medic'])
    expect(state.openIncidents[0]).toMatchObject({ id: '3', kind: 'sos', status: 'open', subjectBand: 94, assignedMedic: 'beef' })
    expect(state.medicCards[0]).toMatchObject({ incidentId: '3', bandId: 94, card: { bloodType: 'O+', allergies: ['Peanuts'] } })

    db.myAttendee.set([attendeeRow({ personId: 21n })])
    await act(async () => { await Promise.resolve() })
    expect(useAttendee.getState().attendee?.personId).toBe('21')
  })

  it('keeps the refusal of a view and still subscribes the rest', () => {
    const { queries } = link({}, ['medic_medical_cards', 'my_roles'])
    expect(queries).toHaveLength(ATTENDEE_QUERIES.length)
    expect(useAttendee.getState().refused).toEqual({
      my_roles: 'No access to my_roles.',
      medic_medical_cards: 'No access to medic_medical_cards.',
    })
    expect(useAttendee.getState().applied.my_attendee).toBe(true)
  })

  it('forgets everything when the socket closes', () => {
    link({ myAttendee: table([attendeeRow()]) })
    expect(useAttendee.getState().attendee).not.toBeNull()
    dropLink()
    expect(useAttendee.getState()).toMatchObject({ linked: false, attendee: null, applied: {} })
  })
})

describe('calling the reducers', () => {
  it('sends u64 arguments as bigint and the band id as a number', async () => {
    const { reducers } = link({
      myHandles: table([{ id: 1n, owner: id('c0ffee'), platform: 'facebook', handle: 'nia.ito', updatedAt: at('2026-10-25T19:00:00') }]),
    })

    expect(await saveSocials({ instagram: ' @nia ', facebook: '', threads: 'https://threads.net/@nia.i' })).toBe(true)
    expect(reducers.setSocialHandle.mock.calls).toEqual([[{ platform: 'instagram', handle: 'nia' }], [{ platform: 'threads', handle: 'nia.i' }]])
    expect(reducers.removeSocialHandle).toHaveBeenCalledWith({ platform: 'facebook' })

    await claimPerson('21')
    expect(reducers.claimPerson).toHaveBeenCalledWith({ personId: 21n })

    await lookUpPlan(' Blue Shield ', 'Silver 70 PPO', 'ca')
    expect(reducers.lookUpPlan).toHaveBeenCalledWith({ insurer: 'Blue Shield', plan: 'Silver 70 PPO', state: 'CA' })

    await payCharge('5')
    expect(reducers.payCharge).toHaveBeenCalledWith({ chargeId: 5n })

    await fileClaim('9', '  I slipped by the stage.  ')
    expect(reducers.fileClaim).toHaveBeenCalledWith({ incidentId: 9n, statement: 'I slipped by the stage.' })

    await leaveEvent()
    expect(reducers.leaveEvent).toHaveBeenCalledWith({})

    await assignMedic('3')
    expect(reducers.assignMedic).toHaveBeenCalledWith({ incidentId: 3n })

    await requestMedicalCard(94)
    expect(reducers.requestMedicalCard).toHaveBeenCalledWith({ bandId: 94 })
    expect(typeof reducers.requestMedicalCard.mock.calls[0][0].bandId).toBe('number')
    expect(useAttendee.getState().cardRequests[94]).toEqual({ state: 'granted', message: '' })

    await buyMerchWithShipping('4', '7', 'M', 'Nia Ito\n1 Main St\nSan Francisco, CA 94107\nUnited States')
    expect(reducers.buyMerchWithShipping).toHaveBeenCalledWith({
      templateId: 4n, photoId: 7n, size: 'M', shippingAddress: 'Nia Ito\n1 Main St\nSan Francisco, CA 94107\nUnited States',
    })

    for (const call of [reducers.claimPerson, reducers.payCharge, reducers.fileClaim, reducers.assignMedic]) {
      const args = call.mock.calls[0][0]
      for (const value of Object.values(args)) if (typeof value !== 'string') expect(typeof value).toBe('bigint')
    }
  })

  it('refuses bad input before it reaches the database', async () => {
    const { reducers } = link()
    expect(await lookUpPlan('Blue Shield', 'Silver', 'California')).toBe(false)
    expect(useAttendee.getState().errors['plan-lookup']).toBe('Use the two-letter state, like CA.')
    expect(await buyMerchWithShipping('4', '7', 'M', '   ')).toBe(false)
    expect(await fileClaim('9', '   ')).toBe(false)
    expect(reducers.lookUpPlan).not.toHaveBeenCalled()
    expect(reducers.buyMerchWithShipping).not.toHaveBeenCalled()
    expect(reducers.fileClaim).not.toHaveBeenCalled()
  })

  it('says the database is not connected when there is no socket', async () => {
    expect(await payCharge('5')).toBe(false)
    expect(useAttendee.getState().errors['pay:5']).toBe('The database is not connected.')
  })
})

describe('paying a charge', () => {
  it('only offers pay on an approved charge, shows the pending state and the refusal', async () => {
    const { reducers } = link()
    const answer = deferred()
    reducers.payCharge.mockReturnValueOnce(answer.promise)
    const { rerender } = render(<ChargePay charge={{ id: '5', status: 'disputed', paidAt: null }} />)
    expect(screen.getByText('Disputed. The organizer looks at it again.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pay from wallet' })).toBeNull()

    rerender(<ChargePay charge={{ id: '5', status: 'approved', paidAt: null }} />)
    expect(screen.getByText('To pay. Nothing leaves your wallet until you press pay.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Pay from wallet' }))
    expect(screen.getByRole('button', { name: 'Paying…' })).toBeDisabled()
    await act(async () => { answer.reject(new Error('Your wallet is short by $12.00.')) })
    expect(await screen.findByRole('alert')).toHaveTextContent('Your wallet is short by $12.00.')
    expect(reducers.payCharge).toHaveBeenCalledWith({ chargeId: 5n })
  })
})

describe('the medic tap', () => {
  const card = { incidentId: 3n, bandId: 94, name: 'Sam Lee', card: { attendee: id('dd'), bloodType: 'O+', allergies: ['Peanuts', 'Latex'], conditions: [], medications: [], emergencyContact: 'Ana 415-555-0101', insurer: '', plan: '', memberId: '', groupNumber: '', insurerPhone: '', notes: '', status: 'pending', updatedAt: at('2026-10-25T19:00:00') } }
  const medic = () => table([{ id: 1n, identity: id('c0ffee'), role: 'medic', label: 'Nia', grantedBy: id('aa'), grantedAt: at('2026-10-25T18:00:00') }])
  const ops = () => table([{ id: 2n, identity: id('c0ffee'), role: 'ops', label: 'Ops', grantedBy: id('aa'), grantedAt: at('2026-10-25T18:00:00') }])

  it('stays hidden without the medic role, even with an open incident on the band', () => {
    const { reducers } = link({ myRoles: ops(), openIncidents: table([sosOn(94)]) })
    inRoute(<MedicTap bandId={94} />)
    expect(screen.queryByText(/Medic view/)).toBeNull()
    expect(reducers.requestMedicalCard).not.toHaveBeenCalled()
  })

  it('stays hidden for a medic when the band has no open incident', () => {
    const { reducers } = link({
      myRoles: medic(),
      openIncidents: table([
        sosOn(12),
        sosOn(94, { id: 4n, resolved: true, status: enumOf('Resolved') }),
        sosOn(94, { id: 5n, kind: enumOf('Theft') }),
      ]),
    })
    inRoute(<MedicTap bandId={94} />)
    expect(screen.queryByText(/Medic view/)).toBeNull()
    expect(reducers.requestMedicalCard).not.toHaveBeenCalled()
  })

  it('shows a medic the incident, takes it, and shows the card only while it is open', async () => {
    const { db, reducers } = link({ myRoles: medic(), openIncidents: table([sosOn(94)]) })
    inRoute(<MedicTap bandId={94} />)
    expect(screen.getByRole('heading', { name: 'Medic view: band 94' })).toBeInTheDocument()
    expect(screen.getByText(/SOS incident 3, open/)).toBeInTheDocument()
    await waitFor(() => expect(reducers.requestMedicalCard).toHaveBeenCalledWith({ bandId: 94 }))
    expect(await screen.findByText('Opening the medical card…')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Take it' }))
    expect(reducers.assignMedic).toHaveBeenCalledWith({ incidentId: 3n })

    await act(async () => {
      db.openIncidents.set([sosOn(94, { status: enumOf('Responding'), assignedMedic: id('c0ffee') })])
      db.medicMedicalCards.set([card])
      await Promise.resolve()
    })
    expect(screen.getByText('You have it.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Medical card: Sam Lee, band 94 (not yet confirmed by the wearer)' })).toBeInTheDocument()
    expect(screen.getByText('Peanuts; Latex')).toBeInTheDocument()

    await act(async () => {
      db.openIncidents.set([sosOn(94, { status: enumOf('Resolved'), resolved: true })])
      await Promise.resolve()
    })
    expect(screen.queryByText(/Medical card/)).toBeNull()
    expect(screen.queryByText(/Medic view/)).toBeNull()
  })

  it('says nobody wears the band when the database says so, and asks again', async () => {
    const { reducers } = link({ myRoles: medic(), openIncidents: table([sosOn(94)]) })
    reducers.requestMedicalCard.mockRejectedValueOnce(new Error('nobody wears band 94'))
    inRoute(<MedicTap bandId={94} />)
    expect(await screen.findByText('Nobody wears band 94.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Tap again' }))
    expect(reducers.requestMedicalCard).toHaveBeenCalledTimes(2)
  })
})

describe('incidents and claims', () => {
  const incident = (extra: Row = {}): Row => ({
    incidentId: 9n, kind: 'fall', zoneName: 'Main hall', openedAt: at('2026-10-25T21:40:00'), resolved: true,
    resolvedAt: at('2026-10-25T21:55:00'), resolution: '', claimId: 0n, ...extra,
  })

  it('only lets a claim be filed for a closed incident without one', () => {
    const base = { incidentId: '9', kind: 'fall', zoneName: '', openedAt: 0, resolved: true, resolvedAt: 0, resolution: '', claimId: '0' }
    expect(canFileClaim(base, [])).toBe(true)
    expect(canFileClaim({ ...base, claimId: '15' }, [])).toBe(false)
    expect(canFileClaim({ ...base, resolved: false }, [])).toBe(false)
    expect(canFileClaim({ ...base, kind: 'theft' }, [])).toBe(false)
    expect(canFileClaim(base, [{ id: '15', incidentId: '9', incidentKind: 'fall', zoneName: '', status: 'routed', statusNote: '', payoutCents: 0, payoutReference: '', openedAt: 0, settledAt: 0, statement: '' }])).toBe(false)
  })

  it('offers the form for an incident without a claim and none for one that has a claim', async () => {
    const { reducers } = link({
      myIncidents: table([incident(), incident({ incidentId: 8n, kind: 'sos', zoneName: 'Sponsor row', claimId: 15n })]),
      myClaims: table([{ id: 15n, incidentKind: 'sos', zoneName: 'Sponsor row', status: enumOf('Settled'), statusNote: '', payoutCents: 12_000n, payoutReference: 'p1', openedAt: at('2026-10-25T20:00:00'), settledAt: at('2026-10-25T20:30:00'), incidentId: 8n, statement: 'I was pushed.' }]),
    })
    render(<MyIncidents />)
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
    expect(screen.getByText(/Your band flagged a fall at the Main hall at/)).toBeInTheDocument()
    expect(screen.queryByText(/Your band flagged a call for help/)).toBeNull()
    expect(screen.getByRole('heading', { name: 'Your claim' })).toBeInTheDocument()
    expect(screen.getByText('Paid $120.00 into your wallet')).toBeInTheDocument()
    expect(screen.getByText('You said: “I was pushed.”')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Ask the venue to pay' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Tell us what happened first.')
    await userEvent.type(screen.getByLabelText('What happened'), 'I slipped on a cable and hurt my wrist.')
    await userEvent.click(screen.getByRole('button', { name: 'Ask the venue to pay' }))
    expect(reducers.fileClaim).toHaveBeenCalledWith({ incidentId: 9n, statement: 'I slipped on a cable and hurt my wrist.' })
  })

  it('says staff are on an open incident and offers no form yet', () => {
    link({ myIncidents: table([incident({ resolved: false, resolvedAt: undefined })]) })
    render(<MyIncidents />)
    expect(screen.getByText(/Staff are on it\. Once it is closed you can ask the venue to pay\./)).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('shows the database refusal when a claim is turned down', async () => {
    const { reducers } = link({ myIncidents: table([incident()]) })
    reducers.fileClaim.mockRejectedValueOnce(new Error('A claim for this incident is already open.'))
    render(<MyIncidents />)
    await userEvent.type(screen.getByLabelText('What happened'), 'I fell.')
    await userEvent.click(screen.getByRole('button', { name: 'Ask the venue to pay' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('A claim for this incident is already open.')
  })
})

describe('the attendee sections', () => {
  it('saves socials on Enter without submitting the form around them', async () => {
    const { reducers } = link({ myAttendee: table([attendeeRow()]) })
    const outer = vi.fn((event: React.FormEvent) => event.preventDefault())
    render(<form onSubmit={outer}><Socials bare /></form>)
    await userEvent.type(screen.getByLabelText('Instagram'), '@nia{Enter}')
    await waitFor(() => expect(reducers.setSocialHandle).toHaveBeenCalledWith({ platform: 'instagram', handle: 'nia' }))
    expect(outer).not.toHaveBeenCalled()
  })

  it('asks "is this you?" with unclaimed people who share a name, and claims one', async () => {
    const people = [
      { id: 21n, displayName: 'Nia Okafor', kind: 'speaker', role: '', title: 'Engineer', organizationId: 5n, bio: '', headshotUrl: '', links: [], sourceUrl: '' },
      { id: 30n, displayName: 'Ken Ito', kind: 'judge', role: '', title: '', organizationId: 0n, bio: '', headshotUrl: '', links: [], sourceUrl: '' },
      { id: 31n, displayName: 'Bo Chen', kind: 'hacker', role: '', title: '', organizationId: 0n, bio: '', headshotUrl: '', links: [], sourceUrl: '' },
    ]
    const { reducers } = link({
      myAttendee: table([attendeeRow()]),
      person: table(people),
      organization: table([{ id: 5n, name: 'Northline' }]),
      claimedPeople: table([{ personId: 30n }]),
    })
    const state = useAttendee.getState()
    expect(profileCandidates(state.attendee, state.people, state.claimedPeople).map((person) => person.id)).toEqual(['21'])

    render(<ProfileMatch />)
    expect(screen.getByRole('heading', { name: 'Are you one of these?' })).toBeInTheDocument()
    expect(screen.getByText('Engineer, Northline (speaker)')).toBeInTheDocument()
    expect(screen.queryByText('Ken Ito')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'This is me: Nia Okafor' }))
    expect(reducers.claimPerson).toHaveBeenCalledWith({ personId: 21n })
  })

  it('reads a plan lookup the way the band page does', async () => {
    const lookup = (extra: Row): Row => ({
      id: 2n, kind: 'health', insurer: 'Blue Shield', plan: 'Silver 70 PPO', state: 'CA', limitCents: 0n, deductibleCents: 0n, status: 'searching',
      sourceUrl: '', printedInsurer: '', printedPlan: '', planYear: '', note: '', createdAt: at('2026-10-25T19:10:00'), updatedAt: at('2026-10-25T19:10:00'),
      reusedFrom: 0n, matchedChunk: undefined, ...extra,
    })
    const { db, reducers } = link({ myAttendee: table([attendeeRow()]), myPlanLookups: table([lookup({})]) })
    render(<PlanLookup />)
    expect(screen.getByText('Looking up your plan…')).toBeInTheDocument()
    expect(screen.getByLabelText('Insurer')).toHaveValue('Blue Shield')

    await act(async () => {
      db.myPlanLookups.set([lookup({ status: 'found', printedInsurer: 'Blue Shield of California', printedPlan: 'Silver 70 PPO', planYear: '2026', sourceUrl: 'https://plans.test/sbc.pdf', matchedChunk: { chunkId: 'c1', page: 3, text: 'Emergency room: $250 copay', score: 0.9 } })])
      await Promise.resolve()
    })
    expect(screen.getByText(/Plan found:/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'read it' })).toHaveAttribute('href', 'https://plans.test/sbc.pdf')
    expect(screen.getByText('Page 3: “Emergency room: $250 copay”')).toBeInTheDocument()

    await act(async () => {
      db.myPlanLookups.set([lookup({ id: 3n, status: 'not_found' })])
      await Promise.resolve()
    })
    expect(screen.getByText('We couldn’t find your plan’s documents online. Upload your insurance card instead.')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Plan state'), { target: { value: 'ny' } })
    await userEvent.click(screen.getByRole('button', { name: 'Look it up' }))
    expect(reducers.lookUpPlan).toHaveBeenCalledWith({ insurer: 'Blue Shield', plan: 'Silver 70 PPO', state: 'NY' })
  })

  it('buys merch with a size and a shipping address', async () => {
    const { reducers } = link({ myAttendee: table([attendeeRow()]) })
    useSession.setState({ wallet: { accountId: 'acct-0007', balanceCents: 6_000 } })
    const done = vi.fn()
    inRoute(<ShippingBuy pick={pick} onDone={done} />)
    await userEvent.click(screen.getByRole('button', { name: /Buy for/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Add the recipient and the full mailing address.')
    await userEvent.click(screen.getByText('L'))
    await userEvent.type(screen.getByLabelText('Shipping address'), 'Nia Ito{Enter}1 Main St')
    await userEvent.click(screen.getByRole('button', { name: /Buy for/ }))
    expect(reducers.buyMerchWithShipping).toHaveBeenCalledWith({ templateId: 4n, photoId: 7n, size: 'L', shippingAddress: 'Nia Ito\n1 Main St' })
    await waitFor(() => expect(done).toHaveBeenCalled())
  })

  it('will not buy before the wallet opens', () => {
    link({ myAttendee: table([attendeeRow()]) })
    useSession.setState({ wallet: null })
    inRoute(<ShippingBuy pick={pick} />)
    expect(screen.getByRole('button', { name: /Buy for/ })).toBeDisabled()
    expect(screen.getByText('Your wallet opens with your band. You can buy once it does.')).toBeInTheDocument()
  })

  it('asks once before leaving the event, then calls leave_event', async () => {
    const { reducers } = link({ myAttendee: table([attendeeRow()]) })
    useSession.setState({ eventEnded: false, departure: null })
    render(<LeaveEvent />)
    await userEvent.click(screen.getByRole('button', { name: 'Leave the event' }))
    expect(screen.getByText('Leave the event now? Your band stops and your recap opens.')).toBeInTheDocument()
    expect(reducers.leaveEvent).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Leave now' }))
    expect(reducers.leaveEvent).toHaveBeenCalledWith({})
  })

  it('hides leaving once the night is over', () => {
    link({ myAttendee: table([attendeeRow()]) })
    useSession.setState({ eventEnded: true })
    render(<LeaveEvent />)
    expect(screen.queryByRole('button', { name: 'Leave the event' })).toBeNull()
  })
})
