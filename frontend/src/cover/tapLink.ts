/** Each band's NFC tag holds `/t/BANDIT-07`. The phone reads the tag and opens the band's sign-up page. */
export function tapTarget(pathname: string): string | null {
  const match = /^\/t\/BANDIT-(\d{1,3})\/?$/i.exec(pathname)
  return match ? `/register?band=band-${String(Number(match[1])).padStart(2, '0')}` : null
}

const BAND_KEY = 'bandit-band'

/** `?band=band-07` from a tag link, as the band's number. */
export function bandIdFromSearch(search: string): number | null {
  const raw = new URLSearchParams(search).get('band') ?? ''
  const match = /^band-(\d{1,3})$/i.exec(raw)
  if (!match) return null
  const id = Number(match[1])
  return id >= 1 && id <= 255 ? id : null
}

/** Keep the band a phone opened, so the wallet still knows after the query string is gone. */
export function rememberBand(id: number) {
  try { sessionStorage.setItem(BAND_KEY, String(id)) } catch { /* private browsing */ }
}

export function rememberedBand(): number | null {
  try {
    const id = Number(sessionStorage.getItem(BAND_KEY))
    return Number.isInteger(id) && id >= 1 && id <= 255 ? id : null
  } catch {
    return null
  }
}
