/** Dollars stored as integer cents so the screen never rounds a total on its own. */

export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(Math.round(cents))
  const dollars = Math.floor(abs / 100)
  const rem = abs % 100
  const remText = rem < 10 ? `0${rem}` : String(rem)
  const grouped = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${sign}$${grouped}.${remText}`
}

/** Parse a dollar field into cents. Rejects blanks, extra decimals and zero. */
export function parseDollars(value: string): number | null {
  const trimmed = value.trim()
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null
  const [dollars, fraction = ''] = trimmed.split('.')
  const cents = Number(dollars) * 100 + Number(fraction.padEnd(2, '0'))
  if (!Number.isInteger(cents) || cents < 1 || cents > 100_000_00) return null
  return cents
}
