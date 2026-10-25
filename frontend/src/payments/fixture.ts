/**
 * Sample payments for `?fixture=payments`, so the screens and the tests have a full night without a staff
 * sign-in. Every figure drawn from this file carries the striped sim chip. Rows are written in the shape the
 * views send (bigint cents) and go through the same readers as live rows. Totals are never typed in: they are
 * computed from these rows, and the tests check that they add up.
 */
import { Rng } from '@/mock/sim/rng'
import {
  readCharge, readFeeCap, readMerchOrder, readPerson, readSuggestion, readTemplate, readWallet, readWalletEntry, readMyCharge, readBoardPick,
  type DeskData, type MerchPick, type Template, type Wallet, type WalletData,
} from './rows'
import type { WalletView } from '@/stdb/session'

const MIN = 60_000
/** 19:00 to 03:00 at the Palace (UTC-7 in late October). */
const NIGHT_START = Date.UTC(2026, 9, 25, 2, 0)
const NIGHT_END = Date.UTC(2026, 9, 25, 10, 0)
const at = (hh: number, mm: number) => NIGHT_START + ((hh < 12 ? hh + 24 : hh) - 19) * 60 * MIN + mm * MIN

/** The Nessie sandbox deposit every wallet opens with. Sandbox money, not real money. */
export const OPENING_CENTS = 10_000
export const FIXTURE_BAND = 7

const FIRST = ['Maya', 'Jonah', 'Priya', 'Sam', 'Ana', 'Theo', 'Lena', 'Marcus', 'Iris', 'Diego', 'Noor', 'Felix', 'Hana', 'Omar', 'Clara', 'Ravi', 'Zoe', 'Kenji', 'Amara', 'Luca', 'Sofia', 'Eli', 'Mina', 'Tomás', 'Ada', 'Kofi', 'Yara', 'Ben', 'Leah', 'Arjun', 'Nadia', 'Owen', 'Rosa', 'Isaac', 'June', 'Malik', 'Elena', 'Hugo', 'Tara', 'Wes']
const LAST = ['Okafor', 'Chen', 'Raman', 'Alvarez', 'Novak', 'Brooks', 'Haddad', 'Kim', 'Moreau', 'Silva', 'Patel', 'Nguyen', 'Larsen', 'Osei', 'Fischer', 'Ito', 'Mendes', 'Walsh', 'Adeyemi', 'Rossi', 'Park', 'Duarte', 'Lindqvist', 'Shah', 'Kowalski', 'Ortiz', 'Byrne', 'Tanaka', 'Mensah', 'Costa', 'Weber', 'Singh', 'Dubois', 'Reyes', 'Hall', 'Cohen', 'Yilmaz', 'Abebe', 'Murphy', 'Sato']

const BOOTHS = ['Cal Hacks merch desk', 'Anthropic', 'SpacetimeDB', 'Capital One', 'Visa', 'Meta', 'Elastic', 'Bright Data', 'Figma', 'Microsoft', 'Coinbase', 'Convex', 'Y Combinator']
const WITH_MUGS = new Set(['Anthropic', 'SpacetimeDB', 'Capital One', 'Visa', 'Meta', 'Elastic', 'Bright Data'])
const PRICE = { tee: 2500, mug: 1800, poster: 1500 } as const
const AREA = {
  tee: { width: 1000n, height: 1000n, photoX: 330n, photoY: 290n, photoW: 340n, photoH: 340n },
  mug: { width: 1000n, height: 800n, photoX: 250n, photoY: 210n, photoW: 360n, photoH: 380n },
  poster: { width: 800n, height: 1000n, photoX: 90n, photoY: 90n, photoW: 620n, photoH: 620n },
}

function hex(rng: Rng, length: number): string {
  let out = ''
  for (let i = 0; i < length; i++) out += '0123456789abcdef'[rng.int(16)]
  return out
}

