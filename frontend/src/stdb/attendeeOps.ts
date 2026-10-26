/**
 * The attendee's own actions on the band page and the wallet, beside the session. The session holds
 * the socket and reads the tables the wallet and the recap need. This module subscribes the views the
 * session leaves off, reads them into a store, and calls the reducers the band page needs: socials,
 * "is this you?", the plan lookup, filing a claim, paying a charge, leaving the event, the medic tap
 * and merch with a shipping address.
 */
import { useMemo } from 'react'
import { create } from 'zustand'
import type { DbConnection } from './module_bindings'
import { hexOf, linkDb, linkReducers, messageOf, millisOf, num, onLink, rowsOf, someOf, subscribeEach, tag, text, watchTables } from './link'

export const ATTENDEE_QUERIES = [
  'SELECT * FROM my_attendee',
  'SELECT * FROM my_claims',
  'SELECT * FROM my_incidents',
  'SELECT * FROM my_plan_lookups',
  'SELECT * FROM claimed_people',
  'SELECT * FROM my_merch_shipping',
  'SELECT * FROM my_roles',
  // The session asks for this one only for staff, late in a list. A medic's tap needs it at once.
  'SELECT * FROM open_incidents',
  // Last: this view can hang for a visitor who is not a medic, and each view waits up to four seconds.
  'SELECT * FROM medic_medical_cards',
] as const

/** Every table this store reads, by client accessor. Some arrive on the session's own subscriptions. */
const WATCHED = [
  'myAttendee', 'myHandles', 'person', 'organization', 'claimedPeople', 'myPlanLookups', 'myIncidents',
  'myClaims', 'myMerchShipping', 'myRoles', 'openIncidents', 'medicMedicalCards',
] as const

const ACTION_TIMEOUT_MS = 15_000

export interface Attendee {
  identity: string
  nodeId: string
  displayName: string
  photoUrl: string
  findable: boolean
  personId: string
  organizationId: string
  crowd: boolean
}

export interface SocialHandle {
  platform: string
  handle: string
}

export interface EventPerson {
  id: string
  displayName: string
  kind: string
  role: string
  title: string
  organizationId: string
  bio: string
  headshotUrl: string
  links: string[]
  sourceUrl: string
}

export interface Organization {
  id: string
  name: string
}

export interface PlanChunk {
  chunkId: string
  page: number
  text: string
  score: number
}

export interface PlanLookup {
  id: string
  kind: string
  insurer: string
  plan: string
  state: string
  limitCents: number
  deductibleCents: number
  status: string
  sourceUrl: string
  printedInsurer: string
  printedPlan: string
  planYear: string
  note: string
  createdAt: number
  updatedAt: number
  reusedFrom: string
  matchedChunk: PlanChunk | null
}

export interface MyIncident {
  incidentId: string
  kind: string
  zoneName: string
  openedAt: number
  resolved: boolean
  resolvedAt: number
  resolution: string
  /** "0" until a claim is filed for it. */
  claimId: string
}

export interface MyClaim {
  id: string
  incidentId: string
  incidentKind: string
  zoneName: string
  /** The ClaimStatus variant, lowercased: awaitingrecord, reviewing, routed, paying, settled... */
  status: string
  statusNote: string
  payoutCents: number
  payoutReference: string
  openedAt: number
  settledAt: number
  statement: string
}

export interface OpenIncident {
  id: string
  /** sos, fall, property, theft or breakage. */
  kind: string
  /** open, responding or resolved. */
  status: string
  resolved: boolean
  zoneId: string
  subjectBand: number
  openedBy: string
  openedAt: number
  /** The assigned medic's identity in hex, or empty. */
  assignedMedic: string
}

export interface MedicalFacts {
  bloodType: string
  allergies: string[]
  conditions: string[]
  medications: string[]
  emergencyContact: string
  insurer: string
  plan: string
  memberId: string
  groupNumber: string
  insurerPhone: string
  notes: string
  status: string
}

export interface MedicCard {
  incidentId: string
  bandId: number
  name: string
  card: MedicalFacts | null
}

export type CardRequest = { state: 'asking' | 'granted' | 'refused'; message: string }

