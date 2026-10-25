import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { fieldClass } from '@/cover/fields'
import { useRoute } from '@/cover/route'
import { bandFromCode } from '@/lib/bandCode'

function NightHeader() {
  const { go } = useRoute()
  return (
    <header className="flex flex-wrap items-baseline justify-between gap-4">
      <button type="button" onClick={() => go('/join')} className="font-display text-[30px] leading-none text-ink">
        BandIt
      </button>
      <nav aria-label="Night" className="flex items-baseline gap-5 text-[14px]">
        <button type="button" onClick={() => go('/')} className="text-ink-dim hover:text-ink">
          Live
        </button>
      </nav>
    </header>
  )
}

/**
 * The attendee side of the night: tapping a band opens its sign-up page, and the code can be
 * typed here when the tag can't be read.
 */
export function JoinPage() {
  const { go } = useRoute()
  const [code, setCode] = useState('')
  const [error, setError] = useState('')

  const open = (event: FormEvent) => {
    event.preventDefault()
    const trimmed = code.trim()
    if (!trimmed) {
      setError('Type the code on the band.')
      return
    }
    if (!/^band-\d{1,3}$/i.test(trimmed) && !bandFromCode(trimmed)) {
      setError('That is not a band code.')
      return
    }
    go(`/register?band=${encodeURIComponent(trimmed)}`)
  }

  return (
    <div data-page data-motif="invite" className="desk-night h-full overflow-y-auto bg-ground text-ink">
      <div className="mx-auto w-full max-w-[1200px] px-5 py-6 md:px-10 md:py-8">
        <NightHeader />

        <div className="mt-14 grid items-start gap-12 md:mt-20 md:grid-cols-2">
          <div className="desk-card">
            <h1 className="font-display text-[clamp(40px,5vw,64px)] leading-[0.95] tracking-[-0.03em] text-ink">
              The wristband holds the night.
            </h1>
            <p className="mt-6 max-w-[36ch] text-[16px] leading-7 text-ink">
              Tap the band on your phone, or type its code.
            </p>
          </div>

          <form onSubmit={open} noValidate>
            <label htmlFor="band-code" className="mb-2 block text-[14px] font-medium text-ink">
              Band code
            </label>
            <input
              id="band-code"
              value={code}
              onChange={(event) => { setCode(event.target.value); setError('') }}
              className={fieldClass}
              placeholder="K3QX-9A7M"
              autoComplete="off"
              inputMode="text"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'band-code-error' : undefined}
            />
            {error && <p id="band-code-error" role="alert" className="mt-2 text-[13px] text-signal">{error}</p>}
            <Button type="submit" className="mt-6 h-11 px-4">
              Open this band
            </Button>
          </form>
        </div>

        <section className="mt-28">
          <h2 className="font-display text-[32px] leading-none text-ink md:text-[40px]">What the band holds</h2>
          <div className="mt-10 grid gap-10 md:grid-cols-[12rem_minmax(0,1fr)] md:gap-y-12">
            <h3 className="font-display text-[28px] leading-none text-ink">Medical</h3>
            <p className="text-[16px] leading-7 text-ink">
              Allergies, conditions, medications and who to call. The aid station reads them when the band is tapped.
            </p>
            <h3 className="font-display text-[28px] leading-none text-ink">Claims</h3>
            <p className="text-[16px] leading-7 text-ink">
              Cameras and bands file what happened. The insurer settles what the policy covers.
            </p>
            <h3 className="font-display text-[28px] leading-none text-ink">Wallet</h3>
            <p className="text-[16px] leading-7 text-ink">
              Your wallet opens with the band. A tap pays.
            </p>
          </div>
        </section>

        <footer className="mt-28 pb-16">
          <p className="font-display text-[48px] leading-none text-ink">BandIt</p>
        </footer>
      </div>
    </div>
  )
}
