import { ArrowLeft, ChevronLeft, ChevronRight, ChevronsLeftRight, Expand, Maximize, Shrink } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type KeyboardEvent, type PointerEvent, type ReactNode, type SetStateAction } from 'react'
import { cn } from '@/lib/utils'
import { useCatalog } from '@/stdb/catalog'
import { DeskFrame, Figure, when } from './DeskFrame'
import { frames as joinFrames, placeLine, placeName, placeTitle, usePlaces, type Frame, type PlacedPhoto } from './photoPlaces'
import type { Lens, PhotoScan } from './photoScan'

function Tool({ onClick, label, children }: { onClick: () => void; label?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="inline-flex h-7 items-center gap-1.5 rounded-[3px] px-2.5 text-[13px] text-ink-dim transition-colors hover:bg-accent hover:text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-champagne [&_svg]:size-3.5 [&_svg]:stroke-[1.5]"
    >
      {children}
    </button>
  )
}

function Bands({ ids, test }: { ids: number[]; test: boolean }) {
  return (
    <span className="flex flex-wrap gap-1">
      {ids.map((id) => (
        <span key={id} title={test ? 'Test band' : undefined} className={cn('rounded-[3px] px-1.5 py-0.5 text-[12px] leading-4 tabular-nums text-ink', test ? 'nc-sim-stripes' : 'bg-accent')}>
          Band {id}
        </span>
      ))}
    </span>
  )
}

function Caption({ photo, index, total, onStep }: { photo: PlacedPhoto; index: number; total: number; onStep: (by: number) => void }) {
  const to = photo.sendTo.filter((id) => id !== photo.photographer)
  return (
    <>
      <h2 className="font-display text-[30px] leading-[1.02] tracking-[-0.01em] text-ink">{placeTitle(photo)}</h2>
      {placeLine(photo) && <p className="mt-1.5 text-[13px] text-ink-dim">{placeLine(photo)}</p>}
      {photo.taken && <p className="mt-0.5 text-[13px] tabular-nums text-ink-muted">{when(Date.parse(photo.taken))}</p>}
      <dl className="mt-5 grid grid-cols-[3.75rem_1fr] items-baseline gap-x-3 gap-y-2.5 text-[13px]">
        <dt className="text-ink-muted">To</dt>
        <dd className="min-w-0">
          {!photo.sure ? (
            <span className="text-ink-dim">Held back</span>
          ) : to.length ? (
            <Bands ids={to} test={photo.testBands} />
          ) : (
            <span className="text-ink-dim">Nobody in frame</span>
          )}
        </dd>
        {photo.photographer != null && photo.sure && (
          <>
            <dt className="text-ink-muted">Taken by</dt>
            <dd>
              <Bands ids={[photo.photographer]} test={photo.testBands} />
            </dd>
          </>
        )}
      </dl>
      <div className="mt-5 flex items-center justify-between border-t border-line pt-3">
        <p className="text-[12px] tabular-nums text-ink-muted">
          {photo.points} points · {photo.error.toFixed(1)} px
        </p>
        <div className="-mr-1.5 flex items-center">
          <Tool label="Previous photograph" onClick={() => onStep(-1)}>
            <ChevronLeft />
          </Tool>
          <span className="px-0.5 text-[12px] tabular-nums text-ink-muted">
            {index + 1}/{total}
          </span>
          <Tool label="Next photograph" onClick={() => onStep(1)}>
            <ChevronRight />
          </Tool>
        </div>
      </div>
    </>
  )
}

