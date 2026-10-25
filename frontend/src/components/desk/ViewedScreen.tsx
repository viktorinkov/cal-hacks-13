import type { SyntheticEvent } from 'react'
import { ClaimsDesk } from '@/components/claims/ClaimsDesk'
import { MedicalReview, RegisterPage } from '@/components/join/RegisterPage'
import { PhotographerPage } from '@/components/photo/PhotographerPage'
import { Recap } from '@/components/recap/Recap'
import { WalletPage } from '@/components/wallet/WalletPage'
import { useSession } from '@/stdb/session'

function stop(event: SyntheticEvent) { event.preventDefault(); event.stopPropagation() }

/** Real screens in their own session. Scrolling works, but controls cannot change data. */
export function ViewedScreen() {
  const phase = useSession((s) => s.phase)
  const error = useSession((s) => s.error)
  const card = useSession((s) => s.medicalCard)
  const cardReady = useSession((s) => s.medicalCardReady)
  const query = new URLSearchParams(window.location.search)
  const screen = query.get('screen')
  const bandId = Number(query.get('bandId'))
  if (phase === 'error') return <p role="alert" className="p-6 text-signal">{error}</p>
  if (phase !== 'live') return <p role="status" className="p-6 text-ink-dim">Opening their page…</p>
  let page
  if (screen === 'card') page = <main className="signup-main p-6"><h1 className="mb-6 text-[22px]">Medical card</h1>{!cardReady ? <p role="status">Loading their card…</p> : card ? <MedicalReview card={card} confirming={false} blocked={false} onConfirm={() => {}} /> : <p>No medical card has been saved.</p>}</main>
  else if (screen === 'recap') page = <main className="wallet-main p-6"><Recap showWalletLink /></main>
  else if (screen === 'wallet') page = <WalletPage viewBandId={Number.isSafeInteger(bandId) && bandId > 0 ? bandId : undefined} />
  else if (screen === 'photo') page = <PhotographerPage />
  else if (screen === 'claims') page = <ClaimsDesk />
  else page = <RegisterPage viewBandId={Number.isSafeInteger(bandId) && bandId > 0 ? bandId : undefined} />
  return <div className="h-full bg-ground text-ink" data-viewing="true" onClickCapture={stop} onSubmitCapture={stop} onDropCapture={stop} onKeyDownCapture={(event) => { if (event.key === 'Enter' || event.key === ' ') stop(event) }}>
    <fieldset disabled className="m-0 h-full min-w-0 border-0 p-0" aria-label="Read-only view">{page}</fieldset>
  </div>
}
