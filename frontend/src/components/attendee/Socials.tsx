import { useState, type KeyboardEvent } from 'react'
import { socialLink } from '@/recap/copy'
import { cleanHandle, KEYS, saveSocials, SOCIAL_PLATFORMS, useAttendee, type SocialPlatform } from '@/stdb/attendeeOps'
import './attendee.css'

type Draft = Partial<Record<SocialPlatform, string>>

/**
 * The attendee's Instagram, Facebook and Threads handles. People they spend time with see them in
 * their recap. Not a <form>, so it can sit inside the sign-up form: Enter saves these fields only.
 * `bare` leaves out the heading, for a sign-up step that already has one.
 */
export function Socials({ bare = false }: { bare?: boolean }) {
  const attendee = useAttendee((s) => s.attendee)
  const handles = useAttendee((s) => s.handles)
  const pending = useAttendee((s) => Boolean(s.pending[KEYS.socials]))
  const error = useAttendee((s) => s.errors[KEYS.socials])
  const [draft, setDraft] = useState<Draft>({})
  const [saved, setSaved] = useState(false)
  const current = (id: SocialPlatform) => handles.find((row) => row.platform === id)?.handle.replace(/^@+/, '') ?? ''
  const value = (id: SocialPlatform) => draft[id] ?? current(id)
  const changed = SOCIAL_PLATFORMS.some(({ id }) => draft[id] !== undefined && cleanHandle(draft[id] ?? '') !== current(id))
  const disabled = !attendee || pending

  const save = async () => {
    if (disabled || !changed) return
    setSaved(false)
    if (await saveSocials(draft)) {
      setDraft({})
      setSaved(true)
    }
  }
  const onEnter = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' || !(event.target instanceof HTMLInputElement)) return
    event.preventDefault()
    void save()
  }

  return (
    <section aria-labelledby={bare ? undefined : 'attendee-socials'} aria-label={bare ? 'Your socials' : undefined} className="attendee-section">
      {!bare && (
        <>
          <h2 id="attendee-socials">Your socials</h2>
          <p className="attendee-lead">People you spend time with can see these after the event.</p>
        </>
      )}
      {handles.length > 0 && (
        <p className="attendee-handles" aria-label="Shared now">
          {handles.map((row) => {
            const link = socialLink(row.platform, row.handle)
            return link.href
              ? <a key={row.platform} href={link.href} target="_blank" rel="noreferrer">{link.label}</a>
              : <span key={row.platform} className="text-ink-dim">{link.label}</span>
          })}
        </p>
      )}
      <div role="group" aria-label="Social handles" onKeyDown={onEnter} className={bare ? '' : 'attendee-panel'}>
        <div className="attendee-fields is-three">
          {SOCIAL_PLATFORMS.map(({ id, label }) => (
            <div key={id}>
              <label htmlFor={`social-${id}`} className="attendee-label">{label}</label>
              <input
                id={`social-${id}`}
                name={`social-${id}`}
                value={value(id)}
                placeholder="@handle"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                disabled={!attendee}
                onChange={(event) => { setDraft((now) => ({ ...now, [id]: event.target.value })); setSaved(false) }}
                className="signup-input"
              />
            </div>
          ))}
        </div>
        {error && <p role="alert" className="attendee-error">{error}</p>}
        <div className="attendee-actions">
          <button type="button" onClick={() => void save()} disabled={disabled || !changed} className="signup-primary text-[14px]">
            {pending ? 'Saving…' : 'Save socials'}
          </button>
          {saved && !changed && <span role="status" className="text-[13px] text-teal">Saved.</span>}
        </div>
        {!attendee
          ? <p className="attendee-hint">Your socials open once this band is yours.</p>
          : !attendee.findable && <p className="attendee-hint">Your profile is private, so only you see these for now.</p>}
      </div>
    </section>
  )
}
