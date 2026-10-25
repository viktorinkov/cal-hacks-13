import { useEffect, useState } from 'react'
import { serverNow } from '@/stores/clock'

/** Backend time, re-rendered at `hz`. Use for clocks and "open for" timers, not for data. */
export function useServerNow(hz = 1): number {
  const [now, setNow] = useState(() => serverNow())
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), 1000 / hz)
    return () => clearInterval(id)
  }, [hz])
  return now
}
