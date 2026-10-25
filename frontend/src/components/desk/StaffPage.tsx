import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { addStaffMember, removeStaffMember, useDesk } from '@/stdb/deskOps'
import { useSession } from '@/stdb/session'
import { DeskFrame } from './DeskFrame'

const ROLES = [
  { value: 'medic', label: 'Medic' },
  { value: 'ops', label: 'Organizer' },
  { value: 'photographer', label: 'Photographer' },
] as const

const field = 'h-9 rounded-[4px] border border-line-strong bg-ground px-3 text-[14px] text-ink outline-none placeholder:text-ink-muted'

function roleName(role: string): string {
  return ROLES.find((item) => item.value === role)?.label ?? role
}

/** Owner-only. Add and remove medics, organizers, and photographers by the email they sign in with. */
export function StaffPage() {
  const owner = useSession((s) => s.owner)
  const staff = useDesk((s) => s.staff)
  const error = useDesk((s) => s.error)
  const busy = useDesk((s) => s.busy)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<(typeof ROLES)[number]['value']>('medic')
  const [removing, setRemoving] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    try {
      await addStaffMember(email, role, name)
      setName('')
      setEmail('')
    } catch {
      // The desk store keeps the refusal.
    }
  }

  return (
    <DeskFrame motif="staff" title="Staff" sentence="Add staff by the email they sign in with. A medic who then taps a band with their phone gets the wearer's medical card.">
      {!owner ? (
        <p className="text-[15px] text-ink">Only the owner can add or remove staff.</p>
      ) : (
        <>
          <form onSubmit={(event) => void submit(event)} className="grid gap-3 sm:grid-cols-[1fr_1.2fr_9rem_auto] sm:items-end">
            <label className="text-[13px] text-ink-dim">
              Name
              <input value={name} onChange={(event) => setName(event.target.value)} required className={`${field} mt-1 w-full`} />
            </label>
            <label className="text-[13px] text-ink-dim">
              Email
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required className={`${field} mt-1 w-full`} />
            </label>
            <label className="text-[13px] text-ink-dim">
              Role
              <select value={role} onChange={(event) => setRole(event.target.value as (typeof ROLES)[number]['value'])} className={`${field} mt-1 w-full`}>
                {ROLES.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </label>
            <Button type="submit" variant="outline" className="h-9 px-3" disabled={busy}>Add</Button>
          </form>
          {error && <p className="mt-4 text-[14px] text-signal">{error}</p>}
          {staff.length === 0 ? (
            <p className="mt-8 text-[14px] text-ink-dim">No staff yet.</p>
          ) : (
            <ul className="mt-8 divide-y divide-line">
              {staff.map((member) => (
                <li key={member.id} className="grid gap-2 py-3 sm:grid-cols-[1fr_1.2fr_8rem_6rem_auto] sm:items-baseline">
                  <p className="text-[15px] text-ink">{member.name}</p>
                  <p className="text-[14px] text-ink-dim">{member.email}</p>
                  <p className="text-[14px] text-ink">{roleName(member.role)}</p>
                  <p className="text-[13px] text-ink-muted">{member.signedIn ? 'Signed in' : 'Not yet'}</p>
                  {removing === member.id ? (
                    <span className="flex gap-3 text-[13px]">
                      <button type="button" className="text-ink hover:text-champagne" onClick={() => void removeStaffMember(member.id).then(() => setRemoving(null)).catch(() => setRemoving(null))}>
                        {`Remove ${roleName(member.role).toLowerCase()}`}
                      </button>
                      <button type="button" className="text-ink-muted" onClick={() => setRemoving(null)}>Keep</button>
                    </span>
                  ) : (
                    <button type="button" className="text-left text-[13px] text-ink-dim hover:text-ink" onClick={() => setRemoving(member.id)}>Remove</button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </DeskFrame>
  )
}
