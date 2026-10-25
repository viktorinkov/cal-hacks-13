import { useEffect, useState } from 'react'
import { Check, ChevronDown, ChevronUp, Pause, Play, RotateCcw, Settings2 } from 'lucide-react'
import type { CameraOutcome, ScenarioStep } from '@/contracts/domain'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { mapController } from '@/map/controller'
import {
  acknowledgeIncident,
  approveGuidance,
  previewGuidance,
  resetSimulation,
  resolveIncident,
} from '@/services/operatorCommands'
import { useRuntime } from '@/services/runtime'
import { useConnection } from '@/stores/connection'
import { useUi } from '@/stores/ui'
import { useWorld } from '@/stores/world'

const STEPS: { step: ScenarioStep; label: string; hint: string }[] = [
  { step: 'normal', label: 'Normal', hint: 'Reset to a settled crowd' },
  { step: 'congestion', label: 'Surge', hint: 'Set change: people stream to the front through West Passage' },
  { step: 'sos', label: 'SOS', hint: 'band-03 holds its SOS button (simulated press)' },
  { step: 'camera', label: 'Camera', hint: 'CAM-01 looks for the flash; set the outcome in options' },
  { step: 'acknowledge', label: 'Acknowledge', hint: 'The operator takes the incident' },
  { step: 'guidance', label: 'Path', hint: 'Approve the preapproved corridor; bands confirm one by one' },
  { step: 'compare', label: 'Resolve', hint: 'Close it and compare with the same run without bands' },
]

const OUTCOMES: { value: CameraOutcome; label: string }[] = [
  { value: 'detected', label: 'Seen' },
  { value: 'ambiguous', label: 'Unclear' },
  { value: 'not_visible', label: 'Not in view' },
]

/**
 * Presentation controls, simulation only. Every step calls the same operator commands or demo
 * service the live system uses; nothing here reaches into the stores directly.
 */
