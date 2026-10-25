// The small DOM and formatting helpers the portal's 3D renderer needs, kept word-for-word from the portal.

type Child = Node | string | number | false | null | undefined | Child[]

/** h('p', { class: 'x', onclick: fn }, 'text', child) */
export function h(tag: string, attrs: Record<string, unknown> = {}, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v as EventListener)
    else if (k === 'value') (el as HTMLInputElement).value = String(v)
    else if (k === 'checked') (el as HTMLInputElement).checked = Boolean(v)
    else el.setAttribute(k, v === true ? '' : String(v))
  }
  const add = (c: Child) => {
    if (Array.isArray(c)) c.forEach(add)
    else if (c instanceof Node) el.appendChild(c)
    else if (c !== false && c !== null && c !== undefined) el.appendChild(document.createTextNode(String(c)))
  }
  children.forEach(add)
  return el
}

export function money(cents: bigint | number): string {
  const n = Number(cents) / 100
  return `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** The busy level of a zone from the bands in it, by the same thresholds the bands use. */
export function risk(avgNeigh: number, yellow: number, red: number): 'calm' | 'busy' | 'very busy' {
  return avgNeigh >= red ? 'very busy' : avgNeigh >= yellow ? 'busy' : 'calm'
}

// Exit colour indexes 1 to 6, as the bands and stations glow them.
export const EXIT_COLOURS = ['none', 'blue', 'magenta', 'cyan', 'white', 'orange', 'violet']
