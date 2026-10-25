import { formatCents } from './money'

/**
 * One night at Main Stage, seen by the two cameras that actually exist (CAM-01 at the
 * front of the stage, CAM-02 on West Passage). Payable is damage minus the night's
 * deductible when a band is named and the rider covers the peril, otherwise zero.
 * The screen's totals are summed from these rows.
 */
export const NIGHT_DEDUCTIBLE_CENTS = 25_000

export type ClaimStatus = 'needs_person' | 'unmatched' | 'filed' | 'closed'
export type StepState = 'done' | 'waiting' | 'declined'

export interface DocketStep {
  tool: 'Camera' | 'Vision' | 'Band' | 'Policy'
  state: StepState
  mark: string
  result: string
}

export interface Claim {
  id: string
  openedAt: string
  place: string
  camera: 'CAM-01' | 'CAM-02'
  what: string
  damageCents: number
  deductibleCents: number
  payableCents: number
  bandId: string | null
  guest: string | null
  status: ClaimStatus
  hold: string
  steps: DocketStep[]
}

export const CLAIMS: readonly Claim[] = [
  {
    id: 'CLM-15',
    openedAt: '21:06',
    place: 'Front Left',
    camera: 'CAM-01',
    what: 'Speaker cabinet down',
    damageCents: 118_000,
    deductibleCents: NIGHT_DEDUCTIBLE_CENTS,
    payableCents: 93_000,
    bandId: 'band-02',
    guest: 'Judge B',
    status: 'filed',
    hold: 'Filed. Vision, the band and the rider agreed.',
    steps: [
      { tool: 'Camera', state: 'done', mark: 'Seen', result: 'CAM-01 at Front Left, 21:06. A speaker cabinet was on its side.' },
      { tool: 'Vision', state: 'done', mark: 'Named', result: '91% on one person. No second figure.' },
      { tool: 'Band', state: 'done', mark: 'Matched', result: 'band-02, Judge B. Last NFC read at anchor st-05, 21:04.' },
      { tool: 'Policy', state: 'done', mark: 'Filed', result: 'Northline accepted $930.00 after the $250.00 deductible. Filed at 21:09.' },
    ],
  },
  {
    id: 'CLM-17',
    openedAt: '21:11',
    place: 'Concourse West',
    camera: 'CAM-02',
    what: 'Stand rail scuffed',
    damageCents: 8_500,
    deductibleCents: NIGHT_DEDUCTIBLE_CENTS,
    payableCents: 0,
    bandId: 'band-04',
    guest: 'Judge C',
    status: 'closed',
    hold: 'Closed. $85.00 is under the $250.00 deductible.',
    steps: [
      { tool: 'Camera', state: 'done', mark: 'Seen', result: 'CAM-02 at Concourse West, 21:11. The stand rail shows a fresh scuff.' },
      { tool: 'Vision', state: 'done', mark: 'Named', result: '88% on one person against the rail.' },
      { tool: 'Band', state: 'done', mark: 'Matched', result: 'band-04, Judge C. Last NFC read at anchor st-01, 21:10.' },
      { tool: 'Policy', state: 'declined', mark: 'Closed', result: 'Closed. $85.00 is under the $250.00 deductible, so nothing is filed.' },
    ],
  },
  {
    id: 'CLM-18',
    openedAt: '21:14',
    place: 'Front Left',
    camera: 'CAM-01',
    what: 'Folding chair bent',
    damageCents: 4_000,
    deductibleCents: NIGHT_DEDUCTIBLE_CENTS,
    payableCents: 0,
    bandId: 'band-06',
    guest: 'Judge E',
    status: 'closed',
    hold: 'Closed. The rider excludes ordinary wear on furniture.',
    steps: [
      { tool: 'Camera', state: 'done', mark: 'Seen', result: 'CAM-01 at Front Left, 21:14. A folding chair was bent.' },
      { tool: 'Vision', state: 'done', mark: 'Named', result: '84% on one person, chair in hand.' },
      { tool: 'Band', state: 'done', mark: 'Matched', result: 'band-06, Judge E. Last NFC read at anchor st-05, 21:13.' },
      { tool: 'Policy', state: 'declined', mark: 'Closed', result: 'Closed. The rider excludes ordinary wear on furniture.' },
    ],
  },
  {
    id: 'CLM-14',
    openedAt: '21:18',
    place: 'West Passage',
    camera: 'CAM-02',
    what: 'Barrier rail bent',
    damageCents: 64_000,
    deductibleCents: NIGHT_DEDUCTIBLE_CENTS,
    payableCents: 39_000,
    bandId: 'band-05',
    guest: 'Judge D',
    status: 'needs_person',
    hold: 'A second person was in the frame at 41%. Northline will not file until someone names the band.',
    steps: [
      { tool: 'Camera', state: 'done', mark: 'Seen', result: 'CAM-02 at West Passage, 21:18. The barrier rail left its footing.' },
      { tool: 'Vision', state: 'waiting', mark: 'Held', result: '86% on the person at the rail, 41% on a second figure.' },
      { tool: 'Band', state: 'done', mark: 'In frame', result: 'band-05, Judge D. Last NFC read at anchor st-01, 21:17.' },
      { tool: 'Policy', state: 'waiting', mark: 'Held', result: 'Northline covers accidental damage. It will not file while two people are candidates.' },
    ],
  },
  {
    id: 'CLM-16',
    openedAt: '21:22',
    place: 'West Passage',
    camera: 'CAM-02',
    what: 'Merch crate tipped',
    damageCents: 21_000,
    deductibleCents: NIGHT_DEDUCTIBLE_CENTS,
    payableCents: 0,
    bandId: null,
    guest: null,
    status: 'unmatched',
    hold: 'No band was in the frame, and $210.00 is under the $250.00 deductible.',
    steps: [
      { tool: 'Camera', state: 'done', mark: 'Seen', result: 'CAM-02 at West Passage, 21:22. A merch crate went over.' },
      { tool: 'Vision', state: 'declined', mark: 'No band', result: 'People in the frame, and no band light.' },
      { tool: 'Band', state: 'declined', mark: 'No read', result: 'No NFC read in West Passage in that minute.' },
      { tool: 'Policy', state: 'waiting', mark: 'Held', result: 'No band to file against. $210.00 is also under the $250.00 deductible.' },
    ],
  },
]

