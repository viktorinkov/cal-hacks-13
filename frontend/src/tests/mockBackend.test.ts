import { describe, expect, it } from 'vitest'
import type { StreamEvent } from '@/contracts/domain'
import { MockBackend } from '@/mock/MockBackend'

function backend() {
  return new MockBackend({ crowdSize: 300, warmupS: 2 })
}

function run(b: MockBackend, seconds: number) {
  for (let k = 0; k < seconds * 10; k++) b.step()
}

describe('mock backend scenario', () => {
  it('turns an SOS press into an estimated incident, then a camera-confirmed one', () => {
    const b = backend()
    b.pressSos('band-03')
    run(b, 0.5)
    const inc = [...b.incidents.values()][0]
    expect(inc.status).toBe('reported')
    expect(inc.source).toBe('manual_sos')
    expect(inc.localizationStatus).toBe('estimated')
    expect(inc.locationRadiusM).toBe(6)
    expect(inc.isSimulated).toBe(true)
    run(b, 3)
    expect(b.incidents.get(inc.incidentId)!.localizationStatus).toBe('visually_confirmed')
  })

  it('keeps the incident when the camera cannot see it, and does not move its location', () => {
    const b = backend()
    b.setCameraOutcome('not_visible')
    b.pressSos('band-03')
    run(b, 0.5)
    const before = { ...[...b.incidents.values()][0].location! }
    run(b, 3)
    const inc = [...b.incidents.values()][0]
    expect(inc.status).toBe('reported')
    expect(inc.localizationStatus).toBe('estimated')
    expect(inc.location).toEqual(before)
    expect([...b.observations.values()][0].status).toBe('not_visible')
  })

  it('only changes a band once it acknowledges, and marks a silent band failed', () => {
    const b = backend()
    b.setFlakyRadio(true)
    b.pressSos('band-03')
    run(b, 3)
    const inc = [...b.incidents.values()][0]
    b.acknowledge(inc.incidentId)
    const cmd = b.preview({ incidentId: inc.incidentId })
    expect(cmd.approvalStatus).toBe('pending_approval')
    const target = cmd.targets[0]
    expect(b.devices.get(target.deviceId)!.currentPattern).not.toBe(target.patternCode)
    b.approve(cmd.commandId)
    // sent, not yet confirmed: the band still shows what it showed
    expect(b.commands.get(cmd.commandId)!.deliveryStatus).toBe('sending')
    run(b, 4)
    const after = b.commands.get(cmd.commandId)!
    expect(after.deliveryStatus).toBe('partial')
    expect(after.failedDevices).toHaveLength(1)
    const ok = after.targets.find((t) => t.status === 'acknowledged')!
    expect(b.devices.get(ok.deviceId)!.currentPattern).toBe(ok.patternCode)
    // resend recovers it
    b.resend(cmd.commandId)
    run(b, 2)
    expect(b.commands.get(cmd.commandId)!.deliveryStatus).toBe('delivered')
  })

  it('counts the simulated crowd bands a path reaches, apart from the demo bands', () => {
    const b = new MockBackend({ crowdSize: 1200, warmupS: 10 })
    b.triggerCongestion()
    run(b, 10)
    b.pressSos('band-03')
    run(b, 3)
    const inc = [...b.incidents.values()][0]
    b.acknowledge(inc.incidentId)
    const cmd = b.preview({ incidentId: inc.incidentId })
    // a preview only estimates: nothing has been sent
    const est = b.scenario.simulatedBands!
    expect(est).toMatchObject({ commandId: cmd.commandId, estimate: true })
    expect(est.signalled).toBeGreaterThan(cmd.targets.length)
    b.approve(cmd.commandId)
    run(b, 1)
    expect(b.scenario.simulatedBands!.estimate).toBe(false)
    run(b, 20)
    const live = b.scenario.simulatedBands!
    expect(live.signalled).toBeGreaterThan(cmd.targets.length)
    expect(live.following).toBeLessThanOrEqual(live.signalled)
    expect(live.following).toBeGreaterThan(0)
    // the demo bands stay the command's own targets
    expect(b.commands.get(cmd.commandId)!.targets).toHaveLength(cmd.targets.length)
  })

  it('compares against a same-seed baseline and the guided responder is not slower', () => {
    const b = new MockBackend({ crowdSize: 1200, warmupS: 10 })
    b.triggerCongestion()
    run(b, 10)
    b.pressSos('band-03')
    run(b, 3)
    const inc = [...b.incidents.values()][0]
    b.acknowledge(inc.incidentId)
    const cmd = b.preview({ incidentId: inc.incidentId })
    b.approve(cmd.commandId)
    run(b, 90)
    const cmp = b.scenario.comparison!
    expect(cmp.arrivalWithGuidanceS).not.toBeNull()
    expect(cmp.samples.length).toBeGreaterThan(10)
    if (cmp.arrivalBaselineS !== null) expect(cmp.arrivalWithGuidanceS!).toBeLessThanOrEqual(cmp.arrivalBaselineS)
  })

  it('resolving returns every band to ready and reset restores the initial state', () => {
    const b = backend()
    b.pressSos('band-03')
    run(b, 3)
    const inc = [...b.incidents.values()][0]
    b.acknowledge(inc.incidentId)
    b.approve(b.preview({ incidentId: inc.incidentId }).commandId)
    run(b, 3)
    b.resolve(inc.incidentId, 'assisted_on_scene')
    run(b, 3)
    for (const d of b.devices.values()) if (d.connectionStatus !== 'disconnected') expect(d.currentPattern).toBe('ready')
    expect(b.incidents.get(inc.incidentId)!.status).toBe('resolved')
    b.reset(false)
    expect(b.incidents.size).toBe(0)
    expect(b.commands.size).toBe(0)
    expect(b.scenario.step).toBe('normal')
  })

  it('is deterministic: the same actions produce the same events', () => {
    const record = () => {
      const b = backend()
      const types: string[] = []
      b.onEvent((e: StreamEvent) => {
        if (e.type === 'incident') types.push(`${e.at}:${e.incident.status}:${e.incident.location?.x}`)
      })
      b.pressSos('band-03')
      run(b, 4)
      return types
    }
    expect(record()).toEqual(record())
  })

  it('refuses to approve twice or to act on unknown incidents', () => {
    const b = backend()
    b.pressSos('band-03')
    run(b, 1)
    const inc = [...b.incidents.values()][0]
    const cmd = b.preview({ incidentId: inc.incidentId })
    b.approve(cmd.commandId)
    expect(() => b.approve(cmd.commandId)).toThrow()
    expect(() => b.acknowledge('nope')).toThrow()
  })
})
