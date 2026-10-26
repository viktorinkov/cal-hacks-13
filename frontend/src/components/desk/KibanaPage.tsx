import { useEffect } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { KIBANA_INTRO, KIBANA_JOBS, kibanaHref, loadDeskHost, useHost } from '@/stdb/kibana'
import { DeskFrame } from './DeskFrame'

/** What the Elastic project does for the event, and the Kibana view behind each job. */
export function KibanaPage() {
  const host = useHost((s) => s.host)
  useEffect(() => {
    void loadDeskHost()
  }, [])
  const base = host?.kibanaUrl ?? ''
  return (
    <DeskFrame motif="kibana" title={KIBANA_INTRO.title} sentence={KIBANA_INTRO.text}>
      {host && !base && <p className="mb-6 text-[14px] text-signal">No Kibana address on this host.</p>}
      <div className="grid gap-4 md:grid-cols-2">
        {KIBANA_JOBS.map(({ job, what, views }) => (
          <section key={job} aria-label={job} className="desk-card flex flex-col p-5">
            <h2 className="font-display text-[22px] leading-[1.15] tracking-[-0.01em] text-ink">{job}</h2>
            <p className="mt-3 text-[14px] leading-6 text-ink-dim">{what}</p>
            <ul className="mt-4 divide-y divide-line border-t border-line">
              {views.map(([label, path]) => (
                <li key={path}>
                  {base ? (
                    <a
                      href={kibanaHref(base, path)}
                      target="_blank"
                      rel="noreferrer"
                      className="flex min-h-11 items-center justify-between gap-3 py-2 text-[14px] text-ink hover:text-champagne"
                    >
                      <span className="min-w-0">{label}</span>
                      <ArrowUpRight aria-hidden className="size-4 shrink-0 text-ink-muted" />
                    </a>
                  ) : (
                    <span className="flex min-h-11 items-center py-2 text-[14px] text-ink-muted">{label}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </DeskFrame>
  )
}
