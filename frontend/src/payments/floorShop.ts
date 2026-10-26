/**
 * Purchases by the people on the floor. The live run buys for about 30% of the crowd, the first
 * one 30 seconds in and the rest spread across a 12 minute run, one person once, at a sponsor booth.
 * This is that same schedule for the hall the command center draws, so payments show up as they buy.
 */
import { create } from 'zustand'
import { type Booth, type DeskData, type MerchOrder, type Person, type Template } from './rows'

export const FIRST_MS = 30_000
export const RUN_MS = 12 * 60 * 1000

export interface ShopClock {
  nextAt: number
  selected: number
  target: number
}

export function openingClock(): ShopClock {
  return { nextAt: FIRST_MS, selected: 0, target: 0 }
}

export function shopTarget(crowdSize: number): number {
  return Math.ceil((Math.max(0, crowdSize) * 30) / 100)
}

/** Whole seconds, the same rounding the live run uses, so 300 shoppers land on a 2 second gap. */
export function shopGapMs(target: number): number {
  const secs = Math.floor((RUN_MS / 1000 - FIRST_MS / 1000) / Math.max(1, target))
  return Math.max(1, secs) * 1000
}

export interface ShopStep extends ShopClock {
  buy: boolean
}

/**
 * Advance the schedule. A buy is due when the clock has reached the next slot, someone is free
 * to buy, and the run has not already chosen its share of the crowd.
 */
export function duePurchase(clock: ShopClock, now: number, crowdSize: number, open: boolean): ShopStep {
  const target = shopTarget(crowdSize)
  if (now < clock.nextAt || clock.selected >= target) return { ...clock, target, buy: false }
  const nextAt = now + shopGapMs(target)
  if (!open) return { nextAt, selected: clock.selected, target, buy: false }
  return { nextAt, selected: clock.selected + 1, target, buy: true }
}

const FIRST = [
  'Maya', 'Ethan', 'Priya', 'Lucas', 'Sofia', 'Noah', 'Aisha', 'Diego', 'Hana', 'Marcus', 'Elena', 'Kenji', 'Chloe',
  'Omar', 'Zoe', 'Ravi', 'Isabel', 'Tyler', 'Mei', 'Jonah', 'Amara', 'Leo', 'Nina', 'Caleb', 'Yara', 'Felix',
  'Grace', 'Mateo', 'Lena', 'Sam', 'Arjun', 'Bianca', 'Connor', 'Dalia', 'Emeka', 'Fatima', 'Gabriel', 'Harper',
  'Ines', 'Jamal', 'Kira', 'Liam', 'Malia', 'Nikhil', 'Olivia', 'Pablo', 'Quinn', 'Rosa', 'Sanjay', 'Talia', 'Umar',
  'Vera', 'Wes', 'Ximena', 'Yusuf', 'Zara', 'Aditi', 'Ben', 'Camila', 'Daniel', 'Esther', 'Farah', 'Gus', 'Hiro',
  'Ivy', 'Jae', 'Kofi', 'Lucia', 'Max', 'Nadia', 'Oscar', 'Paloma', 'Rahul', 'Sienna', 'Theo', 'Uma', 'Victor',
  'Wen', 'Yuki', 'Zain', 'Alana', 'Bruno', 'Cyrus', 'Divya', 'Eli', 'Freya', 'Gianna', 'Hugo', 'Ishaan', 'Jade',
  'Kai', 'Leila', 'Mika', 'Nora', 'Owen', 'Pia', 'Rhea', 'Soren', 'Tara', 'Ulises', 'Vik', 'Willa', 'Xavier',
  'Yasmin', 'Zeke', 'Ana', 'Brandon', 'Celine', 'Dev', 'Emma', 'Finn', 'Gia', 'Hamza', 'Iris', 'Jules', 'Kenzo',
  'Lila', 'Milo', 'Noor', 'Orion', 'Petra', 'Ren', 'Sara', 'Tomas', 'Wanda',
]

