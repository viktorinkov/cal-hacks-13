/** Each band's NFC tag holds `/t/BANDIT-07`. That link opens the band's sign-up page. */
export function tapTarget(pathname: string): string | null {
  const match = /^\/t\/BANDIT-(\d{1,3})\/?$/i.exec(pathname)
  return match ? `/register?band=band-${String(Number(match[1])).padStart(2, '0')}` : null
}
