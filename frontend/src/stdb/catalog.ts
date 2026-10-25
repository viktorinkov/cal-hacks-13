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

export interface Catalog {
  attendees: Attendee[]
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
}

const EMPTY: Catalog = {
  attendees: [],
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

function people(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const name = text((item as { name?: unknown }).name)
    return name ? [name] : []
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
  }))
  const social = rowsOf(tables.socialPhotos).map((row) => ({
    id: idOf(row.id),
    url: text(row.url),
    takenAt: millis(row.takenAt),
    zoneName: zoneById.get(idOf(row.zoneId)) ?? '',
    caption: text(row.caption),
    people: [],
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
    photos: social.length > 0 ? social : myPhotos.filter((photo) => !seen.has(photo.id)),
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
