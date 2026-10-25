type Edge = 'left' | 'right' | 'top' | 'bottom'
type Bounds = Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>

/** Panels reserve space inside the map, independently of the surrounding page header. */
export function panelInset(edge: Edge, panel: Bounds, viewport: Bounds): number {
  const distance = edge === 'left' ? panel.right - viewport.left
    : edge === 'right' ? viewport.right - panel.left
      : edge === 'top' ? panel.bottom - viewport.top
        : viewport.bottom - panel.top
  return Math.max(0, Math.round(distance + (edge === 'left' || edge === 'right' ? 16 : 8)))
}