function LensFrame({ lens, photo, wipe, shown, onWipe }: { lens: Lens; photo: PlacedPhoto; wipe: number; shown: boolean; onWipe: Dispatch<SetStateAction<number>> }) {
  const box = useRef<HTMLDivElement>(null)
  const drag = (e: PointerEvent<HTMLDivElement>) => {
    const r = box.current?.getBoundingClientRect()
    if (r) onWipe(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)))
  }
  const keys = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      e.stopPropagation()
      const by = e.key === 'ArrowRight' ? 0.05 : -0.05
      onWipe((w) => Math.min(1, Math.max(0, w + by)))
    }
  }
  const frame: CSSProperties = {
    left: lens.x,
    top: lens.y,
    width: lens.w,
    height: lens.h,
    boxShadow: '0 0 0 1px var(--nc-line-strong), 0 0 0 100vmax rgba(10, 10, 11, 0.66)',
  }
  return (
    <div
      ref={box}
      style={frame}
      className="absolute cursor-ew-resize touch-none select-none"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        drag(e)
      }}
      onPointerMove={(e) => e.buttons && drag(e)}
    >
      <img
        src={photo.image}
        alt=""
        draggable={false}
        className="absolute inset-0 h-full w-full transition-opacity duration-700 ease-out"
        style={{ opacity: shown ? 1 : 0, clipPath: `inset(0 ${(1 - wipe) * 100}% 0 0)` }}
      />
      <div className="pointer-events-none absolute inset-y-0 w-px bg-champagne/80" style={{ left: `${wipe * 100}%`, opacity: shown ? 1 : 0 }} />
      <button
        type="button"
        role="slider"
        aria-label="Photograph and scan"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(wipe * 100)}
        onKeyDown={keys}
        className="nc-panel absolute top-1/2 grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full text-ink transition-opacity focus-visible:outline focus-visible:outline-1 focus-visible:outline-champagne"
        style={{ left: `${wipe * 100}%`, opacity: shown ? 1 : 0 }}
      >
        <ChevronsLeftRight className="size-3.5 stroke-[1.5]" />
      </button>
      <span className="pointer-events-none absolute bottom-2 left-2.5 text-[11px] text-ink/70 nc-halo-text" style={{ opacity: shown && wipe > 0.12 ? 1 : 0 }}>
        Photograph
      </span>
      <span className="pointer-events-none absolute bottom-2 right-2.5 text-[11px] text-ink/70 nc-halo-text" style={{ opacity: shown && wipe < 0.88 ? 1 : 0 }}>
        Scan
      </span>
    </div>
  )
}

