export interface IntroHooks {
  onKey: () => void
  onRise: () => void
  onStrike: () => void
  onDone: () => void
}

function split(el: HTMLElement) {
  const text = el.textContent ?? ''
  el.textContent = ''
  return [...text].map((ch) => {
    const s = document.createElement('span')
    s.className = 'ch'
    s.textContent = ch
    el.append(s)
    return s
  })
}

/** Sizes the second line so it runs exactly as wide as the name above it. */
export function fitTitle(title: HTMLElement) {
  const name = title.querySelector<HTMLElement>('.title-name')
  const line = title.querySelector<HTMLElement>('.title-line')
  if (!name || !line) return
  line.style.fontSize = ''
  const nameW = name.getBoundingClientRect().width
  const lineW = line.getBoundingClientRect().width
  if (!nameW || !lineW) return
  const size = parseFloat(getComputedStyle(line).fontSize)
  line.style.fontSize = `${(size * nameW) / lineW}px`
}

export function prepareTitle(title: HTMLElement) {
  const label = [...title.querySelectorAll<HTMLElement>('[data-type]')].map((p) => p.textContent?.trim()).join('. ')
  title.setAttribute('aria-label', label)
  const parts = [...title.querySelectorAll<HTMLElement>('[data-type]')]
  parts.forEach((p) => p.setAttribute('aria-hidden', 'true'))
  return parts.map(split)
}

export async function runIntro(title: HTMLElement, chars: HTMLSpanElement[][], hooks: IntroHooks) {
  let skipping = false
  let wake: (() => void) | null = null
  const skip = () => {
    if (skipping) return
    skipping = true
    wake?.()
  }
  const wait = (ms: number) =>
    new Promise<void>((resolve) => {
      if (skipping) return resolve()
      const id = window.setTimeout(done, ms)
      function done() {
        window.clearTimeout(id)
        wake = null
        resolve()
      }
      wake = done
    })
  const events = ['keydown', 'pointerdown', 'wheel', 'touchstart'] as const
  events.forEach((e) => window.addEventListener(e, skip, { passive: true, once: true }))

  const flat = chars.flat()
  flat.forEach((c) => c.classList.add('is-off'))

  const caret = document.createElement('span')
  caret.className = 'caret is-typing'
  caret.setAttribute('aria-hidden', 'true')
  title.append(caret)
  const place = (c: HTMLElement, after: boolean) => {
    const line = c.parentElement as HTMLElement
    const fs = parseFloat(getComputedStyle(line).fontSize)
    caret.style.fontSize = `${fs}px`
    caret.style.left = `${c.offsetLeft + (after ? c.offsetWidth : 0) + fs * 0.04}px`
    caret.style.top = `${line.offsetTop + fs * 0.08}px`
    caret.style.height = `${fs * 0.72}px`
  }

  // Start with the words filling the screen, centred on it.
  const r = title.getBoundingClientRect()
  const stage = title.closest('[data-stage]') as HTMLElement
  const sr = stage.getBoundingClientRect()
  const margin = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--m')) || 24
  const s = Math.max(1, Math.min((sr.width - margin * 2) / r.width, (sr.height * 0.8) / r.height, 2.4))
  const dy = sr.top + (sr.height - r.height * s) / 2 - r.top
  title.style.transform = `translate3d(0, ${dy.toFixed(1)}px, 0) scale(${s.toFixed(4)})`
  title.classList.add('is-ready')
  place(flat[0], false)

  await wait(380)
  for (let p = 0; p < chars.length; p++) {
    for (const c of chars[p]) {
      if (skipping) break
      c.classList.remove('is-off')
      place(c, true)
      if (c.textContent !== ' ') hooks.onKey()
      const base = p === 0 ? 92 : c.textContent === ' ' ? 70 : 36
      await wait(base + (Math.random() - 0.5) * base * 0.5)
    }
    if (p < chars.length - 1 && !skipping) {
      caret.classList.remove('is-typing')
      await wait(240)
      caret.classList.add('is-typing')
      place(chars[p + 1][0], false)
      await wait(60)
    }
  }
  flat.forEach((c) => c.classList.remove('is-off'))
  caret.classList.remove('is-typing')
  place(flat[flat.length - 1], true)
  await wait(skipping ? 0 : 300)

  events.forEach((e) => window.removeEventListener(e, skip))
  hooks.onRise()
  caret.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, fill: 'forwards' }).finished.then(() => caret.remove())
  title.classList.add('is-rising')
  title.style.transform = ''
  await new Promise((res) => window.setTimeout(res, skipping ? 260 : 460))
  hooks.onStrike()
  await new Promise((res) => window.setTimeout(res, 800))
  title.classList.remove('is-rising')
  hooks.onDone()
}