export interface ClaimSummary {
  detections: number
  waiting: number
  unfiledCents: number
  filedCents: number
  filedCount: number
  closedCount: number
  damageCents: number
}

const RANK: Record<ClaimStatus, number> = {
  needs_person: 0,
  unmatched: 1,
  filed: 2,
  closed: 3,
}

export function cloneClaims(claims: readonly Claim[] = CLAIMS): Claim[] {
  return claims.map((claim) => ({ ...claim, steps: claim.steps.map((step) => ({ ...step })) }))
}

export function sortClaims(claims: readonly Claim[]): Claim[] {
  return [...claims].sort((a, b) => RANK[a.status] - RANK[b.status] || a.openedAt.localeCompare(b.openedAt))
}

export function summarize(claims: readonly Claim[]): ClaimSummary {
  const waiting = claims.filter((claim) => claim.status === 'needs_person' || claim.status === 'unmatched')
  const filed = claims.filter((claim) => claim.status === 'filed')
  const closed = claims.filter((claim) => claim.status === 'closed')
  return {
    detections: claims.length,
    waiting: waiting.length,
    unfiledCents: waiting.reduce((sum, claim) => sum + claim.payableCents, 0),
    filedCents: filed.reduce((sum, claim) => sum + claim.payableCents, 0),
    filedCount: filed.length,
    closedCount: closed.length,
    damageCents: claims.reduce((sum, claim) => sum + claim.damageCents, 0),
  }
}

export function claimsSentence(summary: ClaimSummary): string {
  if (summary.waiting === 0) return `${formatCents(summary.filedCents)} is with Northline. Nothing is waiting.`
  return `${formatCents(summary.unfiledCents)} is still unfiled. ${formatCents(summary.filedCents)} is already with Northline.`
}

const WAITING_WORDS = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine']

export function claimsHeadline(summary: ClaimSummary): { title: string; sentence: string } {
  if (summary.waiting <= 0) return { title: 'The night is filed.', sentence: claimsSentence(summary) }
  if (summary.waiting === 1) return { title: 'One still needs a person.', sentence: claimsSentence(summary) }
  const word = WAITING_WORDS[summary.waiting] ?? String(summary.waiting)
  return { title: `${word} still need a person.`, sentence: claimsSentence(summary) }
}

export function waitingNote(summary: ClaimSummary): string {
  if (summary.waiting === 0) return 'the queue is clear'
  return `of ${summary.detections} detections`
}

export function unfiledNote(summary: ClaimSummary): string {
  if (summary.waiting === 0) return 'nothing left to file'
  if (summary.unfiledCents === 0) return 'under the deductible'
  return 'payable if confirmed'
}

export function statusLabel(status: ClaimStatus): string {
  switch (status) {
    case 'needs_person':
      return 'Needs a person'
    case 'unmatched':
      return 'No band'
    case 'filed':
      return 'Filed'
    case 'closed':
      return 'Closed'
  }
}

export function rowNote(claim: Claim): string {
  const who = claim.guest ?? 'No one named'
  return `${claim.place} · ${claim.openedAt} · ${who} · ${statusLabel(claim.status)}`
}

export function actionFor(claim: Claim): { label: string } | null {
  if (claim.status === 'needs_person' && claim.guest) return { label: `Confirm ${claim.guest}` }
  if (claim.status === 'unmatched') return { label: 'Close as unseen' }
  return null
}

/** A person confirms the band, or closes a detection that never found one. */
export function settleClaim(claim: Claim): Claim {
  if (claim.status === 'needs_person' && claim.guest) {
    return {
      ...claim,
      status: 'filed',
      hold: `Filed. A person confirmed ${claim.guest}.`,
      steps: claim.steps.map((step) => {
        if (step.tool === 'Vision') {
          return { ...step, state: 'done', mark: 'Named', result: `A person confirmed ${claim.guest}. The second figure is dropped.` }
        }
        if (step.tool === 'Policy') {
          return {
            ...step,
            state: 'done',
            mark: 'Filed',
            result: `Northline accepted ${formatCents(claim.payableCents)} after the ${formatCents(claim.deductibleCents)} deductible.`,
          }
        }
        return step
      }),
    }
  }
  if (claim.status === 'unmatched') {
    return {
      ...claim,
      status: 'closed',
      hold: `Closed. No band in the frame, and ${formatCents(claim.damageCents)} is under the deductible.`,
      steps: claim.steps.map((step) =>
        step.tool === 'Policy'
          ? {
              ...step,
              state: 'declined',
              mark: 'Closed',
              result: `Closed without a filing. ${formatCents(claim.damageCents)} is under the ${formatCents(claim.deductibleCents)} deductible, and no band was named.`,
            }
          : step,
      ),
    }
  }
  return claim
}

export function claimForBand(claims: readonly Claim[], bandId: string): Claim | undefined {
  const mine = claims.filter((claim) => claim.bandId === bandId)
  return mine.find((claim) => claim.status === 'needs_person' || claim.status === 'unmatched') ?? mine[0]
}
