import { formatCents } from '@/cover/money'
import { useCatalog } from '@/stdb/catalog'
import { DeskFrame, Figure, when } from './DeskFrame'

function plain(value: string): string {
  const text = value.replaceAll('_', ' ').trim()
  if (!text) return ''
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** Posted money: the ledger and the billed lines. Settlements is where a claim is decided. */
export function CostsPage() {
  const ledger = useCatalog((s) => s.ledger)
  const bills = useCatalog((s) => s.bills)
  const debits = ledger.reduce((sum, line) => sum + line.debitCents, 0)
  const credits = ledger.reduce((sum, line) => sum + line.creditCents, 0)
  const billed = bills.reduce((sum, line) => sum + line.billedCents, 0)
  const covered = bills.reduce((sum, line) => sum + line.coveredCents, 0)
  const empty = ledger.length === 0 && bills.length === 0

  return (
    <DeskFrame
      title={empty ? 'No costs posted yet.' : `${formatCents(Math.max(debits, billed))} on the books.`}
      sentence="Ledger postings and billed lines from the live host. A claim is still decided on Settlements."
      figures={
        <>
          <Figure lead label="Debits" value={formatCents(debits)} note="posted" />
          <Figure label="Credits" value={formatCents(credits)} note="posted" />
          <Figure label="Billed" value={formatCents(billed)} note={`${bills.length} lines`} />
          <Figure label="Covered" value={formatCents(covered)} note="of those lines" />
        </>
      }
    >
      {empty ? (
        <p className="text-[15px] text-ink-dim">The ledger has not arrived from the live host yet.</p>
      ) : (
        <>
          {ledger.length > 0 && (
            <section>
              <h2 className="text-[13px] text-ink-dim">Ledger</h2>
              <ul className="mt-3 divide-y divide-line">
                {ledger.map((line) => (
                  <li key={line.id} className="grid gap-1 py-3 md:grid-cols-[minmax(7.5rem,12rem)_minmax(0,1fr)_7rem_7rem] md:items-baseline">
                    <span className="text-[13px] leading-5 text-ink-dim">{plain(line.journal) || 'Entry'}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] text-ink">{plain(line.account) || line.memo || `Claim ${line.claimId}`}</span>
                      <span className="mt-1 block truncate text-[13px] text-ink-muted">{[line.memo, when(line.postedAt)].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className="font-mono text-[13px] text-ink">{line.debitCents ? formatCents(line.debitCents) : ''}</span>
                    <span className="font-mono text-[13px] text-ink-dim">{line.creditCents ? formatCents(line.creditCents) : ''}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {bills.length > 0 && (
            <section className="mt-12">
              <h2 className="text-[13px] text-ink-dim">Billed lines</h2>
              <ul className="mt-3 divide-y divide-line">
                {bills.map((line) => (
                  <li key={line.id} className="grid gap-1 py-3 md:grid-cols-[minmax(0,1fr)_7rem_7rem_6rem]">
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] text-ink">{plain(line.description) || `Claim ${line.claimId}`}</span>
                      <span className="mt-1 block text-[13px] text-ink-muted">Claim {line.claimId}</span>
                    </span>
                    <span className="font-mono text-[13px] text-ink">{formatCents(line.billedCents)}</span>
                    <span className="font-mono text-[13px] text-ink-dim">{formatCents(line.coveredCents)}</span>
                    <span className="text-[13px] text-ink-muted">{plain(line.outcome)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </DeskFrame>
  )
}