interface AttendeeState {
  linked: boolean
  /** This socket's identity in hex. */
  me: string
  /** Views that answered, by view name (my_attendee). */
  applied: Record<string, true>
  /** Views that were refused, by view name, with the database's reason. */
  refused: Record<string, string>
  attendee: Attendee | null
  handles: SocialHandle[]
  people: EventPerson[]
  organizations: Organization[]
  claimedPeople: string[]
  planLookups: PlanLookup[]
  incidents: MyIncident[]
  claims: MyClaim[]
  /** Shipping address by merch order id. */
  shipping: Record<string, string>
  roles: string[]
  openIncidents: OpenIncident[]
  medicCards: MedicCard[]
  /** Actions in flight, by action key. */
  pending: Record<string, true>
  /** The last refusal of each action, by action key. */
  errors: Record<string, string>
  /** The medic's card request for each band. */
  cardRequests: Record<number, CardRequest>
}

const EMPTY = {
  linked: false,
  me: '',
  applied: {},
  refused: {},
  attendee: null,
  handles: [],
  people: [],
  organizations: [],
  claimedPeople: [],
  planLookups: [],
  incidents: [],
  claims: [],
  shipping: {},
  roles: [],
  openIncidents: [],
  medicCards: [],
  pending: {},
  errors: {},
  cardRequests: {},
} satisfies AttendeeState

export const useAttendee = create<AttendeeState>(() => ({ ...EMPTY }))

/** Back to nothing read. Tests and a closed socket both use it. */
export function resetAttendee(): void {
  useAttendee.setState({ ...EMPTY }, false)
}

/** The reducers this module calls. camelCase names and keys; u64 is bigint, u8 a number. */
export type AttendeeReducers = {
  setSocialHandle(args: { platform: string; handle: string }): Promise<unknown>
  removeSocialHandle(args: { platform: string }): Promise<unknown>
  claimPerson(args: { personId: bigint }): Promise<unknown>
  lookUpPlan(args: { insurer: string; plan: string; state: string }): Promise<unknown>
  payCharge(args: { chargeId: bigint }): Promise<unknown>
  fileClaim(args: { incidentId: bigint; statement: string }): Promise<unknown>
  leaveEvent(args: Record<string, never>): Promise<unknown>
  assignMedic(args: { incidentId: bigint }): Promise<unknown>
  requestMedicalCard(args: { bandId: number }): Promise<unknown>
  buyMerchWithShipping(args: { templateId: bigint; photoId: bigint; size: string; shippingAddress: string }): Promise<unknown>
}

/* ---------- reading rows ---------- */

function idOf(value: unknown): string {
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'number') return Number.isFinite(value) ? String(Math.trunc(value)) : '0'
  return text(value) || '0'
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : []
}

function viewName(query: string): string {
  return query.replace(/^SELECT \* FROM\s+/i, '').trim()
}

function readFacts(value: unknown): MedicalFacts | null {
  const row = someOf(value)
  if (!row || typeof row !== 'object') return null
  const card = row as Record<string, unknown>
  return {
    bloodType: text(card.bloodType),
    allergies: strings(card.allergies),
    conditions: strings(card.conditions),
    medications: strings(card.medications),
    emergencyContact: text(card.emergencyContact),
    insurer: text(card.insurer),
    plan: text(card.plan),
    memberId: text(card.memberId),
    groupNumber: text(card.groupNumber),
    insurerPhone: text(card.insurerPhone),
    notes: text(card.notes),
    status: text(card.status),
  }
}

function readChunk(value: unknown): PlanChunk | null {
  const chunk = someOf(value)
  if (!chunk || typeof chunk !== 'object') return null
  const row = chunk as Record<string, unknown>
  return { chunkId: text(row.chunkId), page: num(row.page), text: text(row.text), score: num(row.score) }
}

