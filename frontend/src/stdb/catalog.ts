import { create } from 'zustand'

export interface Handle {
  platform: string
  handle: string
}

export interface Guest {
  id: string
  displayName: string
  title: string
  role: string
  organization: string
}

export interface Attendee {
  nodeId: string
  displayName: string
  bandId: number
  findable: boolean
  simulated: boolean
  organization: string
  handles: Handle[]
  createdAt: number
}

export interface LiveBand {
  id: number
  online: boolean
  sos: boolean
  fall: boolean
  zone: number
  battery: number
  neighbours: number
  lastSeen: number
}

export interface ZoneName {
  id: string
  name: string
  stationId: number
}

export interface Photo {
  id: string
  url: string
  takenAt: number
  zoneName: string
  caption: string
  people: string[]
  /** Graph nodes of the people the bands put in the frame. */
  nodeIds: string[]
}

export interface MerchPiece {
  id: string
  name: string
  title: string
  kind: string
  priceCents: number
  imageUrl: string
}

export interface MerchOrder {
  id: string
  templateId: string
  size: string
  amountCents: number
  status: string
  failure: string
  createdAt: number
}

export interface GraphLink {
  id: string
  kind: string
  fromKind: string
  fromId: string
  toKind: string
  toId: string
  weight: number
}

export interface Named {
  id: string
  name: string
}

export interface LedgerLine {
  id: string
  claimId: string
  journal: string
  account: string
  debitCents: number
  creditCents: number
  memo: string
  postedAt: number
}

export interface BillLine {
  id: string
  claimId: string
  description: string
  billedCents: number
  allowedCents: number
  coveredCents: number
  outcome: string
}

export interface RuleProposal {
  id: string
  incidentKind: string
  coverKind: string
  status: string
  ceilingCents: number
  limitCents: number
  claimIds: string[]
  rule: string
  summary: string
  decidedByName: string
  reason: string
  ruleVersion: number
  createdAt: number
}

export interface PaymentRule {
  id: string
  incidentKind: string
  coverKind: string
  requiresCorroborated: boolean
  ceilingCents: number
  approverName: string
  approverRole: string
  version: number
  status: string
  createdAt: number
  proposalId: string
}

export interface Precedent {
  id: string
  claimId: string
  incidentKind: string
  coverKind: string
  decision: string
  payoutCents: number
  claimantName: string
  zoneName: string
  complications: string
  reason: string
  decidedByName: string
  proposalId: string
  decidedAt: number
}

export interface VenuePolicyBrief {
  policyNumber: string
  insurerName: string
  medicalUsedCents: number
  propertyUsedCents: number
}

export interface DepartureRow {
  nodeId: string
  name: string
  bandId: number
  door: string
  askedAt: number
  leftAt: number
  by: string
}

export interface CameraRow {
  id: string
  name: string
  zoneId: string
  zoneName: string
  mount: string
  live: boolean
  lastFrameAt: number
}

export interface Catalog {
  attendees: Attendee[]
  cameras: CameraRow[]
  guests: Guest[]
  bands: LiveBand[]
  zones: ZoneName[]
  photos: Photo[]
  merch: MerchPiece[]
  orders: MerchOrder[]
  links: GraphLink[]
  linkCount: number
  booths: Named[]
  companies: Named[]
  ledger: LedgerLine[]
  bills: BillLine[]
  proposals: RuleProposal[]
  paymentRules: PaymentRule[]
  precedents: Precedent[]
  policy: VenuePolicyBrief | null
  departures: DepartureRow[]
  lowVis: boolean
  eventEnded: boolean
  eventEndedAt: number
}

const EMPTY: Catalog = {
  attendees: [],
  cameras: [],
  guests: [],
  bands: [],
  zones: [],
  photos: [],
  merch: [],
  orders: [],
  links: [],
  linkCount: 0,
  booths: [],
  companies: [],
  ledger: [],
  bills: [],
  proposals: [],
  paymentRules: [],
  precedents: [],
  policy: null,
  departures: [],
  lowVis: false,
  eventEnded: false,
  eventEndedAt: 0,
}

export const useCatalog = create<Catalog>(() => EMPTY)

function rowsOf(table: unknown): Record<string, unknown>[] {
  if (!table || typeof table !== 'object' || !('iter' in table)) return []
  const iter = (table as { iter: unknown }).iter
  if (typeof iter !== 'function') return []
  return [...(iter.call(table) as Iterable<Record<string, unknown>>)]
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function num(value: unknown): number {
  const n = typeof value === 'bigint' ? Number(value) : Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

function idOf(value: unknown): string {
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'number') return String(value)
  return text(value)
}

function millis(value: unknown): number {
  if (value && typeof value === 'object' && 'tag' in value) {
    const tagged = value as { tag?: unknown; value?: unknown }
    if (tagged.tag === 'none' || tagged.tag === 'None') return 0
    if (tagged.tag === 'some' || tagged.tag === 'Some') return millis(tagged.value)
  }
  if (value && typeof value === 'object' && 'toDate' in value) {
    const fn = (value as { toDate: unknown }).toDate
    if (typeof fn === 'function') {
      const date = fn.call(value) as Date
      const time = date.getTime()
      return Number.isFinite(time) ? time : 0
    }
  }
  return 0
}

function handles(value: unknown): Handle[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const row = item as { platform?: unknown; handle?: unknown }
    const platform = text(row.platform)
    const handle = text(row.handle)
    return platform || handle ? [{ platform, handle }] : []
  })
}

