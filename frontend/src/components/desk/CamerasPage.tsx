import { useEffect, useRef, useState } from 'react'
import { Camera, Video } from 'lucide-react'
import { DeskFrame } from './DeskFrame'

const FOOTAGE = [
  { id: 'main-hall', name: 'Main hall' },
  { id: 'booth-aisle', name: 'Booth aisle' },
] as const

function cameraError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') return 'Camera access was not allowed. Allow it in your browser, then try again.'
    if (error.name === 'NotFoundError') return 'No camera was found on this laptop.'
    if (error.name === 'NotReadableError') return 'The camera is busy. Close the other app using it, then try again.'
  }
  return 'The camera could not start. Check its connection, then try again.'
}

export function LaptopCamera() {
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const request = useRef(0)
  const [status, setStatus] = useState<'off' | 'starting' | 'live'>('off')
  const [error, setError] = useState('')

  function release() {
    request.current += 1
    stream.current?.getTracks().forEach((track) => { track.onended = null; track.stop() })
    stream.current = null
    if (video.current) video.current.srcObject = null
  }

  useEffect(() => release, [])

  function stop() {
    release()
    setStatus('off')
  }

  async function start() {
    setError('')
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Use a browser with camera access on a secure connection.')
      return
    }
    const ticket = ++request.current
    setStatus('starting')
    try {
      const next = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      // A permission request can finish after the user leaves this page or cancels it.
      if (ticket !== request.current) {
        next.getTracks().forEach((track) => track.stop())
        return
      }
      stream.current = next
      next.getVideoTracks().forEach((track) => { track.onended = stop })
      if (video.current) video.current.srcObject = next
      setStatus('live')
    } catch (failure) {
      if (ticket !== request.current) return
      setStatus('off')
      setError(cameraError(failure))
    }
  }

  return (
    <section aria-label="Laptop camera" className="overflow-hidden rounded-[20px] bg-raised">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div>
          <h2 className="text-[17px] text-ink">Laptop camera</h2>
          <p className="mt-1 text-[13px] text-ink-dim">Local preview on this laptop</p>
        </div>
        <span role="status" className="rounded-full bg-ground px-3 py-1 text-[12px] text-ink">
          {status === 'live' ? 'Live' : status === 'starting' ? 'Waiting for camera' : 'Camera off'}
        </span>
      </div>
      <div className="relative aspect-video bg-black">
        <video ref={video} autoPlay muted playsInline aria-hidden={status !== 'live'} aria-label="Live laptop camera preview" className="h-full w-full object-contain" />
        {status !== 'live' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-4 text-center text-ink-muted">
            <Camera size={32} aria-hidden />
            <p className="text-[14px]">{status === 'starting' ? 'Approve camera access in your browser.' : 'Start the camera to see its live view.'}</p>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-4">
        {status === 'off' ? (
          <button type="button" onClick={() => void start()} className="rounded-full bg-champagne px-4 py-2 text-[13px] text-black">Start camera</button>
        ) : (
          <button type="button" onClick={stop} className="rounded-full bg-ground px-4 py-2 text-[13px] text-ink">{status === 'starting' ? 'Cancel camera request' : 'Stop camera'}</button>
        )}
        <p className="text-[13px] text-ink-dim">Video only · preview stays in this browser</p>
        {error && <p role="alert" className="w-full text-[13px] text-signal">{error}</p>}
      </div>
    </section>
  )
}

export function FootageCamera({ id, name }: { id: string; name: string }) {
  const [local, setLocal] = useState<{ url: string; name: string } | null>(null)
  const [failed, setFailed] = useState(false)
  const [playing, setPlaying] = useState(false)
  const source = local?.url ?? `${import.meta.env.BASE_URL}camera-footage/${id}.mp4`

  useEffect(() => () => { if (local) URL.revokeObjectURL(local.url) }, [local])

  function selectFile(file?: File) {
    if (!file) return
    setFailed(false)
    setPlaying(false)
    setLocal({ url: URL.createObjectURL(file), name: file.name })
  }

  function reset() {
    setFailed(false)
    setPlaying(false)
    setLocal(null)
  }

  return (
    <section aria-label={`${name} footage`} className="overflow-hidden rounded-[20px] bg-raised">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div>
          <h2 className="text-[17px] text-ink">{name}</h2>
          <p className="mt-1 text-[13px] text-ink-dim">Recorded venue footage</p>
        </div>
        <span className="rounded-full bg-ground px-3 py-1 text-[12px] text-ink">
          {failed ? 'Video unavailable' : playing ? 'Video · looping' : 'Video · paused'}
        </span>
      </div>
      <div className="relative aspect-video bg-black">
        <video key={source} src={source} controls autoPlay muted loop playsInline preload="metadata" aria-label={`${name} recorded video`} className="h-full w-full object-contain"
          onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onError={() => { setFailed(true); setPlaying(false) }} />
        {failed && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 px-4 text-center text-ink-muted">
            <Video size={28} aria-hidden />
            <p role="alert" className="text-[14px]">This video could not load. Choose a playable video below.</p>
          </div>
        )}
      </div>
      <div className="space-y-3 px-5 py-4">
        <p className="truncate text-[13px] text-ink-dim" title={local?.name}>{local ? `Local file: ${local.name}` : 'Venue recording'} · not a live feed</p>
        <label className="flex flex-wrap items-center gap-3 text-[13px] text-ink">
          <span>Choose video for {name}</span>
          <input type="file" accept="video/*" aria-label={`Choose video for ${name}`} className="min-w-0 max-w-full text-[12px] text-ink-dim file:mr-3 file:rounded-full file:border-0 file:bg-ground file:px-3 file:py-2 file:text-ink" onChange={(event) => { selectFile(event.target.files?.[0]); event.target.value = '' }} />
        </label>
        {local && <button type="button" onClick={reset} className="text-[13px] text-ink underline underline-offset-4">Restore venue recording</button>}
      </div>
    </section>
  )
}

export function CamerasPage() {
  return (
    <DeskFrame motif="cameras" title="Live cameras" sentence="A live view from this laptop, with venue recordings alongside it.">
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        <LaptopCamera />
        {FOOTAGE.map((camera) => <FootageCamera key={camera.id} {...camera} />)}
      </div>
    </DeskFrame>
  )
}