function buildTemplates() {
  const rows: Record<string, unknown>[] = []
  let id = 1
  const add = (title: string, kind: keyof typeof PRICE, booth: number) => {
    rows.push({ id: BigInt(id), name: title.toLowerCase().replace(/\W+/g, '-'), title, kind, priceCents: BigInt(PRICE[kind]), imageUrl: '', ...AREA[kind], boothIds: [BigInt(booth)] })
    id += 1
  }
  add('Cal Hacks 13.0 tee', 'tee', 1)
  add('Cal Hacks 13.0 mug', 'mug', 1)
  add('Cal Hacks 13.0 poster', 'poster', 1)
  add('Booth crawl poster', 'poster', 1)
  BOOTHS.slice(1).forEach((name, index) => {
    add(`${name} tee`, 'tee', index + 2)
    if (WITH_MUGS.has(name)) add(`${name} mug`, 'mug', index + 2)
  })
  return rows.map(readTemplate)
}

function buildPeople(rng: Rng) {
  const names = new Set<string>()
  while (names.size < 240) names.add(`${FIRST[rng.int(FIRST.length)]} ${LAST[rng.int(LAST.length)]}`)
  return [...names].map((displayName, index) => readPerson({ nodeId: BigInt(1000 + index), displayName, bandId: index + 1 }))
}