export function DemoDock() {
  const scenario = useWorld((s) => s.scenario)
  const incidents = useWorld((s) => s.incidents)
  const commands = useWorld((s) => s.commands)
  const open = useUi((s) => s.demoOpen)
  const setOpen = useUi((s) => s.setDemoOpen)
  const [options, setOptions] = useState(false)
  const linkDown = useConnection((s) => s.connection.phase === 'reconnecting')
  const demo = useRuntime((r) => r.adapter?.demo ?? null)

  const openIncident = Object.values(incidents)
    .filter((i) => i.status !== 'resolved')
    .sort((a, b) => a.reportedAt - b.reportedAt)[0]

  const run = async (step: ScenarioStep) => {
    if (!demo) return
    switch (step) {
      case 'normal':
        await resetSimulation()
        mapController.fit()
        break
      case 'congestion':
        await demo.triggerCongestion()
        break
      case 'sos':
        await demo.pressSos('band-03')
        break
      case 'camera':
        break
      case 'acknowledge':
        if (openIncident?.status === 'reported') await acknowledgeIncident(openIncident.incidentId)
        break
      case 'guidance': {
        if (!openIncident) break
        const draft = Object.values(commands).find((c) => c.incidentId === openIncident.incidentId && c.approvalStatus === 'pending_approval')
        if (draft) await approveGuidance(draft.commandId)
        else if (openIncident.status === 'acknowledged') await previewGuidance(openIncident.incidentId)
        break
      }
      case 'compare':
        if (openIncident) await resolveIncident(openIncident.incidentId, 'assisted_on_scene')
        break
    }
  }

  // presenter shortcuts: Shift + 1..7 for the steps, Shift + P pause, Shift + F fall, Shift + L link
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      // e.code is layout-independent; e.key covers synthetic events that carry no code
      const digit = /^Digit([1-7])$/.exec(e.code)?.[1] ?? String('!@#$%^&'.indexOf(e.key) + 1)
      const letter = e.code.startsWith('Key') ? e.code.slice(3) : e.key.toUpperCase()
      if (digit !== '0') {
        e.preventDefault()
        void run(STEPS[Number(digit) - 1].step)
      } else if (letter === 'P' && scenario) {
        e.preventDefault()
        void demo?.setPlaying(!scenario.playing)
      } else if (letter === 'F') {
        e.preventDefault()
        void demo?.suspectFall('band-01')
      } else if (letter === 'L' && scenario) {
        e.preventDefault()
        void demo?.setLinkDown(useConnection.getState().connection.phase !== 'reconnecting')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!demo || !scenario) return null
  const caps = demo.capabilities
  const done = new Set(scenario.completed)
  const nextIndex = STEPS.findIndex((s) => !done.has(s.step))

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="nc-panel pointer-events-auto inline-flex h-9 items-center gap-2 px-3 text-[12.5px] text-ink-dim hover:text-ink">
        <span aria-hidden className="nc-sim-bar h-3 w-3 rounded-[2px]" />
        Demo controls <ChevronUp className="size-3.5" />
      </button>
    )
  }

  return (
    <div className="pointer-events-auto relative">
      {options && (
        <div role="dialog" aria-label="Demo options" className="nc-panel absolute bottom-full left-0 mb-2 w-[340px] p-4">
          <h3 className="text-[13px] font-medium text-ink">Demo options</h3>
          {caps.has('setCameraOutcome') && (
            <div className="mt-3">
              <span id="cam-outcome" className="text-[12px] text-ink-muted">
                What the camera finds
              </span>
              <div role="radiogroup" aria-labelledby="cam-outcome" className="mt-1.5 grid grid-cols-3 gap-1">
                {OUTCOMES.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={scenario.cameraOutcome === o.value}
                    onClick={() => void demo.setCameraOutcome(o.value)}
                    className={cn(
                      'h-8 rounded-[3px] text-[12.5px] shadow-[inset_0_0_0_1px_var(--nc-line)] hover:bg-accent',
                      scenario.cameraOutcome === o.value ? 'bg-[rgba(236,235,230,0.09)] text-ink shadow-[inset_0_0_0_1px_var(--nc-line-strong)]' : 'text-ink-dim',
                    )}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <ul className="mt-3 flex flex-col">
            {caps.has('setSpeed') && (
              <li className="flex items-center justify-between gap-3 border-t border-line py-2.5">
                <span className="text-[13px] text-ink">Speed</span>
                <span role="group" aria-label="Speed" className="flex gap-1">
                  {[0.5, 1, 2].map((v) => (
                    <button
                      key={v}
                      type="button"
                      aria-pressed={scenario.speed === v}
                      onClick={() => void demo.setSpeed(v)}
                      className={cn('h-8 w-11 rounded-[3px] font-mono text-[12px] shadow-[inset_0_0_0_1px_var(--nc-line)]', scenario.speed === v ? 'bg-[rgba(236,235,230,0.09)] text-ink' : 'text-ink-muted hover:text-ink')}
                    >
                      {v}×
                    </button>
                  ))}
                </span>
              </li>
            )}
            {caps.has('setFlakyRadio') && (
              <li className="flex items-center justify-between gap-3 border-t border-line py-2.5">
                <label htmlFor="opt-flaky" className="flex flex-col">
                  <span className="text-[13px] text-ink">Flaky radio</span>
                  <span className="text-[11.5px] text-ink-muted">One lite band will not confirm</span>
                </label>
                <Switch id="opt-flaky" checked={scenario.flakyRadio} onCheckedChange={(on) => void demo.setFlakyRadio(on)} />
              </li>
            )}
            {caps.has('setLinkDown') && (
              <li className="flex items-center justify-between gap-3 border-t border-line py-2.5">
                <label htmlFor="opt-link" className="flex flex-col">
                  <span className="text-[13px] text-ink">Drop the backend link</span>
                  <span className="text-[11.5px] text-ink-muted">Shows the stale and reconnect states</span>
                </label>
                <Switch id="opt-link" checked={linkDown} onCheckedChange={(on) => void demo.setLinkDown(on)} />
              </li>
            )}
            {caps.has('setAutoplay') && (
              <li className="flex items-center justify-between gap-3 border-t border-line py-2.5">
                <label htmlFor="opt-auto" className="flex flex-col">
                  <span className="text-[13px] text-ink">Autoplay the story</span>
                  <span className="text-[11.5px] text-ink-muted">Acts as the operator, on a loop. For the booth.</span>
                </label>
                <Switch id="opt-auto" checked={scenario.autoplay} onCheckedChange={(on) => void demo.setAutoplay(on)} />
              </li>
            )}
            {caps.has('suspectFall') && (
              <li className="flex items-center justify-between gap-3 border-t border-line py-2.5">
                <span className="flex flex-col">
                  <span className="text-[13px] text-ink">Possible fall</span>
                  <span className="text-[11.5px] text-ink-muted">band-01 wrist impact, CAM-02 checks</span>
                </span>
                <button
                  type="button"
                  onClick={() => void demo.suspectFall('band-01')}
                  className="h-8 rounded-[3px] px-3 text-[12.5px] text-ink shadow-[inset_0_0_0_1px_var(--nc-line-strong)] hover:bg-accent"
                >
                  Trigger
                </button>
              </li>
            )}
          </ul>
          <p className="mt-2 border-t border-line pt-2.5 text-[11.5px] leading-relaxed text-ink-muted">
            Shortcuts: <span className="font-mono text-ink-dim">⇧1</span>–<span className="font-mono text-ink-dim">⇧7</span> steps,{' '}
            <span className="font-mono text-ink-dim">⇧P</span> pause, <span className="font-mono text-ink-dim">⇧F</span> fall,{' '}
            <span className="font-mono text-ink-dim">⇧L</span> link.
          </p>
        </div>
      )}

      <div className="nc-panel flex h-12 items-center gap-1 pl-1.5 pr-1.5">
        <span className="inline-flex h-full items-center pl-1.5 pr-1" title="Demo controls, simulation only">
          <span aria-hidden className="nc-sim-bar h-3.5 w-3.5 rounded-[2px]" />
          <span className="sr-only">Demo controls</span>
        </span>
        {caps.has('setPlaying') && (
          <IconButton label={scenario.playing ? 'Pause the simulation' : 'Play the simulation'} onClick={() => void demo.setPlaying(!scenario.playing)}>
            {scenario.playing ? <Pause /> : <Play />}
          </IconButton>
        )}
        <span aria-hidden className="mx-1 h-6 w-px bg-line" />
        <ol aria-label="Story" className="flex items-center">
          {STEPS.map((s, k) => {
            const isDone = done.has(s.step)
            const isNext = k === nextIndex
            const auto = s.step === 'camera'
            return (
              <li key={s.step} className="flex items-center">
                {k > 0 && <span aria-hidden className={cn('h-px w-2', isDone ? 'bg-champagne/60' : 'bg-line')} />}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      disabled={auto}
                      onClick={() => void run(s.step)}
                      aria-current={isNext ? 'step' : undefined}
                      className={cn(
                        'inline-flex h-8 items-center gap-1 rounded-[3px] px-2 text-[12.5px] transition-colors disabled:cursor-default',
                        isDone && 'text-ink-dim hover:text-ink',
                        isNext && 'bg-champagne font-medium text-primary-foreground hover:bg-champagne-hover',
                        !isDone && !isNext && 'text-ink-muted hover:text-ink',
                      )}
                    >
                      {isDone && <Check aria-hidden className="size-3.5 text-champagne" />}
                      {s.label}
                      {auto && scenario.step === 'sos' && <span className="text-[11px] text-ink-muted">auto</span>}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    {s.hint}
                    <span className="ml-2 font-mono text-ink-muted">⇧{k + 1}</span>
                  </TooltipContent>
                </Tooltip>
              </li>
            )
          })}
        </ol>
        <span aria-hidden className="mx-1 h-6 w-px bg-line" />
        <IconButton label="Reset the simulation" onClick={() => void run('normal')}>
          <RotateCcw />
        </IconButton>
        <IconButton label="Demo options" onClick={() => setOptions(!options)} pressed={options}>
          <Settings2 />
        </IconButton>
        <IconButton label="Hide demo controls" onClick={() => setOpen(false)}>
          <ChevronDown />
        </IconButton>
      </div>
    </div>
  )
}

function IconButton({ label, onClick, pressed, children }: { label: string; onClick: () => void; pressed?: boolean; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={pressed}
          onClick={onClick}
          className={cn('grid size-8 place-items-center rounded-[3px] text-ink-dim hover:bg-accent hover:text-ink [&_svg]:size-4', pressed && 'bg-[rgba(236,235,230,0.09)] text-ink')}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  )
}