/** Read every watched table on the current socket into the store. */
export function readAttendee(): void {
  const db = linkDb()
  if (!db) return
  const attendeeRow = rowsOf(db.myAttendee)[0]
  const attendee: Attendee | null = attendeeRow ? {
    identity: hexOf(attendeeRow.identity),
    nodeId: idOf(attendeeRow.nodeId),
    displayName: text(attendeeRow.displayName),
    photoUrl: text(attendeeRow.photoUrl),
    findable: attendeeRow.findable === true,
    personId: idOf(attendeeRow.personId),
    organizationId: idOf(attendeeRow.organizationId),
    crowd: attendeeRow.crowd === true,
  } : null
  const handles = rowsOf(db.myHandles)
    .map((row) => ({ platform: text(row.platform).toLowerCase(), handle: text(row.handle) }))
    .filter((row) => row.platform && row.handle)
  const people: EventPerson[] = rowsOf(db.person).map((row) => ({
    id: idOf(row.id),
    displayName: text(row.displayName),
    kind: text(row.kind),
    role: text(row.role),
    title: text(row.title),
    organizationId: idOf(row.organizationId),
    bio: text(row.bio),
    headshotUrl: text(row.headshotUrl),
    links: strings(row.links),
    sourceUrl: text(row.sourceUrl),
  }))
  const organizations: Organization[] = rowsOf(db.organization).map((row) => ({ id: idOf(row.id), name: text(row.name) }))
  const claimedPeople = rowsOf(db.claimedPeople).map((row) => idOf(row.personId))
  const planLookups: PlanLookup[] = rowsOf(db.myPlanLookups).map((row) => ({
    id: idOf(row.id),
    kind: text(row.kind),
    insurer: text(row.insurer),
    plan: text(row.plan),
    state: text(row.state),
    limitCents: num(row.limitCents),
    deductibleCents: num(row.deductibleCents),
    status: text(row.status),
    sourceUrl: text(row.sourceUrl),
    printedInsurer: text(row.printedInsurer),
    printedPlan: text(row.printedPlan),
    planYear: text(row.planYear),
    note: text(row.note),
    createdAt: millisOf(row.createdAt),
    updatedAt: millisOf(row.updatedAt),
    reusedFrom: idOf(row.reusedFrom),
    matchedChunk: readChunk(row.matchedChunk),
  }))
  const incidents: MyIncident[] = rowsOf(db.myIncidents)
    .map((row) => ({
      incidentId: idOf(row.incidentId),
      kind: text(row.kind).toLowerCase(),
      zoneName: text(row.zoneName),
      openedAt: millisOf(row.openedAt),
      resolved: row.resolved === true,
      resolvedAt: millisOf(row.resolvedAt),
      resolution: text(row.resolution),
      claimId: idOf(row.claimId),
    }))
    .sort((a, b) => compareIds(a.incidentId, b.incidentId))
  const claims: MyClaim[] = rowsOf(db.myClaims)
    .map((row) => ({
      id: idOf(row.id),
      incidentId: idOf(row.incidentId),
      incidentKind: text(row.incidentKind).toLowerCase(),
      zoneName: text(row.zoneName),
      status: tag(row.status),
      statusNote: text(row.statusNote),
      payoutCents: num(row.payoutCents),
      payoutReference: text(row.payoutReference),
      openedAt: millisOf(row.openedAt),
      settledAt: millisOf(row.settledAt),
      statement: text(row.statement),
    }))
    .sort((a, b) => compareIds(a.id, b.id))
  const shipping: Record<string, string> = {}
  for (const row of rowsOf(db.myMerchShipping)) shipping[idOf(row.orderId)] = text(row.shippingAddress)
  const roles = rowsOf(db.myRoles).map((row) => text(row.role)).filter(Boolean)
  const openIncidents: OpenIncident[] = rowsOf(db.openIncidents).map((row) => ({
    id: idOf(row.id),
    kind: tag(row.kind),
    status: tag(row.status),
    resolved: row.resolved === true,
    zoneId: idOf(row.zoneId),
    subjectBand: num(row.subjectBand),
    openedBy: text(row.openedBy),
    openedAt: millisOf(row.openedAt),
    assignedMedic: hexOf(someOf(row.assignedMedic)),
  }))
  const medicCards: MedicCard[] = rowsOf(db.medicMedicalCards).map((row) => ({
    incidentId: idOf(row.incidentId),
    bandId: num(row.bandId),
    name: text(row.name),
    card: readFacts(row.card),
  }))
  useAttendee.setState({
    attendee, handles, people, organizations, claimedPeople, planLookups, incidents, claims, shipping, roles, openIncidents, medicCards,
  })
}

let readQueued = false

/** A burst of row changes folds into one read. */
function queueRead(): void {
  if (readQueued) return
  readQueued = true
  queueMicrotask(() => {
    readQueued = false
    readAttendee()
  })
}

function attach(conn: DbConnection): void {
  useAttendee.setState({
    ...EMPTY,
    linked: true,
    me: hexOf((conn as unknown as { identity?: unknown }).identity),
  })
  watchTables(conn, WATCHED, queueRead)
  readAttendee()
  subscribeEach(conn, ATTENDEE_QUERIES, {
    applied: (query) => {
      useAttendee.setState((state) => ({ applied: { ...state.applied, [viewName(query)]: true } }))
      readAttendee()
    },
    refused: (query, reason) => {
      useAttendee.setState((state) => ({ refused: { ...state.refused, [viewName(query)]: reason } }))
    },
  })
}

