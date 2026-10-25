import type { Band } from '@/stdb/module_bindings/types'

const FIRST_CROWD_BAND = 100

/** A band is on the floor while it is online; bands 1 to 99 also need a report in the last 5 s. */
export function present(b: Band, now = Date.now()): boolean {
  return b.online && (b.id >= FIRST_CROWD_BAND || now - b.lastSeen.toDate().getTime() < 5000)
}
