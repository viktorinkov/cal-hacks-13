import { create } from 'zustand'
import {
  EMPTY_DESK, EMPTY_WALLET, idOf, millis, readBoardPick, readCharge, readFeeCap, readMerchOrder, readMyCharge, readPerson,
  readNightPhoto, readSuggestion, readTemplate, readWallet, readWalletEntry, text, type DeskData, type WalletData,
} from './rows'

export interface PaymentsState {
  desk: DeskData
  wallet: WalletData
}

/** The staff views the desk's blocks wait on, as the session names its staff queries. */
export const DESK_VIEWS = {
  charges: 'SELECT * FROM board_charges',
  orders: 'SELECT * FROM board_merch_orders',
  wallets: 'SELECT * FROM board_wallets',
} as const

/** Live rows only. The fixture lives in its own store below and never lands here. */
export const usePayments = create<PaymentsState>(() => ({ desk: EMPTY_DESK, wallet: EMPTY_WALLET }))

function rowsOf(table: unknown): Record<string, unknown>[] {
  if (!table || typeof table !== 'object' || !('iter' in table)) return []
  const iter = (table as { iter: unknown }).iter
  if (typeof iter !== 'function') return []
  return [...(iter.call(table) as Iterable<Record<string, unknown>>)]
}

function tagOf(value: unknown): string {
  if (value && typeof value === 'object' && 'tag' in value) return text((value as { tag: unknown }).tag)
  return text(value)
}

export function readPayments(db: unknown): PaymentsState {
  const tables = (db ?? {}) as Record<string, unknown>
  const templates = rowsOf(tables.merchTemplate).map(readTemplate)
  const templateMap = new Map(templates.map((template) => [template.id, template]))
  const zones = new Map(rowsOf(tables.zone).map((row) => [idOf(row.id), text(row.name)]))
  const venue = rowsOf(tables.venue)[0]
  return {
    desk: {
      charges: rowsOf(tables.boardCharges).map(readCharge),
      orders: rowsOf(tables.boardMerchOrders).map(readMerchOrder),
      wallets: rowsOf(tables.boardWallets).map(readWallet),
      people: rowsOf(tables.boardAttendees).map(readPerson),
      templates,
      booths: rowsOf(tables.booth).map((row) => ({ id: idOf(row.id), name: text(row.name) })),
      fees: rowsOf(tables.boardFeeSchedule).map(readFeeCap),
      incidents: rowsOf(tables.openIncidents).map((row) => ({ id: idOf(row.id), kind: tagOf(row.kind), zoneName: zones.get(idOf(row.zoneId)) ?? '' })),
      picks: rowsOf(tables.boardMerchPicks).map((row) => readBoardPick(row, templateMap)),
      night: { startsAt: millis(venue?.startsAt), endsAt: millis(venue?.endsAt) },
    },
    wallet: {
      entries: rowsOf(tables.myWalletEntries).map(readWalletEntry),
      charges: rowsOf(tables.myCharges).map(readMyCharge),
      orders: rowsOf(tables.myMerchOrders).map(readMerchOrder),
      suggestions: rowsOf(tables.myMerchSuggestions).map(readSuggestion),
      templates,
      photos: rowsOf(tables.myPhotos).map(readNightPhoto).sort((a, b) => b.takenAt - a.takenAt),
    },
  }
}

let pending: unknown = null
let timer = 0

export function schedulePayments(db: unknown) {
  pending = db
  if (timer) return
  timer = window.setTimeout(() => {
    timer = 0
    const next = pending
    pending = null
    if (next) usePayments.setState(readPayments(next))
  }, 600)
}
