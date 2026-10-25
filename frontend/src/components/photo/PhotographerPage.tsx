import { isViewing } from '@/stdb/viewing'
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { useRoute } from '@/cover/route'
import { useCatalog } from '@/stdb/catalog'
import { fileFrame, useSession } from '@/stdb/session'
import { validatePhotoFile } from '@/stdb/uploads'
import { when } from '@/components/desk/DeskFrame'
import './frames.css'

type Tab = 'waiting' | 'desk'

interface LocalFrame {
  key: string
  file: File
  preview: string
  caption: string
  zoneId: string
  takenAt: number
  status: 'waiting' | 'sending' | 'sent' | 'failed'
  error: string
  url: string
}

function previewFor(file: File): string {
  if (typeof URL.createObjectURL !== 'function') return ''
  return URL.createObjectURL(file)
}

function roleLabel(roles: string[], owner: boolean): string {
  if (roles.includes('photographer')) return 'Photographer'
  if (owner || roles.includes('ops')) return 'Organizer'
  if (roles.includes('ingest')) return 'Ingest'
  return 'Guest'
}

/** File event frames. Each one is registered in a zone and then read by the organizer photos page. */
export function PhotographerPage() {
  const { go } = useRoute()
  const phase = useSession((s) => s.phase)
  const roles = useSession((s) => s.roles)
  const owner = useSession((s) => s.owner)
  const zones = useCatalog((s) => s.zones)
  const desk = useCatalog((s) => s.photos)
  const input = useRef<HTMLInputElement>(null)
  const [frames, setFrames] = useState<LocalFrame[]>([])
  const [tab, setTab] = useState<Tab>(isViewing() ? 'desk' : 'waiting')
  const [query, setQuery] = useState('')
  const [notice, setNotice] = useState('')
  const [dragging, setDragging] = useState(false)
  const [menu, setMenu] = useState(false)
  const [sending, setSending] = useState(false)
  const framesRef = useRef(frames)
  framesRef.current = frames

  const orderedZones = useMemo(
    () => [...zones].sort((a, b) => a.stationId - b.stationId || a.name.localeCompare(b.name)),
    [zones],
  )
  const defaultZone = orderedZones[0]?.id ?? ''

  useEffect(() => {
    if (!defaultZone) return
    setFrames((current) => current.map((frame) => (frame.zoneId ? frame : { ...frame, zoneId: defaultZone })))
  }, [defaultZone])

  useEffect(() => {
    const urls = new Set(desk.map((photo) => photo.url))
    setFrames((current) => {
      const stale = current.filter((frame) => frame.status === 'sent' && frame.url && urls.has(frame.url))
      for (const frame of stale) {
        if (frame.preview.startsWith('blob:')) URL.revokeObjectURL(frame.preview)
      }
      return stale.length ? current.filter((frame) => !stale.includes(frame)) : current
    })
  }, [desk])

  useEffect(() => () => {
    for (const frame of framesRef.current) {
      if (frame.preview.startsWith('blob:')) URL.revokeObjectURL(frame.preview)
    }
  }, [])

  const waiting = frames.filter((frame) => frame.status !== 'sent')
  const deskUrls = new Set(desk.map((photo) => photo.url))
  const justSent = frames.filter((frame) => frame.status === 'sent' && frame.url && !deskUrls.has(frame.url))
  const needle = query.trim().toLowerCase()
  const waitingShown = waiting.filter((frame) => {
    if (!needle) return true
    const zone = orderedZones.find((item) => item.id === frame.zoneId)?.name ?? ''
    return `${frame.file.name} ${frame.caption} ${zone}`.toLowerCase().includes(needle)
  })
  const deskShown = [
    ...justSent.map((frame) => ({
      id: frame.key,
      url: frame.preview || frame.url,
      caption: frame.caption,
      zoneName: orderedZones.find((item) => item.id === frame.zoneId)?.name ?? '',
      takenAt: frame.takenAt,
      people: [] as string[],
      local: true,
    })),
    ...desk.map((photo) => ({ ...photo, local: false })),
  ].filter((photo) => {
    if (!needle) return true
    return `${photo.caption} ${photo.zoneName} ${photo.people.join(' ')}`.toLowerCase().includes(needle)
  })

  const shown = tab === 'waiting' ? waitingShown : deskShown
  const block = phase !== 'live' ? 'The venue is still opening.' : orderedZones.length === 0 ? 'Zones have not loaded yet.' : ''
  const toolNote = needle || tab === 'desk' ? `${shown.length} frames` : 'Newest first'

  function addFiles(list: Iterable<File>) {
    const next: LocalFrame[] = []
    const skipped: string[] = []
    for (const file of list) {
      const invalid = validatePhotoFile(file)
      if (invalid) {
        skipped.push(`${file.name}: ${invalid}`)
        continue
      }
      next.push({
        key: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
        file,
        preview: previewFor(file),
        caption: '',
        zoneId: defaultZone,
        takenAt: file.lastModified || Date.now(),
        status: 'waiting',
        error: '',
        url: '',
      })
    }
    if (next.length) {
      setFrames((current) => [...next, ...current])
      setTab('waiting')
    }
    setNotice(skipped.length ? skipped[0] : '')
  }

  function removeFrame(key: string) {
    setFrames((current) => {
      const frame = current.find((item) => item.key === key)
      if (frame?.preview.startsWith('blob:')) URL.revokeObjectURL(frame.preview)
      return current.filter((item) => item.key !== key)
    })
  }

  async function send() {
    const batch = frames.filter((frame) => frame.status === 'waiting' || frame.status === 'failed')
    if (!batch.length || sending || block) return
    setSending(true)
    let failed = false
    for (const frame of batch) {
      setFrames((current) => current.map((item) => (item.key === frame.key ? { ...item, status: 'sending', error: '' } : item)))
      try {
        const url = await fileFrame(frame.file, frame.zoneId, frame.takenAt, frame.caption)
        setFrames((current) => current.map((item) => (item.key === frame.key ? { ...item, status: 'sent', url, error: '' } : item)))
      } catch (error) {
        failed = true
        const message = error instanceof Error ? error.message : 'This frame did not land.'
        setFrames((current) => current.map((item) => (item.key === frame.key ? { ...item, status: 'failed', error: message } : item)))
      }
    }
    setSending(false)
    if (!failed) setTab('desk')
  }

  function onDragOver(event: DragEvent) {
    if (![...event.dataTransfer.types].includes('Files')) return
    event.preventDefault()
    setDragging(true)
  }

  return (
    <div className="frames" onDragOver={onDragOver} onDragLeave={() => setDragging(false)} onDrop={(event) => {
      event.preventDefault()
      setDragging(false)
      addFiles(event.dataTransfer.files)
    }}>
      <header className="frames-bar">
        <div className="frames-col frames-bar-inner">
          <button type="button" className="frames-mark" onClick={() => go('/photo')}>BandIt</button>
          <nav className="frames-nav" aria-label="Photographer">
            <button type="button" aria-current="page">Frames</button>
            <button type="button" onClick={() => go('/photos')}>Photos</button>
            <button type="button" onClick={() => go('/')}>Map</button>
          </nav>
          <span className="frames-who">{roleLabel(roles, owner)}</span>
          <button type="button" className="frames-menu" aria-expanded={menu} aria-label="Menu" onClick={() => setMenu(true)}>Menu</button>
        </div>
      </header>
      {menu && (
        <div className="frames-sheet" role="dialog" aria-label="Menu">
          <button type="button" onClick={() => setMenu(false)}>Close</button>
          <button type="button" onClick={() => { setMenu(false); go('/photo') }}>Frames</button>
          <button type="button" onClick={() => { setMenu(false); go('/photos') }}>Photos</button>
          <button type="button" onClick={() => { setMenu(false); go('/') }}>Map</button>
        </div>
      )}
      <main className="frames-col">
        <div className="frames-title">
          <div>
            <h1>Frames</h1>
            <p className="frames-lead">
              <span className={waiting.length ? 'frames-figure' : 'frames-figure is-zero'}>{waiting.length}</span>
              waiting to land on the photos page.
            </p>
          </div>
          <div>
            <div className="frames-actions">
              <button type="button" className="frames-secondary" onClick={() => input.current?.click()}>Add frames</button>
              <button type="button" className="frames-primary" disabled={sending || waiting.length === 0 || Boolean(block)} onClick={() => void send()}>
                {sending ? 'Sending' : 'Send to the desk'}
              </button>
            </div>
            {waiting.length > 0 && block && <p className="frames-block">{block}</p>}
          </div>
        </div>
        <input
          ref={input}
          className="frames-file"
          type="file"
          accept="image/*"
          multiple
          aria-label="Choose frames"
          onChange={(event) => {
            addFiles(event.target.files ?? [])
            event.target.value = ''
          }}
        />
        <div className="frames-tabs" role="tablist" aria-label="Frames">
          <button type="button" role="tab" aria-selected={tab === 'waiting'} onClick={() => setTab('waiting')}>Waiting</button>
          <button type="button" role="tab" aria-selected={tab === 'desk'} onClick={() => setTab('desk')}>On the desk</button>
        </div>
        <div className="frames-tool">
          <input className="frames-search" type="search" value={query} aria-label="Search frames" placeholder="Search frames" onChange={(event) => setQuery(event.target.value)} />
          <p className="frames-tool-note">{toolNote}</p>
        </div>
        {notice && <p className="frames-notice">{notice}</p>}
        {tab === 'waiting' && waitingShown.length > 0 && (
          <div className="frame-head" aria-hidden="true">
            <span />
            <span>Caption</span>
            <span>Zone</span>
            <span className="is-end">Taken</span>
            <span />
          </div>
        )}
        {tab === 'desk' && deskShown.length > 0 && (
          <div className="frame-head is-desk" aria-hidden="true">
            <span />
            <span>Caption</span>
            <span>Zone</span>
            <span className="is-end">Taken</span>
          </div>
        )}
        {tab === 'waiting' && waitingShown.map((frame) => (
          <article className="frame-row" key={frame.key}>
            {frame.preview ? <img className="frame-thumb" src={frame.preview} alt={frame.caption || frame.file.name} /> : <span className="frame-thumb" />}
            <div className="frame-caption">
              <input
                aria-label={`Caption for ${frame.file.name}`}
                value={frame.caption}
                maxLength={140}
                disabled={frame.status === 'sending'}
                onChange={(event) => setFrames((current) => current.map((item) => (item.key === frame.key ? { ...item, caption: event.target.value } : item)))}
              />
              {frame.status === 'sending' && <p className="frame-sub">Sending</p>}
              {frame.status === 'failed' && (
                <>
                  <p className="frames-pill">Failed</p>
                  <p className="frame-sub">{frame.error}</p>
                </>
              )}
            </div>
            <div className="frame-meta">
              <div className="frame-zone">
                <select
                  aria-label={`Zone for ${frame.file.name}`}
                  value={frame.zoneId}
                  disabled={frame.status === 'sending' || orderedZones.length === 0}
                  onChange={(event) => setFrames((current) => current.map((item) => (item.key === frame.key ? { ...item, zoneId: event.target.value } : item)))}
                >
                  {orderedZones.length === 0 && <option value="">No zone yet</option>}
                  {orderedZones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}
                </select>
              </div>
              <time className="frame-taken" dateTime={new Date(frame.takenAt).toISOString()}>{when(frame.takenAt) || '—'}</time>
            </div>
            <button type="button" className="frame-remove" disabled={frame.status === 'sending'} onClick={() => removeFrame(frame.key)}>Remove</button>
          </article>
        ))}
        {tab === 'desk' && deskShown.map((photo) => (
          <article className="frame-row is-desk" key={photo.id}>
            {photo.url ? <img className="frame-thumb" src={photo.url} alt={photo.caption || 'Event frame'} /> : <span className="frame-thumb" />}
            <div className="frame-caption">
              <p className="frame-name">{photo.caption || 'Untitled'}</p>
              {photo.people.length > 0 && <p className="frame-sub">{photo.people.join(', ')}</p>}
            </div>
            <div className="frame-meta">
              <p className="frame-name">{photo.zoneName || '—'}</p>
              <time className="frame-taken" dateTime={photo.takenAt ? new Date(photo.takenAt).toISOString() : undefined}>{when(photo.takenAt) || '—'}</time>
            </div>
          </article>
        ))}
        {shown.length === 0 && (
          tab === 'waiting' && !needle ? (
            <button type="button" className="frames-well" onClick={() => input.current?.click()}>
              {dragging ? 'Drop to add these frames.' : 'Drop the frames from this set.'}
            </button>
          ) : (
            <p className="frames-empty">
              {needle ? 'No frames match that.' : 'Nothing has landed on the photos page yet.'}
            </p>
          )
        )}
      </main>
    </div>
  )
}
