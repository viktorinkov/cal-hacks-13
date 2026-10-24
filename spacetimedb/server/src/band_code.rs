//! The code people see for a band, on the band, in its tap link and at the medic desk: `K3QX-9A7M`.
//! Seven Crockford Base32 characters (digits and capitals without I, L, O and U) scrambled from the band's
//! key, so neighbouring bands get unrelated codes, then one Luhn mod 32 check character, so a typo is caught
//! before it opens someone else's band. The scramble is a bijection on 35 bits, so codes never collide and
//! a code turns back into its key without a lookup table. web/src/band-code.ts is the same function.

const ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const BITS: u32 = 35;
const MASK: u64 = (1 << BITS) - 1;
const SALT: u64 = 0x2_B1A7_EC0D;
const M1: u64 = 0x5_1F3A_9C2B;
const M2: u64 = 0x3_9E37_79B9;

/// The inverse of an odd number modulo 2^35, by Newton's iteration.
const fn inverse(m: u64) -> u64 {
    let mut x = m;
    let mut i = 0;
    while i < 6 {
        x = x.wrapping_mul(2u64.wrapping_sub(m.wrapping_mul(x))) & MASK;
        i += 1;
    }
    x
}

fn unshift(y: u64, s: u32) -> u64 {
    let mut x = y;
    for _ in 0..BITS / s + 1 {
        x = y ^ (x >> s);
    }
    x
}

fn scramble(id: u64) -> u64 {
    let mut x = (id ^ SALT) & MASK;
    x = x.wrapping_mul(M1) & MASK;
    x ^= x >> 17;
    x = x.wrapping_mul(M2) & MASK;
    x ^ (x >> 13)
}

fn unscramble(y: u64) -> u64 {
    let mut x = unshift(y, 13);
    x = x.wrapping_mul(inverse(M2)) & MASK;
    x = unshift(x, 17);
    x = x.wrapping_mul(inverse(M1)) & MASK;
    (x ^ SALT) & MASK
}

fn check(digits: &[u8]) -> u8 {
    let mut factor = 2;
    let mut sum = 0u32;
    for &d in digits.iter().rev() {
        let a = factor * d as u32;
        factor = if factor == 2 { 1 } else { 2 };
        sum += a / 32 + a % 32;
    }
    ((32 - sum % 32) % 32) as u8
}

/// The band's code, for example `K3QX-9A7M`.
pub fn band_code(id: u32) -> String {
    let x = scramble(id as u64);
    let mut digits: Vec<u8> = (0..7).rev().map(|i| ((x >> (5 * i)) & 31) as u8).collect();
    digits.push(check(&digits));
    let s: String = digits.iter().map(|&d| ALPHABET[d as usize] as char).collect();
    format!("{}-{}", &s[..4], &s[4..])
}

/// The band key a typed or scanned code stands for: any case, with or without the dash, O read as 0 and
/// I or L as 1. None when the check character does not match.
pub fn band_from_code(text: &str) -> Option<u32> {
    let mut digits = Vec::with_capacity(8);
    for c in text.trim().chars().filter(|c| *c != '-' && *c != ' ') {
        let c = match c.to_ascii_uppercase() {
            'O' => '0',
            'I' | 'L' => '1',
            c => c,
        };
        digits.push(ALPHABET.iter().position(|&a| a as char == c)? as u8);
    }
    if digits.len() != 8 || check(&digits[..7]) != digits[7] {
        return None;
    }
    let x = digits[..7].iter().fold(0u64, |x, &d| (x << 5) | d as u64);
    u32::try_from(unscramble(x)).ok().filter(|id| *id != 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_turn_back_into_their_band() {
        for id in [1, 2, 9, 90, 94, 99, 100, 101, 1_099, 65_535, 1_000_000, u32::MAX] {
            let code = band_code(id);
            assert_eq!(code.len(), 9, "{code}");
            assert_eq!(band_from_code(&code), Some(id), "{code}");
            assert_eq!(band_from_code(&code.to_lowercase().replace('-', "")), Some(id));
        }
    }

    /// Pinned so web/src/band-code.ts can be checked against the same values.
    #[test]
    fn codes_stay_the_same() {
        assert_eq!(band_code(1), "D3CW-EPX2");
        assert_eq!(band_code(94), "AJMN-676X");
        assert_eq!(band_code(100), "YKR3-ZV2Y");
    }

    #[test]
    fn neighbouring_bands_get_unrelated_codes() {
        let (a, b) = (band_code(94), band_code(95));
        assert!(a.chars().zip(b.chars()).filter(|(x, y)| x == y).count() <= 3, "{a} {b}");
    }

    #[test]
    fn a_typo_is_caught() {
        let code = band_code(94);
        for i in [0, 1, 2, 3, 5, 6, 7, 8] {
            let mut chars: Vec<char> = code.chars().collect();
            chars[i] = if chars[i] == 'Z' { 'Y' } else { 'Z' };
            let typo: String = chars.into_iter().collect();
            assert_eq!(band_from_code(&typo), None, "{typo}");
        }
        assert_eq!(band_from_code("BANDIT-94"), None);
        assert_eq!(band_from_code(""), None);
    }
}