function build() {
  const rng = new Rng(1307)
  const templates = buildTemplates()
  const people = buildPeople(rng)
  const byTitle = new Map(templates.map((template) => [template.title, template]))
  const holder = (band: number) => people[band - 1]
  // 212 of the 240 registered bands opened a wallet. Every band named below is one of them.
  const walletHolders = people.filter((person) => (person.bandId ?? 0) <= 212)
  const spent = new Map<string, number>()
  const orderRows: Record<string, unknown>[] = []
  let orderId = 1

  const order = (nodeId: string, template: Template, time: number, status: string, extra: Partial<Record<string, unknown>> = {}) => {
    const person = people.find((item) => item.nodeId === nodeId)!
    const size = template.kind === 'tee' ? ['S', 'M', 'L', 'XL'][rng.int(4)] : ''
    const paid = status === 'paid'
    orderRows.push({
      id: BigInt(orderId++),
      attendeeName: person.name,
      nodeId: BigInt(nodeId),
      templateId: BigInt(template.id),
      photoId: BigInt(500 + rng.int(80)),
      title: template.title,
      size,
      amountCents: BigInt(template.priceCents),
      status,
      failure: '',
      nessiePurchaseId: status === 'pending' ? '' : hex(rng, 24),
      createdAt: time,
      updatedAt: paid ? time + (1 + rng.int(3)) * MIN : time,
      line: '',
      photoUrl: '',
      ...extra,
    })
    if (paid) spent.set(nodeId, (spent.get(nodeId) ?? 0) + template.priceCents)
  }

  // The night's steady trade: weighted toward tees, busiest between 21:00 and 23:30.
  const choices = templates.flatMap((template) => (template.kind === 'tee' ? [template, template, template] : [template]))
  for (let i = 0; i < 150; i++) {
    const hour = Math.min(6.4, Math.max(0.25, 2.9 + rng.gauss() * 1.35))
    const time = NIGHT_START + Math.round(hour * 60) * MIN
    const template = choices[rng.int(choices.length)]
    let buyer = walletHolders[rng.int(walletHolders.length)]
    for (let tries = 0; (spent.get(buyer.nodeId) ?? 0) + template.priceCents > OPENING_CENTS - 2_000 && tries < 20; tries++) {
      buyer = walletHolders[rng.int(walletHolders.length)]
    }
    if (buyer.bandId === FIXTURE_BAND) buyer = walletHolders[20]
    order(buyer.nodeId, template, time, 'paid')
  }
  // The booth crawl stop after the Anthropic talk: the biggest quarter-hour of the night.
  for (let i = 0; i < 14; i++) {
    const buyer = walletHolders[30 + i * 7]
    order(buyer.nodeId, byTitle.get('Anthropic tee')!, at(21, 31 + Math.floor(i * 0.9)), 'paid')
  }
  // What didn't go cleanly.
  order(walletHolders[57].nodeId, byTitle.get('Visa tee')!, at(23, 12), 'failed', { failure: 'nessie 503: service unavailable', nessiePurchaseId: '' })
  order(walletHolders[88].nodeId, byTitle.get('Meta mug')!, at(0, 41), 'failed', { failure: 'nessie 404: merchant not found', nessiePurchaseId: '' })
  order(walletHolders[64].nodeId, byTitle.get('Convex tee')!, at(22, 5), 'refunded')
  order(walletHolders[71].nodeId, byTitle.get('Figma tee')!, at(1, 18), 'pending')
  order(walletHolders[129].nodeId, byTitle.get('Elastic mug')!, at(1, 22), 'pending')

  // Band 07: the attendee the wallet fixture belongs to. Its rows are the same rows on both screens.
  const seven = holder(FIXTURE_BAND).nodeId
  const sevenStart = orderId
  order(seven, byTitle.get('SpacetimeDB tee')!, at(20, 48), 'paid', { size: 'M', line: 'From the photo at the SpacetimeDB booth, 20:31.' })
  order(seven, byTitle.get('Cal Hacks 13.0 poster')!, at(22, 2), 'paid', { line: 'The main stage at the opening talk.' })
  order(seven, byTitle.get('Visa tee')!, at(23, 9), 'failed', { size: 'L', failure: 'nessie 503: service unavailable', nessiePurchaseId: '' })
  order(seven, byTitle.get('Anthropic mug')!, at(1, 14), 'pending')
  const sevenOrders = orderRows.slice(sevenStart - 1)

  const fees = [
    { id: 1n, policyId: 1n, code: 'F-01', description: 'Spilled drink on equipment', capCents: 6_000n },
    { id: 2n, policyId: 1n, code: 'F-02', description: 'Damaged booth fixture', capCents: 15_000n },
    { id: 3n, policyId: 1n, code: 'F-03', description: 'Broken display glass', capCents: 25_000n },
    { id: 4n, policyId: 1n, code: 'F-04', description: 'Lost or damaged wristband', capCents: 4_000n },
  ].map(readFeeCap)

  const incidents = [
    { id: '41', kind: 'spill', zoneName: 'Sponsor row' },
    { id: '42', kind: 'damage', zoneName: 'Sponsor row' },
    { id: '43', kind: 'damage', zoneName: 'Mezzanine' },
    { id: '44', kind: 'band_lost', zoneName: 'Main hall' },
    { id: '45', kind: 'damage', zoneName: 'Stage front' },
    { id: '46', kind: 'spill', zoneName: 'Main hall' },
    { id: '47', kind: 'damage', zoneName: 'Sponsor row' },
    { id: '48', kind: 'damage', zoneName: 'Mezzanine' },
  ]

  const checks = ['The band was in the zone at the time', 'A camera shows the band at the spot', 'Under the fee-schedule cap']
  const charge = (id: number, band: number, incident: string, cents: number, status: string, created: number, extra: Partial<Record<string, unknown>>) => ({
    id: BigInt(id), incidentId: BigInt(incident), claimId: 0n, attendee: null, attendeeName: holder(band).name, bandId: band,
    namedBy: null, namedByName: 'Dana Ortiz', namedByRole: 'ops', note: '', amountCents: BigInt(cents),
    packHash: `${hex(rng, 64)}`, checks, checksPassed: true, recommendation: '', recommendationReason: '', clauseIds: [] as string[],
    status, disputeText: '', approvedByName: '', waiveReason: '', paymentReference: '', createdAt: created, decidedAt: undefined,
    paidAt: undefined, updatedAt: created, insurerCents: 0n, refundCents: 0n, ...extra,
  })
  const chargeRows = [
    charge(1, FIXTURE_BAND, '41', 4_500, 'recommended', at(22, 18), {
      note: 'A drink went over the Elastic booth’s demo laptop.',
      recommendation: 'Charge $45.00', recommendationReason: 'The laptop needs a new keyboard; the booth’s receipt is in the pack.', clauseIds: ['F-01'],
    }),
    charge(2, 23, '42', 8_500, 'recommended', at(23, 40), {
      namedByName: 'Theo Brooks', namedByRole: 'medic', note: 'Banner stand knocked over at the Visa booth.',
      recommendation: 'Charge $85.00', recommendationReason: 'Two cameras agree on the band; the stand’s base cracked.', clauseIds: ['F-02'],
    }),
    charge(3, 61, '43', 6_000, 'disputed', at(21, 55), {
      note: 'Railing light pulled off on the mezzanine.', recommendation: 'Charge $60.00', recommendationReason: 'The band was beside the railing for four minutes.', clauseIds: ['F-02'],
      disputeText: 'I was at the stage when this happened. Please check the camera again.',
    }),
    charge(4, 18, '44', 4_000, 'paid', at(20, 22), {
      note: 'Band left at the coat check and stepped on.', recommendation: 'Charge $40.00', recommendationReason: 'Replacement band at cost.', clauseIds: ['F-04'],
      approvedByName: 'Dana Ortiz', decidedAt: at(20, 30), paidAt: at(20, 31), paymentReference: hex(rng, 24),
    }),
    charge(5, 140, '45', 12_000, 'paid', at(21, 4), {
      note: 'Monitor wedge kicked off the stage lip.', recommendation: 'Charge $120.00', recommendationReason: 'Repair quote from the sound crew.', clauseIds: ['F-02'],
      approvedByName: 'Dana Ortiz', decidedAt: at(21, 20), paidAt: at(21, 21), paymentReference: hex(rng, 24), claimId: 4n, insurerCents: 6_000n,
    }),
    charge(6, 95, '46', 6_000, 'paid', at(22, 47), {
      note: 'Coffee across the Microsoft booth’s demo tablet.', recommendation: 'Charge $60.00', recommendationReason: 'At the cap; the tablet still works.', clauseIds: ['F-01'],
      approvedByName: 'Theo Brooks', decidedAt: at(22, 58), paidAt: at(22, 59), paymentReference: hex(rng, 24),
    }),
    charge(7, 201, '47', 8_500, 'waived', at(23, 2), {
      note: 'Table leg snapped at the Coinbase booth.', recommendation: 'Charge $85.00', recommendationReason: 'One camera only.', clauseIds: ['F-02'],
      approvedByName: 'Dana Ortiz', decidedAt: at(23, 15), waiveReason: 'The table was already cracked; the booth lead said so.',
    }),
    charge(8, 33, '48', 15_000, 'paid', at(20, 5), {
      note: 'Glass panel cracked on the mezzanine.', recommendation: 'Charge $150.00', recommendationReason: 'Glazier’s quote in the pack.', clauseIds: ['F-03'],
      approvedByName: 'Dana Ortiz', decidedAt: at(20, 25), paidAt: at(20, 26), paymentReference: hex(rng, 24), refundCents: 5_000n,
    }),
  ]
  for (const row of chargeRows) {
    if (row.status !== 'paid') continue
    const node = holder(row.bandId).nodeId
    spent.set(node, (spent.get(node) ?? 0) + Number(row.amountCents) - Number(row.refundCents))
  }

  const wallets: Wallet[] = walletHolders.map((person, index) => readWallet({
    nodeId: BigInt(person.nodeId),
    accountId: `68f${String(index).padStart(3, '0')}${hex(rng, 18)}`,
    balanceCents: BigInt(OPENING_CENTS - (spent.get(person.nodeId) ?? 0)),
  }))

  const pickRows = [
    { rank: 1, template: 'Cal Hacks 13.0 tee', photoId: 512n, line: 'You, Jonah and Priya at the front for the opening talk.', reason: 'You were in four photos from the stage; this is the clearest.', friends: ['Jonah Chen', 'Priya Raman'] },
    { rank: 2, template: 'SpacetimeDB mug', photoId: 538n, line: 'The SpacetimeDB booth at 20:31.', reason: 'You bought their tee, and the mug uses the same photo.', friends: ['Sam Alvarez'] },
    { rank: 3, template: 'Booth crawl poster', photoId: 547n, line: 'Every booth you stopped at tonight.', reason: 'You visited eleven booths; the poster maps them.', friends: [] as string[] },
  ]
  const suggestions: MerchPick[] = pickRows.map((pick) => {
    const template = byTitle.get(pick.template)!
    return readSuggestion({
      rank: pick.rank, templateId: BigInt(template.id), title: template.title, kind: template.kind, priceCents: BigInt(template.priceCents), imageUrl: '',
      width: template.area.width, height: template.area.height, photoX: template.area.x, photoY: template.area.y, photoW: template.area.w, photoH: template.area.h,
      photoId: pick.photoId, photoUrl: '', line: pick.line, reason: pick.reason, friends: pick.friends, ticks: [],
    })
  })
  const templateMap = new Map(templates.map((template) => [template.id, template]))
  const picks = pickRows.map((pick, index) => readBoardPick({
    id: BigInt(index + 1), nodeId: BigInt(seven), attendeeName: holder(FIXTURE_BAND).name, rank: pick.rank,
    templateId: BigInt(byTitle.get(pick.template)!.id), photoId: pick.photoId, photoUrl: '', line: pick.line, reason: pick.reason, createdAt: at(1, 0),
  }, templateMap))

  const desk: DeskData = {
    charges: chargeRows.map(readCharge),
    orders: orderRows.map(readMerchOrder),
    wallets,
    people,
    templates,
    booths: BOOTHS.map((name, index) => ({ id: String(index + 1), name })),
    fees,
    incidents,
    picks,
    night: { startsAt: NIGHT_START, endsAt: NIGHT_END },
  }

  const sevenWallet = wallets.find((wallet) => wallet.nodeId === seven)!
  const sevenPaid = sevenOrders.filter((row) => row.status === 'paid')
  const wallet: WalletData = {
    entries: [
      { id: 1n, kind: 'deposit', amountCents: BigInt(OPENING_CENTS), memo: 'Wallet opened with the sandbox deposit', nessieId: hex(rng, 24), createdAt: at(19, 12) },
      ...sevenPaid.map((row, index) => ({
        id: BigInt(index + 2), kind: 'merch', amountCents: -(row.amountCents as bigint), memo: String(row.title), nessieId: String(row.nessiePurchaseId), createdAt: Number(row.updatedAt),
      })),
    ].map(readWalletEntry),
    charges: [{
      id: 1n, incidentId: 41n, incidentKind: 'spill', zoneName: 'Sponsor row', happenedAt: at(22, 14), amountCents: 4_500n, status: 'recommended',
      why: 'A drink went over the Elastic booth’s demo laptop, and the camera puts your band at the counter at 22:14.',
      clause: 'F-01 · Spilled drink on equipment, up to $60.00', disputeText: '', paidAt: undefined,
    }].map(readMyCharge),
    orders: sevenOrders.map((row) => readMerchOrder({ ...row, attendeeName: '', title: '' })),
    suggestions,
    templates,
    photos: [],
  }
  const walletView: WalletView = { accountId: sevenWallet.accountId, balanceCents: sevenWallet.balanceCents }
  return { desk, wallet, walletView }
}

const built = build()

export const FIXTURE_DESK: DeskData = built.desk
export const FIXTURE_WALLET: WalletData = built.wallet
export const FIXTURE_WALLET_VIEW: WalletView = built.walletView
export const FIXTURE_NIGHT = { startsAt: NIGHT_START, endsAt: NIGHT_END }
/** The sample night's "now": just after its last row, so anything the fixture backend writes lands inside the night. */
export const FIXTURE_NOW = at(1, 30)

export function isPaymentsFixture(search: string = typeof window === 'undefined' ? '' : window.location.search): boolean {
  return new URLSearchParams(search).get('fixture') === 'payments'
}