export function PhotosPage() {
  const album = useCatalog((s) => s.photos)
  const { places, missing } = usePlaces()
  const all = useMemo(() => joinFrames(album, places), [album, places])
  const placed = useMemo(() => all.filter((f): f is Frame & { place: PlacedPhoto } => f.place != null).map((f) => f.place), [all])
  const sure = placed.filter((p) => p.sure)

  const frame = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const engine = useRef<PhotoScan | null>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [full, setFull] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null)
  const [lens, setLens] = useState<Lens | null>(null)
  const [wipe, setWipe] = useState(1)
  const [shown, setShown] = useState(false)
  const opened = placed.find((p) => p.id === openId) ?? null

  const open = useCallback((id: string | null) => {
    setOpenId(id)
    setShown(false)
    setWipe(1)
    engine.current?.open(id)
  }, [])

  useEffect(() => {
    if (!places) return
    let alive = true
    import('./photoScan')
      .then(({ photoScan }) => {
        if (!alive || !stage.current) return
        const scan = photoScan(places.scan)
        scan.on({
          ready: () => alive && setReady(true),
          pick: (id) => alive && open(id),
          hover: (id, at) => alive && setHover(id && at ? { id, ...at } : null),
          lens: (rect) => alive && setLens(rect),
        })
        scan.attach(stage.current)
        engine.current = scan
      })
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
      engine.current?.detach()
      engine.current = null
    }
  }, [places, open])

  useEffect(() => {
    engine.current?.setPhotos(placed)
  }, [placed, ready])

  const arrived = lens !== null
  const openedId = opened?.id ?? null
  useEffect(() => {
    if (!arrived || !openedId) return
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const develop = window.setTimeout(() => setShown(true), 30)
    let raf = 0
    const settle = window.setTimeout(
      () => {
        const t0 = performance.now()
        const step = (now: number) => {
          const t = still ? 1 : Math.min(1, (now - t0) / 900)
          setWipe(1 - 0.5 * (1 - (1 - t) ** 3))
          if (t < 1) raf = requestAnimationFrame(step)
        }
        raf = requestAnimationFrame(step)
      },
      still ? 0 : 1100,
    )
    return () => {
      window.clearTimeout(develop)
      window.clearTimeout(settle)
      cancelAnimationFrame(raf)
    }
  }, [arrived, openedId])

  const step = useCallback(
    (by: number) => {
      if (!opened || !placed.length) return
      const i = placed.findIndex((p) => p.id === opened.id)
      open(placed[(i + by + placed.length) % placed.length].id)
    },
    [opened, placed, open],
  )

  useEffect(() => {
    const keys = (e: globalThis.KeyboardEvent) => {
      if (!opened) return
      if (e.key === 'Escape') open(null)
      if (e.key === 'ArrowRight') step(1)
      if (e.key === 'ArrowLeft') step(-1)
    }
    window.addEventListener('keydown', keys)
    return () => window.removeEventListener('keydown', keys)
  }, [opened, open, step])

  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === frame.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const fromAlbum = (id: string) => {
    stage.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    open(id)
  }
  const hovered = hover ? placed.find((p) => p.id === hover.id) : null
  const side = lens != null && lens.x >= 300
  const caption: CSSProperties | undefined = lens
    ? side
      ? { left: 16, top: lens.y + 48, width: 268 }
      : { left: 12, right: 12, top: lens.y + lens.h + 12 }
    : undefined

  return (
    <DeskFrame
      figures={
        <>
          <Figure lead label="Frames" value={all.length.toLocaleString('en-US')} note="in the album" />
          <Figure label="Placed" value={String(placed.length)} note="found in the scan" />
          <Figure label="Sent" value={String(sure.filter((p) => p.sendTo.length).length)} note="to the bands in frame" />
          <Figure label="Held back" value={String(placed.length - sure.length)} note="for a second look" />
        </>
      }
    >
      <div ref={frame} className="relative h-[68vh] min-h-[520px] overflow-hidden rounded-[4px] bg-panel shadow-[0_0_0_1px_var(--nc-line)]">
        <div ref={stage} className="absolute inset-0" />
        {(!ready || missing || failed) && (
          <p className="absolute inset-0 grid place-items-center px-6 text-center text-[15px] text-ink-dim">
            {failed ? 'This browser could not start the 3D view' : missing ? 'No photograph has been placed in the hall yet' : 'Loading the hall…'}
          </p>
        )}

        {opened && lens && <LensFrame lens={lens} photo={opened} wipe={wipe} shown={shown} onWipe={setWipe} />}

        {opened ? (
          <>
            <div className="absolute left-4" style={{ top: lens && side ? lens.y : 12 }}>
              <div className="nc-panel flex items-center p-1">
                <Tool onClick={() => open(null)}>
                  <ArrowLeft /> Hall
                </Tool>
              </div>
            </div>
            {lens && (
              <aside
                aria-label="Photograph"
                style={caption}
                className="nc-panel absolute p-4"
              >
                <Caption photo={opened} index={placed.indexOf(opened)} total={placed.length} onStep={step} />
              </aside>
            )}
          </>
        ) : (
          ready && (
            <>
              <div className="absolute right-3 top-3 nc-panel flex items-center gap-0.5 p-1">
                <Tool onClick={() => engine.current?.fit()}>
                  <Maximize /> Fit
                </Tool>
                <Tool onClick={() => (document.fullscreenElement ? void document.exitFullscreen() : void frame.current?.requestFullscreen?.())}>
                  {full ? <Shrink /> : <Expand />} {full ? 'Exit full screen' : 'Full screen'}
                </Tool>
              </div>
            </>
          )
        )}

        {!opened && hover && hovered && (
          <div className="nc-panel pointer-events-none absolute px-2.5 py-1.5" style={{ left: hover.x + 14, top: hover.y + 14 }}>
            <p className="text-[13px] text-ink">{placeTitle(hovered)}</p>
            {hovered.taken && <p className="text-[12px] tabular-nums text-ink-muted">{when(Date.parse(hovered.taken))}</p>}
          </div>
        )}
      </div>

      {all.length === 0 ? (
        <p className="mt-10 text-[15px] text-ink-dim">Nothing has been taken yet</p>
      ) : (
        <ul className="mt-10 grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-3 xl:grid-cols-4">
          {all.map((f) => {
            const p = f.place
            const on = p != null && p.id === openId
            return (
              <li key={f.id}>
                <button
                  type="button"
                  disabled={!p}
                  onClick={() => p && fromAlbum(p.id)}
                  onPointerEnter={() => p && engine.current?.hover(p.id)}
                  onPointerLeave={() => engine.current?.hover(null)}
                  onFocus={() => p && engine.current?.hover(p.id)}
                  onBlur={() => engine.current?.hover(null)}
                  className="group block w-full text-left disabled:cursor-default focus-visible:outline-none"
                >
                  <span className={cn('relative block aspect-[4/3] overflow-hidden bg-raised', on ? 'shadow-[0_0_0_1px_var(--nc-champagne)]' : 'group-focus-visible:shadow-[0_0_0_1px_var(--nc-champagne)]')}>
                    <img src={f.thumb} alt={f.caption || placeName(f)} loading="lazy" className={cn('h-full w-full object-cover transition-[filter,opacity] duration-200', p ? 'group-hover:brightness-110' : 'opacity-50')} />
                  </span>
                  <span className={cn('mt-2 block truncate text-[14px]', p ? 'text-ink' : 'text-ink-muted')}>{placeName(f)}</span>
                  <span className="mt-1 block truncate text-[13px] tabular-nums text-ink-dim">
                    {[when(f.takenAt), p ? (p.sure ? placeLine(p) : 'Held back') : f.zoneName].filter(Boolean).join(' · ') || ' '}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </DeskFrame>
  )
}
