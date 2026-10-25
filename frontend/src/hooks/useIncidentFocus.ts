import { useEffect, useMemo, useRef } from 'react'
import { mapController } from '@/map/controller'
import { useUi } from '@/stores/ui'
import { useWorld } from '@/stores/world'

/**
 * When a new incident arrives, open it and fly the map to it; when the last one is resolved,
 * return to the whole venue. Returns a sentence for the screen-reader announcement.
 */
export function useIncidentFocus(): string {
  const incidents = useWorld((s) => s.incidents)
  const commands = useWorld((s) => s.commands)
  const venue = useWorld((s) => s.venue)
  const framed = useRef(new Set<string>())
  const seen = useRef(new Set<string>())
  const located = useRef(new Set<string>())
  const wasOpen = useRef(false)
  const fitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (fitTimer.current) clearTimeout(fitTimer.current)
  }, [])

  useEffect(() => {
    const list = Object.values(incidents)
    if (list.length === 0) {
      seen.current.clear()
      located.current.clear()
    }
    for (const inc of list) {
      if (!seen.current.has(inc.incidentId)) {
        seen.current.add(inc.incidentId)
        if (inc.status !== 'resolved') useUi.getState().select({ kind: 'incident', id: inc.incidentId })
      }
      // fly in when the location first arrives, and again when the camera confirms it
      const key = `${inc.incidentId}:${inc.localizationStatus}`
      if (inc.status !== 'resolved' && inc.location && !located.current.has(key)) {
        located.current.add(key)
        mapController.focusIncident(inc.incidentId)
      }
    }
    const anyOpen = list.some((i) => i.status !== 'resolved')
    if (anyOpen && fitTimer.current) {
      clearTimeout(fitTimer.current)
      fitTimer.current = null
    }
    if (wasOpen.current && !anyOpen) {
      // let the resolution register on the map, then step back to the whole venue
      fitTimer.current = setTimeout(() => {
        fitTimer.current = null
        mapController.fit()
      }, 2500)
    }
    wasOpen.current = anyOpen
  }, [incidents, venue])

  // a path was previewed: show the whole corridor with the person at its end
  useEffect(() => {
    for (const c of Object.values(commands)) {
      if (c.approvalStatus !== 'pending_approval' || framed.current.has(c.commandId)) continue
      framed.current.add(c.commandId)
      const corridor = venue?.responderCorridors.find((x) => x.corridorId === c.corridorId)
      const inc = c.incidentId ? incidents[c.incidentId] : undefined
      if (corridor) mapController.frame([...corridor.path, ...(inc?.location ? [inc.location] : [])], 20)
    }
  }, [commands, incidents, venue])

  // the newest open incident, read out by the assertive live region
  return useMemo(() => {
    const inc = Object.values(incidents)
      .filter((i) => i.status !== 'resolved')
      .sort((a, b) => b.reportedAt - a.reportedAt)[0]
    if (!inc) return ''
    const zone = venue?.zones.find((z) => z.zoneId === inc.candidateZone)?.name ?? 'an unknown zone'
    const what = inc.source === 'manual_sos' ? 'SOS' : inc.source === 'imu_suspicion' ? 'Possible fall' : 'Alert'
    return `${what} at ${zone}${inc.reportedByDeviceId ? `, ${inc.reportedByDeviceId}` : ''}. ${inc.displayId}.`
  }, [incidents, venue])
}
