import { useMemo, useState, useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/button'
import { CoverSlip } from '@/components/cover/CoverSlip'
import { MOCK_BANDS } from '@/mock/bands'
import { statusLabel } from '@/cover/liveClaims'
import { fieldClass } from '@/cover/fields'
import { formatCents } from '@/cover/money'
import { getCoverRevision, getRegistration, subscribeCover } from '@/cover/registry'
import { useRoute } from '@/cover/route'
import { useSession } from '@/stdb/session'

function NightHeader() {
  const { go } = useRoute()
  return (
    <header className="flex flex-wrap items-baseline justify-between gap-4">
      <button type="button" onClick={() => go('/join')} className="font-display text-[30px] leading-none text-ink">
        BandIt
      </button>
      <nav aria-label="Night" className="flex items-baseline gap-5 text-[14px]">
        <button type="button" onClick={() => go('/')} className="text-ink-dim hover:text-ink">
          Map
        </button>
        <button type="button" onClick={() => go('/claims')} className="text-ink-dim hover:text-ink">
          Claims
        </button>
      </nav>
    </header>
  )
}

/**
 * The attendee side of the night: one band holds the medical record, the rider and a card.
 * Choosing a band is the live thing. It reads the same registration a tap opens on the floor.
 */
export function JoinPage() {
  const { go } = useRoute()
  const claims = useSession((state) => state.claims)
  const [bandId, setBandId] = useState('band-05')
  const revision = useSyncExternalStore(subscribeCover, getCoverRevision, getCoverRevision)
  const registration = useMemo(() => getRegistration(bandId), [bandId, revision])
  const band = MOCK_BANDS.find((item) => item.deviceId === bandId)
  const related = claims.find((claim) => claim.bandId === Number(band?.label))

  return (
    <div data-page className="h-full overflow-y-auto bg-ground text-ink">
      <div className="mx-auto w-full max-w-[1200px] px-5 py-6 md:px-10 md:py-8">
        <NightHeader />

        <div className="mt-14 grid items-start gap-12 md:mt-20 md:grid-cols-2">
          <div>
            <h1 className="font-display text-[clamp(40px,5vw,64px)] leading-[0.95] tracking-[-0.03em] text-ink">
              The wristband holds the night.
            </h1>
            <p className="mt-6 max-w-[36ch] text-[16px] leading-7 text-ink">
              Register it once. The aid station reads the medical record, the cameras file against the policy, and a tap charges the card.
            </p>
            <Button type="button" className="mt-8 h-11 px-4" onClick={() => go(`/register?band=${bandId}`)}>
              Register this band
            </Button>
          </div>

          <div>
            <label htmlFor="preview-band" className="mb-2 block text-[14px] font-medium text-ink">
              Band
            </label>
            <select id="preview-band" value={bandId} onChange={(event) => setBandId(event.target.value)} className={fieldClass}>
              {MOCK_BANDS.map((item) => {
                const stored = getRegistration(item.deviceId)
                const who = stored?.name || item.wearer || 'Empty'
                return (
                  <option key={item.deviceId} value={item.deviceId}>
                    Band {item.label} · {who}
                  </option>
                )
              })}
            </select>
            <div className="mt-4">
              <CoverSlip registration={registration} bandLabel={band?.label ?? bandId} />
            </div>
            <p className="mt-4 text-[14px] leading-6 text-ink">
              {related
                ? `${related.id} · ${statusLabel(related.status)} · ${formatCents(related.payoutCents)} payable.`
                : 'No claim on this band tonight.'}
            </p>
            <button type="button" onClick={() => go('/claims')} className="mt-2 text-[14px] text-ink-dim hover:text-ink">
              See tonight's claims
            </button>
          </div>
        </div>

        <section className="mt-28">
          <h2 className="font-display text-[32px] leading-none text-ink md:text-[40px]">What a tap reads</h2>
          <div className="mt-10 grid gap-10 md:grid-cols-[12rem_minmax(0,1fr)] md:gap-y-12">
            <h3 className="font-display text-[28px] leading-none text-ink">Medical</h3>
            <p className="text-[16px] leading-7 text-ink">
              Allergies, conditions, medications, and who to call. The aid station sees them when the band is tapped. They are not sent to Northline.
            </p>
            <h3 className="font-display text-[28px] leading-none text-ink">Insurance</h3>
            <p className="text-[16px] leading-7 text-ink">
              CAM-01 and CAM-02 name what broke and which band was in the frame. Northline files what the rider covers and holds the rest for a person on the claims desk.
            </p>
            <h3 className="font-display text-[28px] leading-none text-ink">Payment</h3>
            <p className="text-[16px] leading-7 text-ink">
              The last four digits and the expiry stay on the registration. A tap charges that card. The full number is never stored here.
            </p>
          </div>
        </section>

        <section className="mt-28">
          <h2 className="font-display text-[32px] leading-none text-ink md:text-[40px]">How a claim is filed</h2>
          <div className="mt-8 grid gap-8 md:grid-cols-2">
            <p className="text-[16px] leading-7 text-ink">
              The camera sees the damage. Vision names the person, and the band's last NFC read has to agree. If two people are in the frame, the filing waits until someone on the desk confirms the band.
            </p>
            <p className="text-[16px] leading-7 text-ink">
              Northline then applies the $250.00 deductible and the exclusions. A bent speaker can be filed. A scuffed rail under the deductible, or a chair the rider calls wear, is closed without a payment.
            </p>
          </div>
        </section>

        <footer className="mt-28 pb-16">
          <p className="font-display text-[48px] leading-none text-ink">BandIt</p>
          <p className="mt-3 max-w-[36ch] text-[14px] leading-6 text-ink-dim">Main Stage. Sample records for bands 02, 04, 05 and 06 live in this browser.</p>
        </footer>
      </div>
    </div>
  )
}
