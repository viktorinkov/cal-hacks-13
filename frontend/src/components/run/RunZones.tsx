import { useMemo } from 'react'
import { CROWD_FROM, TEST_BANDS, clock, isOnline, setRunLowVis, useRun, zoneRows } from '@/stdb/runOps'
import { Refusal, Section, TwoStep, pill } from './parts'

const LEVEL_TONE = { calm: 'text-teal', busy: 'text-amber', 'very busy': 'text-signal' } as const
const columns = 'md:grid-cols-[minmax(0,1.3fr)_5.5rem_6rem_6.5rem_5.5rem_5.5rem_5rem_minmax(0,7rem)]'

/** Every zone now: who is in it, how close they stand, its exit colour and its station. */
export function RunZones({ now, ops }: { now: number; ops: boolean }) {
  const bands = useRun((s) => s.bands)
  const zones = useRun((s) => s.zones)
  const stations = useRun((s) => s.stations)
  const gateway = useRun((s) => s.gateway)
  const yellow = useRun((s) => s.yellow)
  const red = useRun((s) => s.red)
  const lowVis = useRun((s) => s.lowVis)
  const busy = useRun((s) => s.busy)
  const online = useMemo(() => bands.filter((band) => isOnline(band, now)), [bands, now])
  const rows = useMemo(() => zoneRows(zones, online, stations, yellow, red), [zones, online, stations, yellow, red])
  const crowd = online.filter((band) => band.id >= CROWD_FROM).length
  const test = online.filter((band) => band.id >= TEST_BANDS.from && band.id <= TEST_BANDS.to).length
  const inZone = online.filter((band) => band.zone !== 0).length

  return (
    <Section id="run-zones-heading" title="Zones">
      <p className="max-w-[72ch] text-[14px] leading-6 text-ink-dim">
        {`${online.length.toLocaleString('en-US')} bands at the event right now: ${crowd.toLocaleString('en-US')} in the crowd, ${test} test bands and ${online.length - crowd - test} hardware bands.`}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {lowVis ? (
          <>
            <p className="text-[14px] leading-6 text-ink">Low visibility is on: every band guides its wearer to the exit colour of its zone.</p>
            {ops && (
              <button type="button" disabled={busy != null} className={pill} onClick={() => void setRunLowVis(false)}>
                {busy === 'lowvis' ? 'Turning it off…' : 'Turn it off'}
              </button>
            )}
          </>
        ) : ops ? (
          <TwoStep
            label="Low visibility: guide everyone to the exits"
            question="Fire or smoke? Every band starts guiding its wearer to the exit."
            confirm="Guide them out"
            working="Turning it on…"
            cancel="Not now"
            busy={busy === 'lowvis'}
            disabled={busy != null}
            onConfirm={() => setRunLowVis(true)}
          />
        ) : null}
      </div>
      {ops && <Refusal keys={['lowvis']} className="mt-3" />}
      <p className="mt-4 max-w-[72ch] text-[13px] leading-5 text-ink-dim">
        {`${inZone.toLocaleString('en-US')} of the ${online.length.toLocaleString('en-US')} bands are in a zone right now. The gateway, which receives the hardware bands, is ${gateway?.online ? 'online' : 'offline'}${gateway ? `, last heard at ${clock(gateway.lastLine)}` : ''}. A zone is busy when its bands have ${yellow} other bands close by on average, very busy at ${red}.`}
      </p>
      {rows.length === 0 ? (
        <p className="mt-6 text-[15px] text-ink-dim">The zone table has not arrived yet.</p>
      ) : (
        <>
          <div aria-hidden className={`mt-6 hidden gap-3 px-4 text-[13px] text-ink-dim md:grid ${columns}`}>
            <span>Zone</span>
            <span>People now</span>
            <span>Hardware and test bands</span>
            <span>Bands close by, average</span>
            <span>Level</span>
            <span>Capacity</span>
            <span>Exit</span>
            <span>Station</span>
          </div>
          <ul aria-label="Zones" className="mt-2 divide-y divide-line">
            {rows.map((zone) => (
              <li key={zone.id} className={`desk-row grid grid-cols-2 gap-x-3 gap-y-1 px-4 py-3 text-[13px] md:items-baseline ${columns}`}>
                <p className="col-span-2 truncate text-[15px] text-ink md:col-span-1">{zone.name || `Station ${zone.stationId}`}</p>
                <p className="tabular-nums text-ink"><span className="text-ink-dim md:hidden">People now </span>{zone.people.toLocaleString('en-US')}</p>
                <p className="tabular-nums text-ink"><span className="text-ink-dim md:hidden">Hardware and test </span>{zone.hardware}</p>
                <p className="tabular-nums text-ink"><span className="text-ink-dim md:hidden">Close by </span>{zone.neighbours.toFixed(1)}</p>
                <p className={LEVEL_TONE[zone.level]}>{zone.level}</p>
                <p className="tabular-nums text-ink"><span className="text-ink-dim md:hidden">Capacity </span>{zone.capacity.toLocaleString('en-US')}</p>
                <p className="text-ink"><span className="text-ink-dim md:hidden">Exit </span>{zone.exit}</p>
                <p className={zone.stationOnline ? 'text-ink' : 'text-ink-muted'}>{`${zone.stationId} ${zone.stationOnline ? 'online' : 'offline'}`}</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </Section>
  )
}
