import { bandFromCode } from '@/lib/bandCode'

/** Each band's NFC tag holds `/t/<band code>` (`/t/BANDIT-07` on the first stickers). The phone reads
 * the tag and opens the band's sign-up page with the code it carries. */
export function tapTarget(pathname: string): string | null {
  const match = /^\/t\/([A-Za-z0-9-]{3,32})\/?$/.exec(pathname)
  return match ? `/register?band=${encodeURIComponent(match[1]!)}` : null
}

const BAND_KEY = 'bandit-band'

/** `?band=<code>` from a tag link, as the band's number when the code names a radio band. */
export function bandIdFromSearch(search: string): number | null {
  const raw = new URLSearchParams(search).get('band') ?? ''
  const legacy = /^band-(\d{1,3})$/i.exec(raw)
  const id = legacy ? Number(legacy[1]) : bandFromCode(raw)
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
