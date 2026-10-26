import { useEffect, useState } from 'react'

/** Wall-clock milliseconds, re-rendered at `hz`. For "data is 12 s old" style labels. */
export function useWallClock(hz = 1): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000 / hz)
    return () => clearInterval(id)
  }, [hz])
  return now
}
