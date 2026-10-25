import { useState, type ReactNode } from 'react'
import { staffSignedIn } from '@/stdb/auth'
import { linkReducers, messageOf } from '@/stdb/link'
import { useSession } from '@/stdb/session'

const gateButton =
  'rounded-[3px] px-3 py-2 text-[13px] text-ink shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)] hover:bg-white/5'

type AccessReducers = { joinOrganizer(args: Record<string, never>): Promise<unknown> }

/** Gives this email sign-in the organizer role, as the live portal's organizer access page does. */
async function joinOrganizer(): Promise<void> {
  await linkReducers<AccessReducers>().joinOrganizer({})
}

/**
 * A signed-in email with no staff role sees an empty desk. Once the roles view has answered and
 * holds nothing for this identity, offer to join as the organizer instead.
 */
export function JoinOrganizerGate({ children }: { children: ReactNode }) {
  const phase = useSession((s) => s.phase)
  const owner = useSession((s) => s.owner)
  const roles = useSession((s) => s.roles)
  const rolesAnswered = useSession((s) => s.staffQueries['SELECT * FROM my_roles'] === 'open')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const asTester = new URLSearchParams(window.location.search).has('as')

  if (asTester || !staffSignedIn() || phase !== 'live' || !rolesAnswered || owner || roles.length > 0) return children

  const join = async () => {
    setBusy(true)
    setError(null)
    try {
      await joinOrganizer()
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid h-full place-items-center bg-ground">
      <div className="flex max-w-md flex-col items-start gap-4 px-8">
        <span className="font-display text-[34px] leading-none text-ink">BandIt</span>
        <h1 className="font-display text-[28px] leading-none text-ink">Organizer access</h1>
        <p className="text-[15px] leading-relaxed text-ink-dim">
          This email is signed in but has no staff role yet. Continue as the organizer to run the event from this desk.
        </p>
        {error && <p className="text-[13px] text-signal" role="alert">{error}</p>}
        <button type="button" className={gateButton} disabled={busy} onClick={() => void join()}>
          {busy ? 'Opening the organizer…' : 'Continue as organizer'}
        </button>
      </div>
    </div>
  )
}
