/**
 * Backend time, estimated between events. In simulation the clock pauses and speeds up with the
 * demo; live, it tracks the server's timestamps. It moves forward smoothly and only steps back if
 * the estimate has run more than a second ahead of what the backend reports.
 */
let anchorServer = 0
let anchorPerf = 0
let rate = 1

export function observeServerTime(at: number): void {
  if (anchorServer === 0) {
    resetServerTime(at)
    return
  }
  const est = serverNow()
  const next = at >= est ? at : est - at > 1000 ? at + 1000 : est
  anchorServer = next
  anchorPerf = performance.now()
}

export function resetServerTime(at: number): void {
  anchorServer = at
  anchorPerf = performance.now()
}

export function setClockRate(r: number): void {
  if (r === rate) return
  anchorServer = serverNow()
  anchorPerf = performance.now()
  rate = r
}

export function serverNow(): number {
  if (anchorServer === 0) return Date.now()
  return anchorServer + (performance.now() - anchorPerf) * rate
}
