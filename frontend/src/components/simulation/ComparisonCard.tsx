import { CartesianGrid, Line, LineChart, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import { Switch } from '@/components/ui/switch'
import { useUi } from '@/stores/ui'
import { useWorld } from '@/stores/world'

/**
 * Same seed, two runs: the crowd with band guidance and the crowd without it, forked at the moment
 * the path was approved. It shows what the bands change in the simulation; it is not a safety model.
 */
export function ComparisonCard() {
  const cmp = useWorld((s) => s.scenario?.comparison)
  const seed = useWorld((s) => s.scenario?.seed)
  const compliance = useWorld((s) => s.scenario?.compliance)
  const ghosts = useUi((s) => s.layers.baseline)
  const toggle = useUi((s) => s.toggleLayer)
  if (!cmp) return null
  const data = cmp.samples
  const last = data[data.length - 1]
  const gain =
    cmp.arrivalWithGuidanceS !== null && cmp.arrivalBaselineS !== null ? Math.round(cmp.arrivalBaselineS - cmp.arrivalWithGuidanceS) : null

  return (
    <section aria-labelledby="cmp-h" className="nc-panel pointer-events-auto px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="cmp-h" className="text-[13px] font-medium text-ink">
            With the bands, and without
          </h2>
          <p className="mt-0.5 text-[11.5px] text-ink-muted">
            Simulated · same seed {seed} · {Math.round((compliance ?? 0) * 100)}% follow their band
          </p>
        </div>
        <span aria-hidden className="nc-sim-stripes mt-1 h-3 w-5 rounded-[2px]" />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-[12px] text-ink-muted">Medic reached them</span>
          <span className="font-display text-[26px] leading-none text-ink">
            {cmp.arrivalWithGuidanceS !== null ? `${Math.round(cmp.arrivalWithGuidanceS)} s` : '…'}
          </span>
          <span className="text-[11.5px] text-ink-dim">path cleared</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[12px] text-ink-muted">Without the bands</span>
          <span className="font-display text-[26px] leading-none text-[#cfc4ff]">
            {cmp.arrivalBaselineS !== null ? `${Math.round(cmp.arrivalBaselineS)} s` : cmp.arrivalWithGuidanceS !== null ? 'not yet' : '…'}
          </span>
          <span className="text-[11.5px] text-ink-dim">same seed</span>
        </div>
      </div>
      {gain !== null && gain > 0 && <p className="mt-2 text-[12.5px] text-ink">{gain} s sooner with the path cleared</p>}

      <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-ink-muted">
        <span>In the lane</span>
        <span className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-[2px] w-3 bg-champagne" />
            with bands {last ? last.withGuidance : ''}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-0 w-3 border-t-2 border-dashed border-[#b8a6ff]" />
            without {last ? last.baseline : ''}
          </span>
        </span>
      </div>
      <div className="mt-1 h-16">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -22 }}>
            <CartesianGrid vertical={false} stroke="rgba(207,208,212,0.08)" />
            <XAxis
              dataKey="t"
              type="number"
              domain={[0, (max: number) => Math.max(30, max)]}
              tickFormatter={(v: number) => `${v}s`}
              tick={{ fill: '#85858b', fontSize: 11 }}
              axisLine={{ stroke: 'rgba(207,208,212,0.2)' }}
              tickLine={false}
              tickCount={3}
            />
            <YAxis tick={{ fill: '#85858b', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} width={44} tickCount={3} />
            <Line type="linear" dataKey="baseline" stroke="#b8a6ff" strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
            <Line type="linear" dataKey="withGuidance" stroke="var(--nc-champagne)" strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <label className="mt-2 flex items-center justify-between gap-3 border-t border-line pt-2.5 text-[12px] text-ink-dim">
        Ghosts of the run without bands
        <Switch checked={ghosts} onCheckedChange={(on) => toggle('baseline', on)} />
      </label>
    </section>
  )
}
