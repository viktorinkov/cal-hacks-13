import { create } from 'zustand'
import { formatCents } from '@/cover/money'
import { useRoute } from '@/cover/route'
import { useSession, type WalletView } from '@/stdb/session'
import { FIXTURE_BAND, FIXTURE_DESK, FIXTURE_NOW, FIXTURE_WALLET, FIXTURE_WALLET_VIEW, isPaymentsFixture } from './fixture'
import type { DeskData, WalletData } from './rows'
import { usePayments, type PaymentsState } from './store'

/* The fixture's own small backend: the same effects the reducers have, on a local copy, never on the host. */
interface FixtureState extends PaymentsState {
  walletView: WalletView
}

const fixtureStart = (): FixtureState => ({
  desk: { ...FIXTURE_DESK, charges: [...FIXTURE_DESK.charges], orders: [...FIXTURE_DESK.orders] },
  wallet: { ...FIXTURE_WALLET, charges: [...FIXTURE_WALLET.charges], orders: [...FIXTURE_WALLET.orders] },
  walletView: FIXTURE_WALLET_VIEW,
})

export const useFixturePayments = create<FixtureState>(() => fixtureStart())

export function resetFixturePayments() {
  useFixturePayments.setState(fixtureStart())
}

const later = (ms = 450) => new Promise((resolve) => setTimeout(resolve, ms))
let ticks = 0
const stamp = () => FIXTURE_NOW + ++ticks * 60_000

export interface PaymentActions {
  approveCharge: (chargeId: string, amountSeenCents: number, packHashSeen: string) => Promise<void>
  waiveCharge: (chargeId: string, reason: string) => Promise<void>
  buyMerchAs: (nodeId: string, templateId: string, photoId: string, size: string) => Promise<void>
  disputeCharge: (chargeId: string, text: string) => Promise<void>
  buyMerch: (templateId: string, photoId: string, size: string) => Promise<void>
  rerunShoppingAgent: () => Promise<void>
  connectWallet: () => Promise<void>
}

function decideFixture(chargeId: string, change: (status: string) => Partial<DeskData['charges'][number]>) {
  useFixturePayments.setState((state) => ({
    desk: { ...state.desk, charges: state.desk.charges.map((charge) => (charge.id === chargeId ? { ...charge, ...change(charge.status) } : charge)) },
  }))
}

export const fixtureActions: PaymentActions = {
  approveCharge: async (chargeId, amountSeenCents, packHashSeen) => {
    await later()
    const charge = useFixturePayments.getState().desk.charges.find((item) => item.id === chargeId)
    if (!charge) throw new Error('That charge is no longer on the desk.')
    if (charge.amountCents !== amountSeenCents || charge.packHash !== packHashSeen) {
      throw new Error(`The charge changed to ${formatCents(charge.amountCents)} since you opened it.`)
    }
    decideFixture(chargeId, () => ({ status: 'approved', approvedByName: 'You (sample)', decidedAt: stamp() }))
    setTimeout(() => useFixturePayments.setState((state) => {
      const settled = state.desk.charges.find((item) => item.id === chargeId)
      if (!settled || settled.status !== 'approved') return {}
      const person = state.desk.people.find((item) => item.bandId === settled.bandId)
      const take = (balanceCents: number) => balanceCents - settled.amountCents
      return {
        desk: {
          ...state.desk,
          charges: state.desk.charges.map((item) => (item.id === chargeId ? { ...item, status: 'paid', paidAt: stamp(), paymentReference: `sample-${chargeId}` } : item)),
          wallets: state.desk.wallets.map((wallet) => (person && wallet.nodeId === person.nodeId ? { ...wallet, balanceCents: take(wallet.balanceCents) } : wallet)),
        },
        ...(settled.bandId === FIXTURE_BAND ? { walletView: { ...state.walletView, balanceCents: take(state.walletView.balanceCents) } } : {}),
      }
    }), 1500)
  },
  waiveCharge: async (chargeId, reason) => {
    if (!reason.trim()) throw new Error('Write why the charge is waived.')
    await later()
    decideFixture(chargeId, () => ({ status: 'waived', approvedByName: 'You (sample)', waiveReason: reason.trim(), decidedAt: stamp() }))
  },
  buyMerchAs: async (nodeId, templateId, photoId, size) => {
    await later()
    useFixturePayments.setState((state) => {
      const template = state.desk.templates.find((item) => item.id === templateId)
      const person = state.desk.people.find((item) => item.nodeId === nodeId)
      return {
        desk: {
          ...state.desk,
          orders: [...state.desk.orders, {
            id: String(8000 + state.desk.orders.length), attendeeName: person?.name ?? '', nodeId, templateId, photoId, title: template?.title ?? '', size,
            amountCents: template?.priceCents ?? 0, status: 'pending', failure: '', nessiePurchaseId: '', createdAt: stamp(), updatedAt: null, line: '', photoUrl: '',
          }],
        },
      }
    })
  },
  disputeCharge: async (chargeId, text) => {
    if (!text.trim()) throw new Error('Say what isn’t right.')
    await later()
    useFixturePayments.setState((state) => ({
      wallet: { ...state.wallet, charges: state.wallet.charges.map((charge) => (charge.id === chargeId ? { ...charge, status: 'disputed', disputeText: text.trim() } : charge)) },
    }))
  },
  buyMerch: async (templateId, photoId, size) => {
    await later()
    useFixturePayments.setState((state) => {
      const template = state.wallet.templates.find((item) => item.id === templateId)
      const id = String(9000 + state.wallet.orders.length)
      return {
        wallet: {
          ...state.wallet,
          orders: [...state.wallet.orders, {
            id, attendeeName: '', nodeId: '', templateId, photoId, title: '', size, amountCents: template?.priceCents ?? 0,
            status: 'pending', failure: '', nessiePurchaseId: '', createdAt: stamp(), updatedAt: null, line: '', photoUrl: '',
          }],
        },
      }
    })
  },
  rerunShoppingAgent: async () => {
    await later()
  },
  connectWallet: async () => {
    await later()
  },
}

export function usePaymentsFixture(): boolean {
  const { search } = useRoute()
  return isPaymentsFixture(search)
}

export function usePaymentActions(): PaymentActions {
  const fixture = usePaymentsFixture()
  const approveCharge = useSession((s) => s.approveCharge)
  const waiveCharge = useSession((s) => s.waiveCharge)
  const buyMerchAs = useSession((s) => s.buyMerchAs)
  const disputeCharge = useSession((s) => s.disputeCharge)
  const buyMerch = useSession((s) => s.buyMerch)
  const rerunShoppingAgent = useSession((s) => s.rerunShoppingAgent)
  const connectWallet = useSession((s) => s.connectWallet)
  if (fixture) return fixtureActions
  return { approveCharge, waiveCharge, buyMerchAs, disputeCharge, buyMerch, rerunShoppingAgent, connectWallet }
}

export function useDeskData(): DeskData {
  const fixture = usePaymentsFixture()
  const live = usePayments((s) => s.desk)
  const sample = useFixturePayments((s) => s.desk)
  return fixture ? sample : live
}

export function useWalletData(): { data: WalletData; view: WalletView | null } {
  const fixture = usePaymentsFixture()
  const live = usePayments((s) => s.wallet)
  const sample = useFixturePayments((s) => s.wallet)
  const sampleView = useFixturePayments((s) => s.walletView)
  const liveView = useSession((s) => s.wallet)
  return fixture ? { data: sample, view: sampleView } : { data: live, view: liveView }
}
