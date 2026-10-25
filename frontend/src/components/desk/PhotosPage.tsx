import { useState } from 'react'
import { useCatalog, type Photo } from '@/stdb/catalog'
import { DeskFrame, Figure, when } from './DeskFrame'

/** Event photographs, framed like the rest of the desk. People in a frame are named underneath. */
export function PhotosPage() {
  const photos = useCatalog((s) => s.photos)
  const [open, setOpen] = useState<Photo | null>(null)
  const named = photos.filter((photo) => photo.people.length > 0).length

  return (
    <DeskFrame
      title={photos.length ? `${photos.length.toLocaleString('en-US')} photographs.` : 'No photographs yet.'}
      sentence="Frames from the event. A name under a picture is someone the desk already knows."
      figures={
        <>
          <Figure lead label="Frames" value={photos.length.toLocaleString('en-US')} note="in the album" />
          <Figure label="With names" value={String(named)} note="someone identified" />
          <Figure label="Captioned" value={String(photos.filter((photo) => photo.caption).length)} note="have a line of text" />
          <Figure label="Placed" value={String(photos.filter((photo) => photo.zoneName).length)} note="tied to a zone" />
        </>
      }
    >
      {photos.length === 0 ? (
        <p className="text-[15px] text-ink-dim">Nothing has been taken yet.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-3 xl:grid-cols-4">
          {photos.map((photo) => (
            <li key={photo.id}>
              <button type="button" onClick={() => setOpen(photo)} className="block w-full text-left">
                <span className="block aspect-[4/5] overflow-hidden bg-raised">
                  {photo.url && <img src={photo.url} alt={photo.caption || 'Event photograph'} className="h-full w-full object-cover" />}
                </span>
                <span className="mt-2 block truncate text-[14px] text-ink">{photo.caption || photo.people[0] || 'Untitled'}</span>
                <span className="mt-1 block truncate text-[13px] text-ink-dim">
                  {[photo.zoneName, when(photo.takenAt)].filter(Boolean).join(' · ') || 'No place recorded'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <div className="fixed inset-0 z-30 grid place-items-center bg-[rgba(10,10,11,0.86)] px-6" role="dialog" aria-modal="true" aria-label={open.caption || 'Photograph'}>
          <button type="button" className="absolute inset-0" aria-label="Close the photograph" onClick={() => setOpen(null)} />
          <figure className="relative z-10 w-full max-w-3xl">
            {open.url && <img src={open.url} alt={open.caption || 'Event photograph'} className="max-h-[70vh] w-full object-contain" />}
            <figcaption className="mt-4">
              <p className="font-display text-[28px] leading-none text-ink">{open.caption || 'Untitled'}</p>
              <p className="mt-2 text-[14px] text-ink-dim">{[open.zoneName, when(open.takenAt), open.people.join(', ')].filter(Boolean).join(' · ')}</p>
            </figcaption>
          </figure>
        </div>
      )}
    </DeskFrame>
  )
}
