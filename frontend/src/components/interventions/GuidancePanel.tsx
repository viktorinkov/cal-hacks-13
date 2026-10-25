import { Check, Loader2, RotateCw, X } from 'lucide-react'
import type { Device, DeviceTarget, GuidanceCommand, Incident, ResponderCorridor } from '@/contracts/domain'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useServerNow } from '@/hooks/useServerNow'
import { elapsed } from '@/lib/format'
import { simBandsFor } from '@/lib/status'
import { cn } from '@/lib/utils'
import { pendingKey, previewGuidance, resendGuidance } from '@/services/operatorCommands'
import { useUi } from '@/stores/ui'
import { useWorld } from '@/stores/world'
import { LedGlyph } from './LedGlyph'

function TargetChip({ t, device }: { t: DeviceTarget; device?: Device }) {
  const label = device?.label ?? t.deviceId
  const state =
    t.status === 'acknowledged' ? 'confirmed' : t.status === 'failed' ? 'did not confirm' : t.status === 'cancelled' ? 'cancelled' : 'waiting'
  return (
    <span
      title={`band-${label}: ${state}${t.attempts > 1 ? `, try ${t.attempts}` : ''}`}
      className={cn(
        'inline-flex h-[22px] items-center gap-1 rounded-[2px] px-1.5 font-mono text-[11.5px]',
        t.status === 'acknowledged' && 'text-ink shadow-[inset_0_0_0_1px_rgba(140,192,155,0.55)]',
        t.status === 'failed' && 'text-signal shadow-[inset_0_0_0_1px_rgba(255,59,48,0.7)]',
        (t.status === 'sent' || t.status === 'pending') && 'text-ink-dim shadow-[inset_0_0_0_1px_var(--nc-line-strong)]',
        t.status === 'cancelled' && 'text-ink-muted line-through shadow-[inset_0_0_0_1px_var(--nc-line)]',
      )}
    >
      {t.status === 'acknowledged' && <Check aria-hidden className="size-3 text-help" />}
      {t.status === 'failed' && <X aria-hidden className="size-3" />}
      {(t.status === 'sent' || t.status === 'pending') && <Loader2 aria-hidden className="size-3 animate-spin" />}
      {label}
      <span className="sr-only">{state}</span>
    </span>
  )
}

/**
 * The path for First Aid: the preview the operator approves, then delivery band by band. A band
 * counts as signalling only after it confirms over the radio.
 */
