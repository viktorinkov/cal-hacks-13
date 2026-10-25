import { Box, Circle, Crosshair, Layers, Map as MapIcon, Maximize, Minus, Plus, RotateCcw, RotateCw } from 'lucide-react'
import { setBoothEditing, useBooth } from '@/booth/circle'
import { setDemoRingEditing, useDemoRing } from '@/booth/demoRing'
import type { ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { mapController } from '@/map/controller'
import { useUi } from '@/stores/ui'
import { useWorld } from '@/stores/world'
import { LayerPanel } from './LayerPanel'

function ToolButton({
  label,
  shortcut,
  onClick,
  pressed,
  disabled,
  children,
}: {
  label: string
  shortcut?: string
  onClick: () => void
  pressed?: boolean
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={pressed}
          disabled={disabled}
          onClick={onClick}
          className={cn(
            'grid size-10 place-items-center rounded-[3px] text-ink-dim transition-colors hover:bg-accent hover:text-ink disabled:opacity-35 [&_svg]:size-[18px] [&_svg]:stroke-[1.4]',
            pressed && 'bg-[rgba(236,235,230,0.09)] text-ink',
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">
        {label}
        {shortcut && <span className="ml-2 font-mono text-ink-muted">{shortcut}</span>}
      </TooltipContent>
    </Tooltip>
  )
}

/** Camera and layer controls, docked on the map's left edge beside the panels. */
export function MapToolbar() {
  const view = useUi((s) => s.view)
  const setView = useUi((s) => s.setView)
  const layersOpen = useUi((s) => s.layersOpen)
  const setLayersOpen = useUi((s) => s.setLayersOpen)
  const selection = useUi((s) => s.selection)
  const incidents = useWorld((s) => s.incidents)
  const focusId =
    selection.kind === 'incident' ? selection.id : Object.values(incidents).find((i) => i.status !== 'resolved' && i.location)?.incidentId
  const venueId = useWorld((s) => s.venue?.venueId)
  const editingBooth = useBooth((s) => s.editing)
  const editingRing = useDemoRing((s) => s.editing)

  return (
    <div className="pointer-events-auto relative flex items-start gap-2">
      <nav aria-label="Map tools" className="nc-panel flex flex-col gap-0.5 p-1">
        <ToolButton label="Zoom in" shortcut="+" onClick={() => mapController.zoom(1.3)}>
          <Plus />
        </ToolButton>
        <ToolButton label="Zoom out" shortcut="−" onClick={() => mapController.zoom(1 / 1.3)}>
          <Minus />
        </ToolButton>
        <ToolButton label="Fit the venue" shortcut="0" onClick={() => mapController.fit()}>
          <Maximize />
        </ToolButton>
        <ToolButton label="Go to the open incident" onClick={() => focusId && mapController.focusIncident(focusId)} disabled={!focusId}>
          <Crosshair />
        </ToolButton>
        <span aria-hidden className="mx-2 my-1 h-px bg-line" />
        <ToolButton label={view === '3d' ? 'Switch to flat plan' : 'Switch to 3D'} onClick={() => setView(view === '3d' ? 'plan' : '3d')} pressed={view === '3d'}>
          {view === '3d' ? <Box /> : <MapIcon />}
        </ToolButton>
        <ToolButton label="Rotate left" shortcut="Q" onClick={() => mapController.rotate(-20)} disabled={view === 'plan'}>
          <RotateCcw />
        </ToolButton>
        <ToolButton label="Rotate right" shortcut="E" onClick={() => mapController.rotate(20)} disabled={view === 'plan'}>
          <RotateCw />
        </ToolButton>
        {venueId === 'main-stage' && (
          <ToolButton label="Move the live booth" onClick={() => setBoothEditing(!editingBooth)} pressed={editingBooth}>
            <Circle />
          </ToolButton>
        )}
        {venueId === 'calhacks' && (
          <ToolButton label="Move the demo ring" onClick={() => setDemoRingEditing(!editingRing)} pressed={editingRing}>
            <Circle />
          </ToolButton>
        )}
        <span aria-hidden className="mx-2 my-1 h-px bg-line" />
        <ToolButton label="Layers" onClick={() => setLayersOpen(!layersOpen)} pressed={layersOpen}>
          <Layers />
        </ToolButton>
      </nav>
      {layersOpen && <LayerPanel onClose={() => setLayersOpen(false)} />}
    </div>
  )
}