function drop(): void {
  resetAttendee()
}

onLink(attach, drop)

/* ---------- calling reducers ---------- */

/** Action keys, so a section can show its own pending state and refusal. */
export const KEYS = {
  socials: 'socials',
  claimPerson: (personId: string) => `claim-person:${personId}`,
  planLookup: 'plan-lookup',
  pay: (chargeId: string) => `pay:${chargeId}`,
  fileClaim: (incidentId: string) => `file-claim:${incidentId}`,
  leave: 'leave',
  assign: (incidentId: string) => `assign:${incidentId}`,
  card: (bandId: number) => `card:${bandId}`,
  buy: (templateId: string, photoId: string) => `buy:${templateId}:${photoId}`,
} as const

function withTimeout<T>(work: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The host didn’t answer in time. Check before you try again.')), ACTION_TIMEOUT_MS)
    work.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error: unknown) => { clearTimeout(timer); reject(error) },
    )
  })
}

function refuse(key: string, message: string): false {
  useAttendee.setState((state) => ({ errors: { ...state.errors, [key]: message } }))
  return false
}

export function clearError(key: string): void {
  if (!(key in useAttendee.getState().errors)) return
  useAttendee.setState((state) => {
    const errors = { ...state.errors }
    delete errors[key]
    return { errors }
  })
}

/**
 * Run one action under a key: pending while it runs, the refusal kept under the key when it fails.
 * Resolves true on success and false on a refusal. A second call while one is in flight is ignored.
 */
export async function track(key: string, work: () => Promise<unknown>): Promise<boolean> {
  if (useAttendee.getState().pending[key]) return false
  useAttendee.setState((state) => ({ pending: { ...state.pending, [key]: true } }))
  clearError(key)
  try {
    await withTimeout(work())
    readAttendee()
    return true
  } catch (error) {
    return refuse(key, messageOf(error))
  } finally {
    useAttendee.setState((state) => {
      const pending = { ...state.pending }
      delete pending[key]
      return { pending }
    })
  }
}

function reducers(): AttendeeReducers {
  return linkReducers<AttendeeReducers>()
}

function u64(id: string): bigint {
  return BigInt(/^\d+$/.test(id) ? id : '0')
}

/* Socials */

export const SOCIAL_PLATFORMS = [
  { id: 'instagram', label: 'Instagram', url: 'https://instagram.com/' },
  { id: 'facebook', label: 'Facebook', url: 'https://facebook.com/' },
  { id: 'threads', label: 'Threads', url: 'https://threads.net/@' },
] as const

export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number]['id']

