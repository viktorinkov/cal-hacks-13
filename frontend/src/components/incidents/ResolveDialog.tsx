import { useState } from 'react'
import type { Incident, ResolutionReason } from '@/contracts/domain'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { pendingKey, resolveIncident } from '@/services/operatorCommands'
import { useUi } from '@/stores/ui'

const REASONS: { value: ResolutionReason; label: string; hint: string }[] = [
  { value: 'assisted_on_scene', label: 'Assisted on scene', hint: 'The medic is with them and no transport is needed.' },
  { value: 'handed_to_medical', label: 'Handed to medical', hint: 'Taken to First Aid or an ambulance.' },
  { value: 'false_alarm', label: 'False alarm', hint: 'Pressed by accident, or not a fall.' },
  { value: 'other', label: 'Other', hint: 'Closed for another reason.' },
]

export function ResolveDialog({
  incident,
  open,
  onOpenChange,
  defaultReason = 'assisted_on_scene',
}: {
  incident: Incident
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultReason?: ResolutionReason
}) {
  const [reason, setReason] = useState<ResolutionReason>(defaultReason)
  const busy = useUi((s) => !!s.pending[pendingKey.resolve(incident.incidentId)])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-0 bg-popover shadow-[0_0_0_1px_var(--nc-line),0_30px_80px_rgba(0,0,0,0.6)] sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-[30px] font-normal leading-none">Resolve {incident.displayId}</DialogTitle>
          <DialogDescription className="text-[13px] text-ink-dim">
            Every band goes back to ready once it confirms. This closes the incident for everyone.
          </DialogDescription>
        </DialogHeader>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="sr-only">Outcome</legend>
          {REASONS.map((r) => (
            <label
              key={r.value}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-[3px] px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--nc-line)] hover:bg-accent',
                reason === r.value && 'shadow-[inset_0_0_0_1px_var(--nc-champagne)]',
              )}
            >
              <input
                type="radio"
                name="reason"
                value={r.value}
                checked={reason === r.value}
                onChange={() => setReason(r.value)}
                className="mt-1 accent-[var(--nc-champagne)]"
              />
              <span className="flex flex-col">
                <span className="text-[14px] text-ink">{r.label}</span>
                <span className="text-[12px] text-ink-muted">{r.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={busy}
            onClick={async () => {
              const ok = await resolveIncident(incident.incidentId, reason)
              if (ok) onOpenChange(false)
            }}
            className="h-9 px-4 text-[14px] font-semibold hover:bg-champagne-hover"
          >
            {busy ? 'Resolving…' : `Resolve ${incident.displayId}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