const LAST = [
  'Chen', 'Patel', 'Garcia', 'Kim', 'Nguyen', 'Okafor', 'Silva', 'Novak', 'Haddad', 'Rossi', 'Tanaka', 'Moreno',
  'Fischer', 'Adeyemi', 'Larsen', 'Kaur', 'Dubois', 'Ivanova', 'Mensah', 'Park', 'Singh', 'Lopez', 'Wang', 'Ali',
  'Johnson', 'Hernandez', 'Sato', 'Kowalski', 'Rahman', 'Costa', 'Murphy', 'Yilmaz', 'Petrov', 'Mwangi', 'Lee',
  'Martinez', 'Cohen', 'Ito', 'Gupta', 'Nakamura', 'Smith', 'Reyes', 'Zhang', 'Ahmed', 'Brown', 'Torres', 'Liu',
  'Kapoor', 'Schmidt', 'Ortiz', 'Huang', 'Diaz', 'Wilson', 'Choi', 'Ramirez', 'Yang', 'Davis', 'Iyer', 'Lindqvist',
  'Romero', 'Abebe', 'Khan', 'Nowak', 'Gomez', 'Taylor', 'Wu', 'Sanchez', 'Kuznetsov', 'Anderson', 'Bose', 'Flores',
  'Jung', 'Mendes', 'Clarke', 'Osei', 'Walker', 'Shah', 'Volkov', 'Rivera', 'Hoang', 'Moore', 'Tran', 'Castillo',
  'Yamamoto', 'Thompson', 'Bauer', 'Ruiz', 'Lin', 'Jackson', 'Pereira', 'Alvarez', 'Saito', 'Kumar', 'Jensen',
  'Ng', 'White', 'Morales', 'Ozturk', 'Harris', 'Vargas', 'Das', 'Muller', 'Santos', 'Hall', 'Mehta', 'Ross',
  'Barros', 'Chowdhury', 'Young', 'Dang', 'Popescu', 'Afolabi', 'Wright', 'Bianchi', 'Holm', 'Rao', 'Green', 'Pham',
]

const KINDS = [
  { kind: 'tee', price: 2500, label: 'tee' },
  { kind: 'mug', price: 1800, label: 'mug' },
  { kind: 'poster', price: 1500, label: 'poster' },
] as const

const SIZES = ['S', 'M', 'L', 'XL']

export interface Piece {
  kind: string
  title: string
  size: string
  amountCents: number
  templateId: string
}

export interface RngLike {
  next(): number
  int(n: number): number
}

export function buyerName(index: number): string {
  const first = FIRST[Math.abs(index) % FIRST.length] ?? 'Maya'
  const last = LAST[Math.floor(Math.abs(index) / FIRST.length) % LAST.length] ?? 'Chen'
  return `${first} ${last}`
}