/** The crowd run's stick-figure illustration, also stored once as a blob. */
const PLACEHOLDER_BLOB = '/blobs/57ffcb4537f3a613394b721542274643dc36758944c1a5bd64d487169be8238a'

/** The crowd run files this illustration for every generated group. The album shows the event frames instead. */
function isPlaceholder(url: string): boolean {
  return url.endsWith('/sponsor-row.jpg') || url === PLACEHOLDER_BLOB
}

function idList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(idOf).filter((id) => id !== '')
}

function people(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const name = text((item as { name?: unknown }).name)
    return name ? [name] : []
  })
}

function personNodes(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const id = idOf((item as { nodeId?: unknown }).nodeId)
    return id ? [id] : []
  })
}

const LINK_CAP = 6000

export function readCatalog(db: unknown): Catalog {
  const tables = (db ?? {}) as Record<string, unknown>
  const zones = rowsOf(tables.zone).map((row) => ({
    id: idOf(row.id),
    name: text(row.name),
    stationId: num(row.stationId),
  }))
  const zoneById = new Map(zones.map((zone) => [zone.id, zone.name]))
  const cameras = rowsOf(tables.camera).map((row) => ({
    id: idOf(row.id),
    name: text(row.name),
    zoneId: idOf(row.zoneId),
    zoneName: zoneById.get(idOf(row.zoneId)) ?? '',
    mount: text(row.mount),
    live: row.live === true,
    lastFrameAt: millis(row.lastFrameAt),
  }))
  const attendees = rowsOf(tables.boardAttendees).map((row) => ({
    nodeId: idOf(row.nodeId),
    displayName: text(row.displayName),
    bandId: num(row.bandId),
    findable: row.findable === true,
    simulated: row.simulated === true,
    organization: text(row.organization),
    handles: handles(row.handles),
    createdAt: millis(row.createdAt),
  }))
  const myPhotos = rowsOf(tables.myPhotos).map((row) => ({
    id: idOf(row.photoId),
    url: text(row.url),
    takenAt: millis(row.takenAt),
    zoneName: text(row.zoneName),
    caption: text(row.caption),
    people: people(row.people),
    nodeIds: personNodes(row.people),
  }))
  const social = rowsOf(tables.socialPhotos).map((row) => ({
    id: idOf(row.id),
    url: text(row.url),
    takenAt: millis(row.takenAt),
    zoneName: zoneById.get(idOf(row.zoneId)) ?? '',
    caption: text(row.caption),
    people: [],
    nodeIds: [],
  }))
  const named = new Map(attendees.map((attendee) => [attendee.nodeId, attendee.displayName]))
  const board = rowsOf(tables.boardPhotos).map((row) => ({
    id: idOf(row.id),
    url: text(row.url),
    takenAt: millis(row.takenAt),
    zoneName: text(row.zoneName),
    caption: text(row.caption),
    people: idList(row.nodeIds).flatMap((id) => {
      const name = named.get(id)
      return name ? [name] : []
    }),
    nodeIds: idList(row.nodeIds),
  }))
  const seen = new Set(social.map((photo) => photo.id))
  const links: GraphLink[] = []
  let linkCount = 0
  for (const row of rowsOf(tables.eventGraph)) {
    linkCount += 1
    if (links.length >= LINK_CAP) continue
    links.push({
      id: idOf(row.id),
      kind: text(row.kind),
      fromKind: text(row.fromKind),
      fromId: idOf(row.fromId),
      toKind: text(row.toKind),
      toId: idOf(row.toId),
      weight: num(row.weight),
    })
  }
  const companies = rowsOf(tables.organization).map((row) => ({ id: idOf(row.id), name: text(row.name) }))
  const companyName = new Map(companies.map((company) => [company.id, company.name]))
  const guests = rowsOf(tables.person).map((row) => ({
    id: idOf(row.id),
    displayName: text(row.displayName),
    title: text(row.title),
    role: text(row.role),
    organization: companyName.get(idOf(row.organizationId)) ?? '',
  }))
  return {
    attendees,
    cameras,
    guests,
    bands: rowsOf(tables.band).map((row) => ({
      id: num(row.id),
      online: row.online === true,
      sos: row.sos === true,
      fall: row.fall === true,
      zone: num(row.zone),
      battery: num(row.bat),
      neighbours: num(row.neigh),
      lastSeen: millis(row.lastSeen),
    })),
    zones,
    photos: (board.length > 0 ? board : social.length > 0 ? social : myPhotos.filter((photo) => !seen.has(photo.id)))
      .filter((photo) => !isPlaceholder(photo.url))
      .sort((a, b) => b.takenAt - a.takenAt),
    merch: rowsOf(tables.merchTemplate).map((row) => ({
      id: idOf(row.id),
      name: text(row.name),
      title: text(row.title),
      kind: text(row.kind),
      priceCents: num(row.priceCents),
      imageUrl: text(row.imageUrl),
    })),
    orders: rowsOf(tables.myMerchOrders).map((row) => ({
      id: idOf(row.id),
      templateId: idOf(row.templateId),
      size: text(row.size),
      amountCents: num(row.amountCents),
      status: text(row.status),
      failure: text(row.failure),
      createdAt: millis(row.createdAt),
    })),
    links,
    linkCount,
    booths: rowsOf(tables.booth).map((row) => ({ id: idOf(row.id), name: text(row.name) })),
    companies,
    ledger: rowsOf(tables.boardLedger).map((row) => ({
      id: idOf(row.id),
      claimId: idOf(row.claimId),
      journal: text(row.journal),
      account: text(row.account),
      debitCents: num(row.debitCents),
      creditCents: num(row.creditCents),
      memo: text(row.memo),
      postedAt: millis(row.postedAt),
    })),
    bills: rowsOf(tables.boardLines).map((row) => ({
      id: idOf(row.id),
      claimId: idOf(row.claimId),
      description: text(row.description),
      billedCents: num(row.billedCents),
      allowedCents: num(row.allowedCents),
      coveredCents: num(row.coveredCents),
      outcome: text(row.outcome),
    })),
    proposals: rowsOf(tables.boardRuleProposals).map((row) => ({
      id: idOf(row.id),
      incidentKind: text(row.incidentKind),
      coverKind: text(row.coverKind),
      status: text(row.status),
      ceilingCents: num(row.ceilingCents),
      limitCents: num(row.limitCents),
      claimIds: idList(row.claimIds),
      rule: text(row.rule),
      summary: text(row.summary),
      decidedByName: text(row.decidedByName),
      reason: text(row.reason),
      ruleVersion: num(row.ruleVersion),
      createdAt: millis(row.createdAt),
    })),
    paymentRules: rowsOf(tables.boardRules).map((row) => ({
      id: idOf(row.id),
      incidentKind: text(row.incidentKind),
      coverKind: text(row.coverKind),
      requiresCorroborated: row.requiresCorroborated === true,
      ceilingCents: num(row.ceilingCents),
      approverName: text(row.approverName),
      approverRole: text(row.approverRole),
      version: num(row.version),
      status: text(row.status),
      createdAt: millis(row.createdAt),
      proposalId: idOf(row.proposalId),
    })),
    precedents: rowsOf(tables.boardOrganizerPrecedents).map((row) => ({
      id: idOf(row.id),
      claimId: idOf(row.claimId),
      incidentKind: text(row.incidentKind),
      coverKind: text(row.coverKind),
      decision: text(row.decision),
      payoutCents: num(row.payoutCents),
      claimantName: text(row.claimantName),
      zoneName: text(row.zoneName),
      complications: text(row.complications),
      reason: text(row.reason),
      decidedByName: text(row.decidedByName),
      proposalId: idOf(row.proposalId),
      decidedAt: millis(row.decidedAt),
    })),
    policy: (() => {
      const row = rowsOf(tables.boardPolicies)[0]
      if (!row) return null
      return {
        policyNumber: text(row.policyNumber),
        insurerName: text(row.insurerName),
        medicalUsedCents: num(row.medicalUsedCents),
        propertyUsedCents: num(row.propertyUsedCents),
      }
    })(),
    departures: rowsOf(tables.departure).map((row) => ({
      nodeId: idOf(row.nodeId),
      name: text(row.name),
      bandId: num(row.bandId),
      door: text(row.door),
      askedAt: millis(row.askedAt),
      leftAt: millis(row.leftAt),
      by: text(row.by),
    })),
    lowVis: rowsOf(tables.settings)[0]?.lowVis === true,
    eventEnded: rowsOf(tables.eventState)[0]?.ended === true,
    eventEndedAt: millis(rowsOf(tables.eventState)[0]?.endedAt),
  }
}

let pending: unknown = null
let timer = 0

export function scheduleCatalog(db: unknown) {
  pending = db
  if (timer) return
  timer = window.setTimeout(() => {
    timer = 0
    const next = pending
    pending = null
    if (next) useCatalog.setState(readCatalog(next))
  }, 600)
}
