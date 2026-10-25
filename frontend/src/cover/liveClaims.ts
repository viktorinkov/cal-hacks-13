import { formatCents } from './money'

/** A claim as the desk shows it, copied off the database so the screen does not hold SDK rows. */
export interface BoardCheck {
  name: string
  result: string
  detail: string
  reader: string
}

export interface BoardFact {
  seq: number
  key: string
  value: string
  source: string
}

export interface BoardClaim {
  id: string
  incidentKind: string
  zoneName: string
  claimantName: string
  bandId: number
  status: string
  statusNote: string
  costCents: number
  payoutCents: number
  recoverableCents: number
  venueCostCents: number
  packHash: string
  openedAt: string
  routedToName: string
  routedToRole: string
  routedTo: string
  corroboration: string
  checks: BoardCheck[]
  facts: BoardFact[]
}

export interface BoardSummary {
  waiting: number
  detections: number
  unfiledCents: number
  filedCents: number
  damageCents: number
}

const STILL_OPEN = new Set(['AwaitingRecord', 'ReadingRecord', 'Verifying', 'Reviewing', 'Routed'])
const WITH_INSURER = new Set(['Paying', 'Settled', 'Reconciled'])

export function boardSummary(claims: readonly BoardClaim[]): BoardSummary {
  let unfiledCents = 0
  let filedCents = 0
  let damageCents = 0
  let waiting = 0
  for (const claim of claims) {
    damageCents += claim.costCents
    if (claim.status === 'Routed') waiting += 1
    if (STILL_OPEN.has(claim.status)) unfiledCents += claim.payoutCents
    if (WITH_INSURER.has(claim.status)) filedCents += claim.payoutCents
  }
  return { waiting, detections: claims.length, unfiledCents, filedCents, damageCents }
}

export function boardHeadline(summary: BoardSummary, insurer: string): { title: string; sentence: string } {
  const title =
    summary.detections === 0
      ? 'No claims yet.'
      : summary.waiting === 0
        ? 'The board is clear.'
        : summary.waiting === 1
          ? 'One still needs a person.'
          : `${summary.waiting} still need a person.`
  const sentence = `${formatCents(summary.unfiledCents)} is still unfiled. ${formatCents(summary.filedCents)} is already with ${insurer}.`
  return { title, sentence }
}

export function statusLabel(status: string): string {
  return status.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
}

export function sortBoard(claims: readonly BoardClaim[]): BoardClaim[] {
  const rank = (status: string) => (status === 'Routed' ? 0 : STILL_OPEN.has(status) ? 1 : 2)
  return [...claims].sort((a, b) => rank(a.status) - rank(b.status) || Number(b.id) - Number(a.id))
}

export function checkTone(result: string): 'done' | 'waiting' | 'declined' {
  const value = result.toLowerCase()
  if (value === 'fail' || value === 'failed' || value === 'refused' || value === 'excluded') return 'declined'
  if (value === 'pending' || value === 'held' || value === 'waiting') return 'waiting'
  return 'done'
}
