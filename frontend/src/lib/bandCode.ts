// The code people see for a band, like `K3QX-9A7M`: the same function as
// spacetimedb/server/src/band_code.rs and web/src/band-code.ts. Seven Crockford Base32 characters
// scrambled from the band's key, then one Luhn mod 32 check character.

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const MASK = (1n << 35n) - 1n
const SALT = 0x2b1a7ec0dn
const M1 = 0x51f3a9c2bn
const M2 = 0x39e3779b9n

function inverse(m: bigint): bigint {
  let x = m
  for (let i = 0; i < 6; i++) x = (x * (2n - m * x)) & MASK
  return x
}

function unshift(y: bigint, s: bigint): bigint {
  let x = y
  for (let i = 0n; i <= 35n / s; i++) x = y ^ (x >> s)
  return x
}

function check(digits: number[]): number {
  let factor = 2
  let sum = 0
  for (let i = digits.length - 1; i >= 0; i--) {
    const a = factor * digits[i]!
    factor = factor === 2 ? 1 : 2
    sum += Math.floor(a / 32) + (a % 32)
  }
  return (32 - (sum % 32)) % 32
}

/** The band's code, for example `K3QX-9A7M`. */
export function bandCode(id: number): string {
  let x = (BigInt(id) ^ SALT) & MASK
  x = (x * M1) & MASK
  x ^= x >> 17n
  x = (x * M2) & MASK
  x ^= x >> 13n
  const digits = [6, 5, 4, 3, 2, 1, 0].map((i) => Number((x >> BigInt(5 * i)) & 31n))
  digits.push(check(digits))
  const s = digits.map((d) => ALPHABET[d]).join('')
  return `${s.slice(0, 4)}-${s.slice(4)}`
}

/** The band key a code stands for, in any case, with or without the dash; also the first stickers' `BANDIT-0n`. 0 when it is not a band. */
export function bandFromCode(text: string): number {
  const t = text.trim().toUpperCase()
  if (t.startsWith('BANDIT-')) return Number(t.slice(7)) || 0
  const digits = [...t.replace(/[- ]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')].map((c) => ALPHABET.indexOf(c))
  if (digits.length !== 8 || digits.includes(-1) || check(digits.slice(0, 7)) !== digits[7]) return 0
  let x = digits.slice(0, 7).reduce((x, d) => (x << 5n) | BigInt(d), 0n)
  x = unshift(x, 13n)
  x = (x * inverse(M2)) & MASK
  x = unshift(x, 17n)
  x = (x * inverse(M1)) & MASK
  const id = (x ^ SALT) & MASK
  return id > 0n && id <= 0xffffffffn ? Number(id) : 0
}
