import { useEffect, useState, type FormEvent } from 'react'
import { useRoute } from '@/cover/route'
import { bandLabel } from '@/payments/model'
import { useSession } from '@/stdb/session'
import {
  PRESS_FROM,
  REPORT_KINDS,
  TEST_BANDS,
  breakSpeaker,
  fallHere,
  isOnline,
  loadTestHost,
  pressBand,
  reportBroken,
  useTestBands,
  walkTo,
  zoneNameFor,
  type ReportKind,
  type TestZone,
} from '@/stdb/testBands'
import { DeskFrame } from './DeskFrame'

const pill = 'h-11 rounded-full border border-line-strong px-4 text-[13px] text-ink hover:text-champagne disabled:border-line disabled:text-ink-muted disabled:hover:text-ink-muted'
const field = 'h-11 rounded-[4px] border border-line-strong bg-ground px-3 text-[14px] text-ink outline-none placeholder:text-ink-muted'
const columns = 'md:grid-cols-[7rem_minmax(0,1fr)_minmax(0,8rem)_minmax(0,2.4fr)_minmax(0,10rem)]'

/** Online needs a clock: a test band drops offline five seconds after the host last heard it. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

function Failure({ at }: { at: 'bands' | 'property' | 'report' }) {
  const failure = useTestBands((s) => s.failure)
  if (failure?.at !== at) return null
  return <p role="alert" className="mt-4 text-[14px] text-signal">{failure.message}</p>
}

function BandRow({ bandId, zones, now }: { bandId: number; zones: TestZone[]; now: number }) {
  const { go } = useRoute()
  const band = useTestBands((s) => s.bands[bandId])
  const wearers = useTestBands((s) => s.wearers)
  const busy = useTestBands((s) => s.busy)
  const label = bandLabel(bandId)
  const online = isOnline(band, now)
  const claimed = bandId in wearers
  const zone = band ? zoneNameFor(band.zone, zones) : ''
  return (
    <li aria-label={label} className={`desk-row grid gap-3 px-4 py-3 md:items-center md:gap-4 ${columns}`}>
      <div>
        <p className="font-mono text-[14px] text-ink">{label}</p>
        <p className={online ? 'mt-1 text-[13px] text-teal' : 'mt-1 text-[13px] text-ink-muted'}>{online ? 'Online' : 'Offline'}</p>
      </div>
      <p className="min-w-0 truncate text-[14px]">
        {claimed ? <span className="text-ink">{wearers[bandId] || 'No name yet'}</span> : <span className="text-ink-muted">Not claimed</span>}
      </p>
      <p className="truncate text-[13px] text-ink-dim">{zone || 'No zone'}</p>
      <div>
        <p className="mb-2 text-[13px] text-ink-dim md:hidden">Walk to</p>
        <div className="flex flex-wrap gap-2">
          {zones.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-label={`Walk ${label} to ${item.name}`}
              disabled={busy != null || item.stationId === band?.zone}
              onClick={() => void walkTo(bandId, item.stationId)}
              className={pill}
            >
              {item.name}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-2 md:justify-end">
        {bandId >= PRESS_FROM && (
          <button type="button" aria-label={`Press ${label}`} disabled={busy != null} onClick={() => void pressBand(bandId)} className={pill}>
            Press
          </button>
        )}
        {claimed && (
          <button
            type="button"
            aria-label={`Fall here, ${label}`}
            disabled={busy != null}
            onClick={() => void fallHere(bandId).then((done) => done && go('/claims'))}
            className={pill}
          >
            Fall here
          </button>
        )}
      </div>
    </li>
  )
}

function TestControls() {
  const { go } = useRoute()
  const zones = useTestBands((s) => s.zones)
  const busy = useTestBands((s) => s.busy)
  const now = useNow()
  return (
    <>
      <section aria-labelledby="test-bands-heading">
        <h2 id="test-bands-heading" className="font-display text-[26px] leading-none text-ink">Test bands</h2>
        <p className="mt-3 max-w-[68ch] text-[14px] leading-6 text-ink-dim">
          The first four are the claims story's attendees; the other six are the ones testers claim from a tap link: open /t/BANDIT-{PRESS_FROM}, then press that band here. A fall uses two of the story attendees as the bands around it, and they stay in that zone afterwards.
        </p>
        <Failure at="bands" />
        {zones.length === 0 && <p className="mt-4 text-[14px] text-ink-dim">The zone table has not arrived yet, so there is nowhere to walk to.</p>}
        <div aria-hidden className={`mt-6 hidden gap-4 px-4 text-[13px] text-ink-dim md:grid ${columns}`}>
          <span>Band</span>
          <span>Wearer</span>
          <span>Zone</span>
          <span>Walk to</span>
          <span />
        </div>
        <ul className="mt-2 grid gap-2">
          {TEST_BANDS.map((bandId) => <BandRow key={bandId} bandId={bandId} zones={zones} now={now} />)}
        </ul>
      </section>
      <section aria-labelledby="property-heading" className="mt-12">
        <h2 id="property-heading" className="font-display text-[26px] leading-none text-ink">Property damage</h2>
        <p className="mt-3 max-w-[68ch] text-[14px] leading-6 text-ink-dim">A venue camera sees a speaker knocked off its stand; the vision check confirms it and a property claim opens.</p>
        <Failure at="property" />
        {zones.length === 0 ? (
          <p className="mt-4 text-[14px] text-ink-dim">The zone table has not arrived yet.</p>
        ) : (
          <div className="mt-4 flex flex-wrap gap-2">
            {zones.map((zone) => (
              <button
                key={zone.id}
                type="button"
                disabled={busy != null}
                onClick={() => void breakSpeaker(zone.stationId).then((done) => done && go('/claims'))}
                className={pill}
              >
                {`Speaker breaks in ${zone.name}`}
              </button>
            ))}
          </div>
        )}
      </section>
    </>
  )
}

/** Staff report of broken or stolen venue equipment. Opens an incident with no band on it. */
export function ReportBrokenForm() {
  const zones = useTestBands((s) => s.zones)
  const busy = useTestBands((s) => s.busy)
  const [kind, setKind] = useState<ReportKind>('property')
  const [zoneId, setZoneId] = useState('')
  const [note, setNote] = useState('')
  const [reported, setReported] = useState(false)
  const where = zones.some((zone) => zone.id === zoneId) ? zoneId : (zones[0]?.id ?? '')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setReported(false)
    if (await reportBroken(kind, where, note)) {
      setKind('property')
      setZoneId('')
      setNote('')
      setReported(true)
    }
  }

  return (
    <section aria-labelledby="report-heading">
      <h2 id="report-heading" className="font-display text-[26px] leading-none text-ink">Report something broken or stolen</h2>
      <form onSubmit={(event) => void submit(event)} className="mt-5 grid gap-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,0.8fr)_minmax(0,1.4fr)_auto] md:items-end">
        <label className="text-[13px] text-ink-dim">
          What happened
          <select value={kind} onChange={(event) => setKind(event.target.value as ReportKind)} className={`${field} mt-1 w-full`}>
            {REPORT_KINDS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label className="text-[13px] text-ink-dim">
          Where
          <select value={where} onChange={(event) => setZoneId(event.target.value)} disabled={zones.length === 0} className={`${field} mt-1 w-full`}>
            {zones.map((zone) => (
              <option key={zone.id} value={zone.id}>{zone.name}</option>
            ))}
          </select>
        </label>
        <label className="text-[13px] text-ink-dim">
          Note
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="What it is and what it is worth, e.g. a sponsor's laptop, $1,299"
            className={`${field} mt-1 w-full`}
          />
        </label>
        <button type="submit" disabled={busy != null || zones.length === 0} className="h-11 rounded-full border border-line-strong px-5 text-[14px] text-ink hover:text-champagne disabled:text-ink-muted">
          {busy === 'report' ? 'Reporting…' : 'Report it'}
        </button>
      </form>
      {zones.length === 0 && <p className="mt-3 text-[13px] text-ink-dim">The zone table has not arrived yet.</p>}
      <Failure at="report" />
      {reported && <p className="mt-4 text-[14px] text-ink">Reported.</p>}
    </section>
  )
}

/** The host's test bands 90 to 99, its staged property damage, and the staff report of broken equipment. */
export function TestBandsPage() {
  const owner = useSession((s) => s.owner)
  const roles = useSession((s) => s.roles)
  const host = useTestBands((s) => s.host)
  const ops = owner || roles.includes('ops')
  const reporter = ops || roles.includes('medic')
  useEffect(() => {
    void loadTestHost()
  }, [])
  return (
    <DeskFrame motif="testbands" title="Test bands" sentence="Bands 90 to 99 exist only for testing. Walk them between zones, press their buttons, and stage a fall or a broken speaker.">
      {host == null ? (
        <p className="text-[15px] text-ink-dim">Reading this host's settings.</p>
      ) : !host.testMode ? (
        <p className="text-[15px] text-ink">Test controls are off on this host.</p>
      ) : !ops ? (
        <p className="text-[15px] text-ink">Only an organizer can use the test controls.</p>
      ) : (
        <TestControls />
      )}
      {reporter && (
        <div className="mt-12">
          <ReportBrokenForm />
        </div>
      )}
    </DeskFrame>
  )
}
