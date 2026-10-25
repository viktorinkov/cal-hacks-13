import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { cn } from '@/lib/utils'

/** A detail sheet from the right edge; the whole screen on a phone. No blur behind it. */
export function Sheet({ open, onClose, title, description, footer, children, className }: {
  open: boolean
  onClose: () => void
  title: ReactNode
  description: ReactNode
  footer?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 motion-reduce:animate-none" />
        <DialogPrimitive.Content
          className={cn(
            'fixed inset-y-0 right-0 z-50 flex h-dvh w-full flex-col border-l border-line bg-panel text-ink outline-none duration-200 sm:w-[30rem]',
            'data-open:animate-in data-open:fade-in-0 data-open:slide-in-from-right-6 data-closed:animate-out data-closed:fade-out-0 motion-reduce:animate-none',
            className,
          )}
        >
          <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4 sm:px-6">
            <div className="min-w-0">
              <DialogPrimitive.Title className="text-[16px] font-medium leading-6 text-ink">{title}</DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-0.5 text-[13px] text-ink-dim">{description}</DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close aria-label="Close" className="-mr-2 -mt-1.5 grid size-11 flex-none place-items-center rounded-[4px] text-ink-dim hover:bg-ink/[0.06] hover:text-ink">
              <X size={16} aria-hidden="true" />
            </DialogPrimitive.Close>
          </header>
          <div className="nc-scroll min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
          {footer && <footer className="border-t border-line px-5 py-4 sm:px-6">{footer}</footer>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

/** A timeline step: a dot on a 1px rail, the title, then its detail or quote. */
export function Timeline({ steps }: { steps: { key: string; title: string; detail?: string; quote?: string; at: string; state: 'done' | 'waiting' | 'stopped'; warn?: boolean }[] }) {
  return (
    <ol className="relative">
      {steps.map((step, index) => (
        <li key={step.key} className="relative grid grid-cols-[16px_minmax(0,1fr)_auto] gap-x-3 pb-4 last:pb-0">
          {index < steps.length - 1 && <span aria-hidden className="absolute left-[7.5px] top-[18px] bottom-0 w-px bg-line" />}
          <span aria-hidden className={cn(
            'mt-[6px] size-[9px] justify-self-center rounded-full',
            step.state === 'waiting' ? 'border-[1.5px] border-ink-muted' : step.warn ? 'bg-caution' : step.state === 'stopped' ? 'bg-ink-muted' : 'bg-ink-dim',
          )} />
          <div className="min-w-0">
            <p className={cn('text-[14px]', step.state === 'waiting' ? 'text-ink-dim' : 'text-ink')}>{step.title}</p>
            {step.detail && <p className="mt-0.5 text-[13px] text-ink-dim">{step.detail}</p>}
            {step.quote && <blockquote className="mt-1.5 border-l border-line-strong pl-3 text-[13px] text-ink-dim">“{step.quote}”</blockquote>}
          </div>
          <span className="pt-[1px] text-[12px] tabular-nums text-ink-muted">{step.at}</span>
        </li>
      ))}
    </ol>
  )
}
