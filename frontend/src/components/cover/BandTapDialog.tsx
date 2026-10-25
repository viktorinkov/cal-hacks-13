import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useRoute } from '@/cover/route'
import { formatCents } from '@/cover/money'
import { useSession } from '@/stdb/session'

/** A tap reads the medical card the database will release, and this person's wallet. */
export function BandTapDialog({ deviceId, bandNumber, onClose }: { deviceId: string; bandNumber?: number; onClose: () => void }) {
  const { go } = useRoute()
  const label = deviceId.replace(/^band-/, '')
  const number = bandNumber ?? Number(label)
  const phase = useSession((state) => state.phase)
  const cards = useSession((state) => state.cards)
  const wallet = useSession((state) => state.wallet)
  const actionError = useSession((state) => state.actionError)
  const busy = useSession((state) => state.busy)
  const requestCard = useSession((state) => state.requestCard)
  const connectWallet = useSession((state) => state.connectWallet)
  const card = cards.find((item) => item.bandId === number)

  const edit = () => {
    onClose()
    go(`/register?band=${deviceId}`)
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto bg-popover text-ink sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="font-display text-[28px] font-normal text-ink">Band {label}</DialogTitle>
          <DialogDescription className="text-[14px] text-ink-dim">
            {card ? 'The database released this card for an open incident.' : 'A medic can read the card only while an SOS or fall is open.'}
          </DialogDescription>
        </DialogHeader>
        {card ? (
          <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-y-2 text-[14px]">
            {card.name && (
              <>
                <dt className="text-ink-dim">Name</dt>
                <dd>{card.name}</dd>
              </>
            )}
            <dt className="text-ink-dim">Blood</dt>
            <dd>{card.bloodType || 'Unknown'}</dd>
            <dt className="text-ink-dim">Allergies</dt>
            <dd>{card.allergies || 'None on the card'}</dd>
            <dt className="text-ink-dim">Conditions</dt>
            <dd>{card.conditions || 'None on the card'}</dd>
            <dt className="text-ink-dim">Medications</dt>
            <dd>{card.medications || 'None on the card'}</dd>
            <dt className="text-ink-dim">Emergency</dt>
            <dd>{card.emergencyContact || 'None on the card'}</dd>
            <dt className="text-ink-dim">Insurance</dt>
            <dd>{card.insurer ? `${card.insurer} ${card.plan} · ${card.memberId}` : 'None on the card'}</dd>
          </dl>
        ) : (
          <p className="text-[14px] leading-6 text-ink-dim">No card is released for this band.</p>
        )}
        <div className="flex flex-col gap-3">
          {phase === 'live' && number > 0 && (
            <Button type="button" className="h-11" disabled={busy} onClick={() => void requestCard(number)}>
              Read the medical card
            </Button>
          )}
          {actionError && <p className="text-[14px] text-signal">{actionError}</p>}
          {wallet ? (
            <p className="text-[14px] text-ink">{`Wallet ${wallet.accountId.slice(0, 8)} · ${formatCents(wallet.balanceCents)} to spend.`}</p>
          ) : phase === 'live' ? (
            <Button type="button" variant="outline" className="h-11" disabled={busy} onClick={() => void connectWallet()}>
              Open the wallet
            </Button>
          ) : (
            <p className="text-[13px] text-ink-dim">The wallet opens once the database is connected.</p>
          )}
          <button type="button" onClick={edit} className="self-start text-[14px] text-ink">
            Register this band
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