export function pickPiece(rng: RngLike, booth: string): Piece {
  const kind = KINDS[rng.int(KINDS.length)] ?? KINDS[0]
  const size = kind.kind === 'tee' ? (SIZES[rng.int(SIZES.length)] ?? 'M') : ''
  const title = `${booth} ${kind.label}`
  return { kind: kind.kind, title, size, amountCents: kind.price, templateId: `floor:${slug(title)}` }
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function reference(n: number): string {
  let x = Math.imul(n + 1, 0x9e3779b1)
  let out = ''
  for (let i = 0; i < 6; i++) {
    x = Math.imul(x ^ (x >>> 16), 0x7feb352d)
    out += (x >>> 0).toString(16).padStart(8, '0')
  }
  return out.slice(0, 24)
}

const BLANK_AREA = { width: 0, height: 0, x: 0, y: 0, w: 0, h: 0 }

export interface PurchaseMark {
  id: string
  who: number
  name: string
  title: string
  amountCents: number
  x: number
  y: number
  at: number
}

interface FloorState {
  orders: MerchOrder[]
  people: Person[]
  templates: Template[]
  booths: Booth[]
  marks: PurchaseMark[]
}

const emptyFloor = (): FloorState => ({ orders: [], people: [], templates: [], booths: [], marks: [] })

export const useFloorShop = create<FloorState>(emptyFloor)

export function resetFloorShop() {
  useFloorShop.setState(emptyFloor(), true)
}

export interface PlacedPurchase {
  who: number
  name: string
  bandId: number
  booth: string
  piece: Piece
  x: number
  y: number
  /** About one purchase in forty fails at the bank, once the worker answers. */
  fail: boolean
}

export function placePurchase(purchase: PlacedPurchase) {
  const now = Date.now()
  const id = `f${useFloorShop.getState().orders.length + 1}`
  const nodeId = `crowd-${purchase.bandId}`
  const boothId = `booth:${slug(purchase.booth)}`
  const order: MerchOrder = {
    id,
    attendeeName: purchase.name,
    nodeId,
    templateId: purchase.piece.templateId,
    photoId: '',
    title: purchase.piece.title,
    size: purchase.piece.size,
    amountCents: purchase.piece.amountCents,
    status: 'paying',
    failure: '',
    nessiePurchaseId: '',
    createdAt: now,
    updatedAt: null,
    line: `Bought at the ${purchase.booth} booth.`,
    photoUrl: '',
  }
  const person: Person = { nodeId, name: purchase.name, bandId: purchase.bandId }
  const template: Template = {
    id: purchase.piece.templateId,
    title: purchase.piece.title,
    kind: purchase.piece.kind,
    priceCents: purchase.piece.amountCents,
    imageUrl: '',
    area: BLANK_AREA,
    boothIds: [boothId],
  }
  const mark: PurchaseMark = {
    id,
    who: purchase.who,
    name: purchase.name,
    title: purchase.piece.size ? `${purchase.piece.title} · ${purchase.piece.size}` : purchase.piece.title,
    amountCents: purchase.piece.amountCents,
    x: purchase.x,
    y: purchase.y,
    at: now,
  }
  useFloorShop.setState((state) => ({
    orders: [...state.orders, order],
    people: state.people.some((item) => item.nodeId === nodeId) ? state.people : [...state.people, person],
    templates: state.templates.some((item) => item.id === template.id) ? state.templates : [...state.templates, template],
    booths: state.booths.some((item) => item.id === boothId) ? state.booths : [...state.booths, { id: boothId, name: purchase.booth }],
    marks: [...state.marks, mark],
  }))
  const settle = purchase.fail
  window.setTimeout(() => {
    useFloorShop.setState((state) => ({
      orders: state.orders.map((item) =>
        item.id === id
          ? {
              ...item,
              status: settle ? 'failed' : 'paid',
              failure: settle ? 'nessie 503: service unavailable' : '',
              nessiePurchaseId: settle ? '' : reference(state.orders.length + purchase.who),
              updatedAt: Date.now(),
            }
          : item,
      ),
    }))
  }, 2800)
}

/** Keep a fresh purchase tag on the person as they walk up to the booth. */
export function followBuyers(spots: { who: number; x: number; y: number }[]) {
  const state = useFloorShop.getState()
  const now = Date.now()
  if (!state.marks.some((mark) => now - mark.at < 9000)) return
  const at = new Map(spots.map((spot) => [spot.who, spot]))
  let changed = false
  const marks = state.marks.map((mark) => {
    if (now - mark.at >= 9000) return mark
    const spot = at.get(mark.who)
    if (!spot) return mark
    if (Math.hypot(spot.x - mark.x, spot.y - mark.y) < 0.35) return mark
    changed = true
    return { ...mark, x: spot.x, y: spot.y }
  })
  if (changed) useFloorShop.setState({ marks })
}

/** Floor purchases join the desk. The event window grows to include them. */
export function withFloorPurchases(desk: DeskData, floor: Pick<FloorState, 'orders' | 'people' | 'templates' | 'booths'>): DeskData {
  if (!floor.orders.length) return desk
  const oldest = Math.min(...floor.orders.map((order) => order.createdAt))
  const newest = Math.max(...floor.orders.map((order) => order.updatedAt ?? order.createdAt))
  const night = { ...desk.night }
  if (night.startsAt != null && oldest < night.startsAt) night.startsAt = oldest
  if (night.endsAt != null && newest > night.endsAt) night.endsAt = newest
  const templateIds = new Set(desk.templates.map((template) => template.id))
  const boothIds = new Set(desk.booths.map((booth) => booth.id))
  const peopleIds = new Set(desk.people.map((person) => person.nodeId))
  return {
    ...desk,
    night,
    orders: [...floor.orders, ...desk.orders],
    people: [...desk.people, ...floor.people.filter((person) => !peopleIds.has(person.nodeId))],
    templates: [...desk.templates, ...floor.templates.filter((template) => !templateIds.has(template.id))],
    booths: [...desk.booths, ...floor.booths.filter((booth) => !boothIds.has(booth.id))],
  }
}
