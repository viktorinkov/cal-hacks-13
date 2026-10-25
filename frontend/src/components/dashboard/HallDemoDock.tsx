import { useEffect, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { demoIsActive, useHardware } from '@/booth/demoRing'
import { useHallDemo } from '@/booth/hallDemo'
import { guideHallAcknowledge, guideHallPath, guideHallResolve, guideHallSos } from '@/booth/hallGuide'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useWorld } from '@/stores/world'

const STEPS: { id: 'sos' | 'acknowledge' | 'path' | 'resolve'; label: string; hint: string }[] = [
  { id: 'sos', label: 'SOS', hint: 'Set off a distress in the ring. It flashes red, and people around it turn red. Press SOS again to clear it. Nothing is sent to a wristband.' },
  { id: 'acknowledge', label: 'Acknowledge', hint: 'Take the incident. The path stays closed until you open it.' },
  { id: 'path', label: 'Path', hint: 'Light a yellow path from the entrance. People along it are told to move.' },
  { id: 'resolve', label: 'Resolve', hint: 'Close the path and clear the rehearsal.' },
]

/**
 * Operator guide for the hall demo, in the same shape as the simulation story.
 * SOS lights the ring. The path waits until the operator opens it.
 */
export function HallDemoDock() {
  const venueId = useWorld((s) => s.venue?.venueId)
  const incidents = useWorld((s) => s.incidents)
  const bands = useHardware((s) => s.bands)
  const scripted = useHallDemo((s) => s.scripted)
  const acknowledged = useHallDemo((s) => s.acknowledged)
  const pathOpen = useHallDemo((s) => s.pathOpen)
  const [open, setOpen] = useState(true)

  const real = demoIsActive(bands, Object.values(incidents))
  const sosOn = scripted || real
  useEffect(() => {
    if (real) setOpen(true)
  }, [real])

  if (venueId !== 'calhacks') return null

  const done = new Set<string>()
  if (sosOn) done.add('sos')
  if (acknowledged || pathOpen) done.add('acknowledge')
  if (pathOpen) done.add('path')
  const next = STEPS.find((step) => !done.has(step.id))?.id

  const run = (id: (typeof STEPS)[number]['id']) => {
    if (id === 'sos') {
      guideHallSos()
      setOpen(true)
      return
    }
    if (!sosOn) return
    if (id === 'acknowledge') guideHallAcknowledge()
    else if (id === 'path') guideHallPath()
    else guideHallResolve()
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          if (scripted) {
            guideHallSos()
            return
          }
          setOpen(true)
          if (!sosOn) guideHallSos()
        }}
        className="nc-panel pointer-events-auto inline-flex h-12 items-center gap-2.5 self-end px-3.5 text-[13px] font-medium text-ink"
      >
        <span aria-hidden className="size-2.5 rounded-full bg-signal motion-safe:animate-pulse" />
        {sosOn ? 'SOS is on' : 'Demo SOS'}
      </button>
    )
  }

  return (
    <div className="nc-panel pointer-events-auto flex h-12 items-center gap-1 self-end pl-1.5 pr-1.5">
      <button
        type="button"
        aria-label="Hide the hall demo"
        onClick={() => setOpen(false)}
        className="grid size-8 place-items-center rounded-[3px] text-ink-dim hover:bg-accent hover:text-ink"
      >
        <ChevronDown className="size-4" />
      </button>
      <span aria-hidden className="mx-1 h-6 w-px bg-line" />
      <ol aria-label="Hall demo" className="flex items-center">
        {STEPS.map((step, index) => {
          const isDone = done.has(step.id)
          const isNext = step.id === next
          return (
            <li key={step.id} className="flex items-center">
              {index > 0 && <span aria-hidden className={cn('h-px w-2', isDone ? 'bg-champagne/60' : 'bg-line')} />}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => run(step.id)}
                    aria-current={isNext ? 'step' : undefined}
                    className={cn(
                      'inline-flex h-8 items-center gap-1 rounded-[3px] px-2 text-[12.5px] transition-colors',
                      isDone && 'text-ink-dim hover:text-ink',
                      isNext && 'bg-champagne font-medium text-primary-foreground hover:bg-champagne-hover',
                      !isDone && !isNext && 'text-ink-muted hover:text-ink',
                    )}
                  >
                    {isDone && <Check aria-hidden className="size-3.5 text-champagne" />}
                    {step.label}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">{step.hint}</TooltipContent>
              </Tooltip>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
