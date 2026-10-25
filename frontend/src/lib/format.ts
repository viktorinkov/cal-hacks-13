const timeFormatters = new Map<string, Intl.DateTimeFormat>()

function timeFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = timeFormatters.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    timeFormatters.set(timeZone, f)
  }
  return f
}

/** 21:14:09 in the venue's time zone. */
export function clock(t: number | null | undefined, timeZone = 'America/Los_Angeles'): string {
  if (t === null || t === undefined || !Number.isFinite(t)) return '--:--:--'
  return timeFormatter(timeZone).format(new Date(t))
}

/** 21:14 */
export function clockShort(t: number | null | undefined, timeZone = 'America/Los_Angeles'): string {
  return clock(t, timeZone).slice(0, 5)
}

/** 00:04, 01:12, 1:02:09 */
export function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(sec).padStart(2, '0')
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** "1 h 16 m", "42 m", "30 s" */
export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} m`
  return `${Math.floor(m / 60)} h ${m % 60} m`
}

/** "just now", "12 s ago", "4 m ago" */
export function ago(ms: number): string {
  if (ms < 1500) return 'just now'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} m ago`
  return `${Math.floor(m / 60)} h ago`
}

export function count(n: number | undefined | null): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return '—'
  return Math.round(n).toLocaleString('en-US')
}

export function density(d: number | undefined | null): string {
  if (d === undefined || d === null || !Number.isFinite(d)) return '—'
  return d.toFixed(1)
}

export function bandName(label: string): string {
  return `band-${label}`
}
