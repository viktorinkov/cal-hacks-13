import { useEffect, useState } from 'react'
import type { Photo } from '@/stdb/catalog'

export const PLACES_URL = '/venue/place/places.json'

export interface Scan {
  full: string
  roofless: string
  matrix: number[]
  metre: number
}

export interface PlacedBand {
  band: number
  xz: [number, number]
  r: number
  role: 'in photo' | 'photographer' | 'maybe' | 'not in view'
}

export interface PlacedPhoto {
  id: string
  sha256: string
  image: string
  thumb: string
  taken: string | null
  size: [number, number]
  focal: number
  c2w: number[][]
  sure: boolean
  points: number
  error: number
  by: string | null
  byM: number | null
  area: string | null
  facing: string | null
  facingM: number | null
  heading: number
  sendTo: number[]
  photographer: number | null
  testBands: boolean
  bands: PlacedBand[]
}

interface Unplaced {
  id: string
  sha256: string
  image: string
  thumb: string
  taken: string | null
}

interface Places {
  scan: Scan
  photos: PlacedPhoto[]
  unplaced: Unplaced[]
}

export interface Frame {
  id: string
  image: string
  thumb: string
  takenAt: number
  caption: string
  people: string[]
  zoneName: string
  place: PlacedPhoto | null
}

export function usePlaces(): { places: Places | null; missing: boolean } {
  const [places, setPlaces] = useState<Places | null>(null)
  const [missing, setMissing] = useState(false)
  useEffect(() => {
    let alive = true
    fetch(PLACES_URL)
      .then((r) => (r.ok ? (r.json() as Promise<Places>) : Promise.reject(new Error(String(r.status)))))
      .then((data) => alive && setPlaces(data))
      .catch(() => alive && setMissing(true))
    return () => {
      alive = false
    }
  }, [])
  return { places, missing }
}

const shaOf = (url: string) => url.match(/\/blobs\/([0-9a-f]{64})/)?.[1] ?? ''
const msOf = (iso: string | null) => (iso ? Date.parse(iso) : 0)

export function frames(album: Photo[], places: Places | null): Frame[] {
  const placed = new Map((places?.photos ?? []).map((p) => [p.sha256, p]))
  const seen = new Set<string>()
  const out: Frame[] = album.map((photo) => {
    const place = placed.get(shaOf(photo.url)) ?? null
    if (place) seen.add(place.sha256)
    return { id: photo.id, image: photo.url, thumb: photo.url, takenAt: photo.takenAt, caption: photo.caption, people: photo.people, zoneName: photo.zoneName, place }
  })
  for (const p of places?.photos ?? []) {
    if (!seen.has(p.sha256)) out.push({ id: p.id, image: p.image, thumb: p.thumb, takenAt: msOf(p.taken), caption: '', people: [], zoneName: '', place: p })
  }
  for (const p of places?.unplaced ?? []) {
    if (!album.some((photo) => shaOf(photo.url) === p.sha256)) {
      out.push({ id: p.id, image: p.image, thumb: p.thumb, takenAt: msOf(p.taken), caption: '', people: [], zoneName: '', place: null })
    }
  }
  return out.sort((a, b) => a.takenAt - b.takenAt)
}

export function placeTitle(p: PlacedPhoto): string {
  return p.by && p.byM != null && p.byM <= 6 ? p.by : p.area || p.by || 'The hall'
}

export function placeName(frame: Frame): string {
  return frame.caption || (frame.place ? placeTitle(frame.place) : 'Not found in the scan')
}

export function placeLine(p: PlacedPhoto): string {
  const title = placeTitle(p)
  const parts = [p.area && p.area !== title ? p.area : null, p.facing && p.facing !== title ? `facing ${p.facing}` : null]
  return parts.filter(Boolean).join(' · ')
}
