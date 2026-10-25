import { X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Switch } from '@/components/ui/switch'
import { HEAT } from '@/map/palette'
import { LAYERS, useUi } from '@/stores/ui'

function hex(n: number) {
  return `#${n.toString(16).padStart(6, '0')}`
}

/** Layer checklist with the legend for what each layer draws. */
export function LayerPanel({ onClose }: { onClose: () => void }) {
  const layers = useUi((s) => s.layers)
  const toggle = useUi((s) => s.toggleLayer)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button[role="switch"]')?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div ref={ref} role="dialog" aria-label="Map layers" className="nc-panel w-72 p-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[13px] font-medium text-ink">Layers</h2>
        <button type="button" aria-label="Close layers" onClick={onClose} className="grid size-7 place-items-center rounded-[3px] text-ink-dim hover:bg-accent hover:text-ink">
          <X className="size-4" />
        </button>
      </div>
      <ul className="flex flex-col">
        {LAYERS.map((l) => {
          const id = `layer-${l.key}`
          return (
            <li key={l.key} className="flex items-center justify-between gap-3 border-t border-line py-2 first:border-t-0">
              <label htmlFor={id} className="flex min-w-0 flex-col">
                <span className="text-[13px] text-ink">{l.label}</span>
                <span className="truncate text-[11.5px] text-ink-muted">{l.hint}</span>
              </label>
              <Switch id={id} checked={layers[l.key]} onCheckedChange={(on) => toggle(l.key, on)} />
            </li>
          )
        })}
      </ul>
      <div className="mt-2 border-t border-line pt-3">
        <p className="text-[11.5px] text-ink-muted">Density glow · simulated</p>
        <p className="mt-1 text-[11.5px] leading-snug text-ink-dim">Reddish amber where people gather, pale peach where they are packed. One person alone never glows.</p>
        <div
          className="mt-2 h-2.5 rounded-[2px]"
          aria-hidden
          style={{ background: `linear-gradient(90deg, transparent, ${hex(HEAT.bloom)} 35%, ${hex(HEAT.warm)} 70%, ${hex(HEAT.core)})` }}
        />
        <div className="mt-1 flex justify-between text-[10.5px] text-ink-muted" aria-hidden>
          <span>a few people</span>
          <span>packed</span>
        </div>
      </div>
    </div>
  )
}
