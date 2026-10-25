import { useEffect, useState, type ReactNode } from 'react'
import { beginSignIn, finishSignIn, staffSignedIn } from '@/stdb/auth'
import { loadHostConfig, type HostConfig } from '@/stdb/host'
import { useRoute } from '@/cover/route'

const gateButton =
  'rounded-[3px] px-3 py-2 text-[13px] text-ink shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)] hover:bg-white/5'

function GateCopy({ children }: { children: ReactNode }) {
  return (
    <div className="grid h-full place-items-center bg-ground">
      <div className="flex max-w-md flex-col items-start gap-4 px-8">{children}</div>
    </div>
  )
}

/** Email sign-in, the same client the live organizer portal uses. A `?as=` test identity skips it. */
export function OrganizerGate({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HostConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  const as = new URLSearchParams(window.location.search).get('as')

  useEffect(() => {
    let cancel = false
    void loadHostConfig().then((next) => {
      if (!cancel) setHost(next)
    })
    return () => {
      cancel = true
    }
  }, [])

  if (!host) {
    return (
      <GateCopy>
        <span className="font-display text-[34px] leading-none text-ink">BandIt</span>
        <p className="text-[15px] text-ink-dim" role="status">
          Opening the organizer…
        </p>
      </GateCopy>
    )
  }

  if (host.authClientId && !staffSignedIn() && !as) {
    const here = window.location.hostname === 'band1t.vip'
    return (
      <GateCopy>
        <span className="font-display text-[34px] leading-none text-ink">BandIt</span>
        <h1 className="font-display text-[28px] leading-none text-ink">Organizer</h1>
        <p className="text-[15px] leading-relaxed text-ink-dim">
          Sign in with your staff email. This desk uses the same database as the live organizer portal.
        </p>
        {error && <p className="text-[13px] text-ink">{error}</p>}
        <button
          type="button"
          className={gateButton}
          onClick={() => {
            setError(null)
            void beginSignIn().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Sign-in did not start.'))
          }}
        >
          Sign in with email
        </button>
        {!here && (
          <p className="text-[13px] leading-relaxed text-ink-muted">
            Email sign-in is registered for band1t.vip. On this machine, open the{' '}
            <a className="text-ink underline underline-offset-2" href="https://band1t.vip/organizer">
              live portal
            </a>{' '}
            or continue with the ops test identity.
          </p>
        )}
        {!here && (
          <button type="button" className={gateButton} onClick={() => window.location.assign('/organizer?as=ops')}>
            Continue as ops
          </button>
        )}
      </GateCopy>
    )
  }

  return children
}

export function SignInCallback() {
  const { go } = useRoute()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancel = false
    void finishSignIn()
      .then(() => {
        if (!cancel) go('/organizer')
      })
      .catch((reason: unknown) => {
        if (!cancel) setError(reason instanceof Error ? reason.message : 'Sign-in did not complete.')
      })
    return () => {
      cancel = true
    }
  }, [go])

  return (
    <GateCopy>
      <span className="font-display text-[34px] leading-none text-ink">BandIt</span>
      {error ? (
        <>
          <p className="text-[15px] text-ink">Sign-in did not complete.</p>
          <p className="text-[13px] text-ink-muted">{error}</p>
          <button type="button" className={gateButton} onClick={() => go('/organizer')}>
            Back to the organizer
          </button>
        </>
      ) : (
        <p className="text-[15px] text-ink-dim" role="status">
          Signing in…
        </p>
      )}
    </GateCopy>
  )
}