/** A handle as the database keeps it: no @, no profile link around it. */
export function cleanHandle(value: string): string {
  return value
    .trim()
    .replace(/^https?:\/\/(www\.)?[^/\s]+\/@?/i, '')
    .replace(/[/?#].*$/, '')
    .replace(/^@+/, '')
    .trim()
}

/**
 * Save the socials as typed. A changed handle is set, a cleared one is removed, the rest are left.
 * Stops at the first refusal, like the band page does.
 */
export async function saveSocials(draft: Partial<Record<SocialPlatform, string>>): Promise<boolean> {
  const saved = new Map(useAttendee.getState().handles.map((row) => [row.platform, row.handle.replace(/^@+/, '')]))
  return track(KEYS.socials, async () => {
    for (const { id } of SOCIAL_PLATFORMS) {
      const typed = draft[id]
      if (typed === undefined) continue
      const next = cleanHandle(typed)
      const current = saved.get(id) ?? ''
      if (next && next !== current) await reducers().setSocialHandle({ platform: id, handle: next })
      else if (!next && current) await reducers().removeSocialHandle({ platform: id })
    }
  })
}

export async function removeSocial(platform: SocialPlatform): Promise<boolean> {
  return track(KEYS.socials, () => reducers().removeSocialHandle({ platform }))
}

/* Is this you? */

/**
 * People from the event pages whose names share a word with the attendee's name, and that nobody has
 * claimed yet. Empty once the attendee is linked to a person.
 */
export function profileCandidates(attendee: Attendee | null, people: EventPerson[], claimed: string[], limit = 8): EventPerson[] {
  if (!attendee || attendee.personId !== '0') return []
  const words = attendee.displayName.toLowerCase().split(/\s+/).filter((word) => word.length > 1)
  if (!words.length) return []
  const taken = new Set(claimed)
  return people
    .filter((person) => !taken.has(person.id))
    .map((person) => {
      const name = person.displayName.toLowerCase()
      return { person, score: words.filter((word) => name.includes(word)).length }
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.person.displayName.localeCompare(b.person.displayName))
    .slice(0, limit)
    .map((item) => item.person)
}

export async function claimPerson(personId: string): Promise<boolean> {
  return track(KEYS.claimPerson(personId), () => reducers().claimPerson({ personId: u64(personId) }))
}

/* Plan lookup */

/** The newest health plan lookup, which is the one the band page shows. */
export function latestHealthLookup(lookups: PlanLookup[]): PlanLookup | null {
  return lookups.filter((row) => row.kind === 'health').sort((a, b) => compareIds(b.id, a.id))[0] ?? null
}

export async function lookUpPlan(insurer: string, plan: string, state: string): Promise<boolean> {
  const args = { insurer: insurer.trim(), plan: plan.trim(), state: state.trim().toUpperCase() }
  if (!args.insurer) return refuse(KEYS.planLookup, 'Name your insurer.')
  if (!args.plan) return refuse(KEYS.planLookup, 'Name your plan.')
  if (!/^[A-Z]{2}$/.test(args.state)) return refuse(KEYS.planLookup, 'Use the two-letter state, like CA.')
  return track(KEYS.planLookup, () => reducers().lookUpPlan(args))
}

/* Incidents and claims */

const INJURY_WORDS: Record<string, string> = { fall: 'a fall', sos: 'a call for help' }
const PROPERTY_KINDS = new Set(['property', 'theft', 'breakage'])

/** "a fall", "a call for help", or the fallback. */
export function incidentWords(kind: string, fallback = 'an alert'): string {
  return INJURY_WORDS[kind.toLowerCase()] ?? fallback
}

/** An attendee can ask the venue to pay for an incident that is closed and has no claim yet. */
export function canFileClaim(incident: MyIncident, claims: MyClaim[]): boolean {
  if (!incident.resolved || incident.claimId !== '0') return false
  if (PROPERTY_KINDS.has(incident.kind)) return false
  return !claims.some((claim) => claim.incidentId === incident.incidentId)
}

export function fileableIncidents(incidents: MyIncident[], claims: MyClaim[]): MyIncident[] {
  return incidents.filter((incident) => canFileClaim(incident, claims))
}

/** What a claim's status means to the person who filed it. */
export function claimStatusLine(status: string, payoutCents: number, money: (cents: number) => string): string {
  switch (status.toLowerCase()) {
    case 'awaitingrecord': return 'Waiting for the hospital report'
    case 'readingrecord':
    case 'verifying':
    case 'reviewing': return 'Being reviewed'
    case 'routed': return 'Waiting for the organizer to approve the payment'
    case 'paying': return 'Approved, paying into your wallet'
    case 'settled':
    case 'reconciled': return `Paid ${money(payoutCents)} into your wallet`
    case 'refused': return 'Not paid. The organizer can tell you why.'
    default: return 'Being reviewed'
  }
}

export async function fileClaim(incidentId: string, statement: string): Promise<boolean> {
  const key = KEYS.fileClaim(incidentId)
  const words = statement.trim()
  if (!words) return refuse(key, 'Tell us what happened first.')
  const state = useAttendee.getState()
  const incident = state.incidents.find((row) => row.incidentId === incidentId)
  if (incident && !canFileClaim(incident, state.claims)) return refuse(key, 'This incident already has a claim, or it is still open.')
  return track(key, () => reducers().fileClaim({ incidentId: u64(incidentId), statement: words }))
}

/* Charges */

/** What a charge's status means on the attendee's side. Empty for a status the band page has no words for. */
export function chargeStatusLine(status: string, paidAtText: string): string {
  switch (status) {
    case 'approved': return 'To pay. Nothing leaves your wallet until you press pay.'
    case 'paying': return 'Paying from your wallet…'
    case 'paid': return `Paid from your wallet${paidAtText ? ` at ${paidAtText}` : ''}.`
    case 'disputed': return 'Disputed. The organizer looks at it again.'
    case 'waived': return 'Waived. You owe nothing.'
    default: return ''
  }
}

/** Only an approved charge waits on the attendee to pay. */
export function canPayCharge(status: string): boolean {
  return status === 'approved'
}

export async function payCharge(chargeId: string): Promise<boolean> {
  return track(KEYS.pay(chargeId), () => reducers().payCharge({ chargeId: u64(chargeId) }))
}

/* Leaving */

export async function leaveEvent(): Promise<boolean> {
  return track(KEYS.leave, () => reducers().leaveEvent({}))
}

/* The medic tap */

export function isMedicRole(roles: string[]): boolean {
  return roles.includes('medic')
}

/** The open SOS or fall on this band, newest first. Resolved incidents never count. */
export function openIncidentForBand(incidents: OpenIncident[], bandId: number): OpenIncident | null {
  return incidents
    .filter((row) => row.subjectBand === bandId && !row.resolved && row.status !== 'resolved' && (row.kind === 'sos' || row.kind === 'fall'))
    .sort((a, b) => b.openedAt - a.openedAt || compareIds(b.id, a.id))[0] ?? null
}

/** The card the medic was given for this band and incident. */
export function medicCardFor(cards: MedicCard[], bandId: number, incidentId: string): MedicCard | null {
  const mine = cards.filter((row) => row.bandId === bandId)
  return mine.find((row) => row.incidentId === incidentId) ?? mine.find((row) => row.incidentId === '0') ?? null
}

export function useIsMedic(): boolean {
  return useAttendee((state) => isMedicRole(state.roles))
}

/** Whether this band's page should show the medic view: a medic, and an open incident on the band. */
export function useMedicOnBand(bandId: number | null): { show: boolean; incident: OpenIncident | null } {
  const roles = useAttendee((state) => state.roles)
  const incidents = useAttendee((state) => state.openIncidents)
  return useMemo(() => {
    if (bandId == null || !isMedicRole(roles)) return { show: false, incident: null }
    const incident = openIncidentForBand(incidents, bandId)
    return { show: incident != null, incident }
  }, [bandId, roles, incidents])
}

export async function assignMedic(incidentId: string): Promise<boolean> {
  return track(KEYS.assign(incidentId), () => reducers().assignMedic({ incidentId: u64(incidentId) }))
}

/** Ask for the band's medical card. The answer arrives as a medic_medical_cards row. */
export async function requestMedicalCard(bandId: number): Promise<boolean> {
  const setRequest = (request: CardRequest) => useAttendee.setState((state) => ({ cardRequests: { ...state.cardRequests, [bandId]: request } }))
  if (!Number.isInteger(bandId) || bandId < 0 || bandId > 255) {
    setRequest({ state: 'refused', message: 'That is not a band number.' })
    return refuse(KEYS.card(bandId), 'That is not a band number.')
  }
  if (useAttendee.getState().pending[KEYS.card(bandId)]) return false
  setRequest({ state: 'asking', message: '' })
  const ok = await track(KEYS.card(bandId), () => reducers().requestMedicalCard({ bandId }))
  setRequest(ok ? { state: 'granted', message: '' } : { state: 'refused', message: useAttendee.getState().errors[KEYS.card(bandId)] ?? 'The database refused that.' })
  return ok
}

/* Merch with shipping */

export const TEE_SIZES = ['S', 'M', 'L', 'XL'] as const

export async function buyMerchWithShipping(templateId: string, photoId: string, size: string, shippingAddress: string): Promise<boolean> {
  const key = KEYS.buy(templateId, photoId)
  const address = shippingAddress.trim()
  if (!address) return refuse(key, 'Add the recipient and the full mailing address.')
  if (address.length > 1000) return refuse(key, 'Keep the address under 1,000 characters.')
  return track(key, () => reducers().buyMerchWithShipping({ templateId: u64(templateId), photoId: u64(photoId), size, shippingAddress: address }))
}

/** A saved sign-up address as the lines a parcel needs. Empty when nothing useful is saved. */
export function addressLines(saved: { name?: string; street?: string; unit?: string; city?: string; region?: string; postalCode?: string; country?: string } | null): string {
  if (!saved || !saved.street?.trim()) return ''
  const street = [saved.street.trim(), saved.unit?.trim()].filter(Boolean).join(', ')
  const town = [saved.city?.trim(), [saved.region?.trim(), saved.postalCode?.trim()].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  return [saved.name?.trim(), street, town, saved.country?.trim()].filter(Boolean).join('\n')
}

function compareIds(a: string, b: string): number {
  const left = BigInt(/^\d+$/.test(a) ? a : '0')
  const right = BigInt(/^\d+$/.test(b) ? b : '0')
  return left < right ? -1 : left > right ? 1 : 0
}