export function GuidancePanel({
  incident,
  command,
  devices,
  corridors,
}: {
  incident: Incident
  command: GuidanceCommand
  devices: Record<string, Device>
  corridors: ResponderCorridor[]
}) {
  const now = useServerNow(1)
  const pending = useUi((s) => s.pending)
  const crowd = simBandsFor(useWorld((s) => s.scenario?.simulatedBands), command.commandId)
  const compliance = useWorld((s) => s.scenario?.compliance ?? 0.75)
  const preview = command.approvalStatus === 'pending_approval'
  const options = [command.preview.corridorId, ...command.preview.alternativeCorridorIds]
  const untargeted = Object.values(devices).filter(
    (d) => (d.hardwareVariant === 'full' || d.hardwareVariant === 'light') && !command.targetDeviceIds.includes(d.deviceId) && !d.location,
  )
  const anyHaptic = command.targets.some((t) => t.haptic)
  const failed = command.targets.filter((t) => t.status === 'failed')
  const acked = command.targets.filter((t) => t.status === 'acknowledged').length
  // with a simulated crowd, the listed bands are the few on the demo table; the crowd's are counted below
  const which = crowd ? ' demo bands' : ''

  return (
    <section aria-labelledby="path-h" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 id="path-h" className="text-[13px] font-medium text-ink">
          {command.commandId === 'demo-path'
            ? preview
              ? 'Path from the entrance, preview'
              : 'Path from the entrance'
            : preview
              ? 'Path for First Aid, preview'
              : 'Path for First Aid'}
        </h3>
        <span className={cn('text-[12px] tabular-nums', preview ? 'text-ink-muted' : 'text-ink-dim')}>
          {command.commandId === 'demo-path'
            ? 'Nothing sent to bands'
            : preview
              ? 'Not sent'
              : command.deliveryStatus === 'delivered'
                ? `${acked} of ${command.targets.length}${which} confirmed`
                : `${acked} of ${command.targets.length}${which} confirmed so far`}
        </span>
      </div>

      {preview && options.length > 1 ? (
        <Select
          value={command.preview.corridorId}
          onValueChange={(id) => void previewGuidance(incident.incidentId, id)}
          disabled={!!pending[pendingKey.preview(incident.incidentId)]}
        >
          <SelectTrigger size="sm" className="h-8 w-full text-[13px]" aria-label="Corridor">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((id) => {
              const c = corridors.find((x) => x.corridorId === id)
              return (
                <SelectItem key={id} value={id}>
                  {c ? `${c.name} · ${c.lengthM} m` : id}
                </SelectItem>
              )
            })}
          </SelectContent>
        </Select>
      ) : (
        <p className="text-[13px] text-ink-dim">
          {command.preview.corridorName} · {command.preview.lengthM} m
        </p>
      )}

      <ul className="flex flex-col">
        {command.preview.groups.map((g) => {
          const targets = command.targets.filter((t) => g.deviceIds.includes(t.deviceId))
          const done = targets.filter((t) => t.status === 'acknowledged').length
          return (
            <li key={g.patternCode} className="grid grid-cols-[28px_1fr_auto] items-center gap-2 border-t border-line py-2.5">
              <LedGlyph pattern={g.patternCode} pending={preview || done < targets.length} size={22} />
              <div className="flex min-w-0 flex-col gap-1.5">
                <span className="text-[13.5px] text-ink">{g.label}</span>
                <span className="flex flex-wrap gap-1">
                  {targets.map((t) => (
                    <TargetChip key={t.deviceId} t={preview ? { ...t, status: 'pending' } : t} device={devices[t.deviceId]} />
                  ))}
                </span>
              </div>
              <span className="self-start font-mono text-[12.5px] tabular-nums text-ink">
                {preview ? targets.length : `${done}/${targets.length}`}
              </span>
            </li>
          )
        })}
        {crowd && (
          <li className="grid grid-cols-[28px_1fr_auto] items-center gap-2 border-t border-line py-2.5">
            <LedGlyph pattern="step_aside" pending={preview} size={22} />
            <div className="flex min-w-0 flex-col gap-1">
              <span className="flex items-center gap-1.5 text-[13.5px] text-ink">
                Crowd bands in reach
                <span aria-hidden className="nc-sim-stripes inline-block h-2 w-3 rounded-[1px]" />
                <span className="font-mono text-[11px] text-ink-muted">sim</span>
              </span>
              <span className="text-[12px] leading-snug text-ink-dim">
                {preview
                  ? `About ${crowd.signalled} in reach now; more as the lane opens. ${Math.round(compliance * 100)}% assumed to follow.`
                  : `${crowd.following} moving aside, ${crowd.signalled - crowd.following} not following (${Math.round(compliance * 100)}% assumed to follow).`}
              </span>
            </div>
            <span className="self-start font-mono text-[12.5px] tabular-nums text-ink">{preview ? `~${crowd.signalled}` : crowd.signalled}</span>
          </li>
        )}
      </ul>

      <div className="flex flex-col gap-1 text-[12px] text-ink-muted">
        {anyHaptic && <span>Full bands on the path also vibrate once. Lite bands show light only.</span>}
        {command.commandId !== 'demo-path' && untargeted.length > 0 && (
          <span>
            {untargeted.map((d) => `band-${d.label}`).join(', ')} {untargeted.length === 1 ? 'has' : 'have'} no position and {untargeted.length === 1 ? 'is' : 'are'} not included.
          </span>
        )}
        {command.commandId === 'demo-path' ? (
          preview ? (
            <span>Opening this lights a yellow path from the entrance. People on it step aside. Nothing is sent to a wristband.</span>
          ) : (
            <span>People on the yellow path are stepping aside. Wristbands are not signalled from here.</span>
          )
        ) : (
          <>
            {!preview && command.approvalStatus === 'approved' && <span>Signals stop when you resolve, or in {elapsed(Math.max(0, command.expiresAt - now))}.</span>}
            {preview && <span>Nothing changes on any band until you send it.</span>}
          </>
        )}
      </div>

      {failed.length > 0 && command.approvalStatus === 'approved' && (
        <div role="status" className="flex items-center justify-between gap-3 rounded-[3px] px-3 py-2 text-[12.5px] text-ink shadow-[inset_0_0_0_1px_rgba(255,59,48,0.55)]">
          <span>
            {failed.map((t) => `band-${devices[t.deviceId]?.label ?? t.deviceId}`).join(', ')} did not confirm. Its light has not changed.
          </span>
          <button
            type="button"
            onClick={() => void resendGuidance(command.commandId)}
            disabled={!!pending[pendingKey.resend(command.commandId)]}
            className="inline-flex h-7 flex-none items-center gap-1.5 rounded-[2px] px-2 text-[12px] font-medium text-ink shadow-[inset_0_0_0_1px_var(--nc-line-strong)] hover:bg-accent disabled:opacity-50"
          >
            <RotateCw className="size-3.5" /> Resend
          </button>
        </div>
      )}
    </section>
  )
}
