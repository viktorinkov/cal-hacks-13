import { useMemo, useSyncExternalStore } from 'react'
import { isViewing } from '@/stdb/viewing'

/**
 * What this phone remembers about a band: the wearer's name and where merch should ship.
 * The name is also sent to the database at registration; the address pre-fills merch orders.
 */
export interface Registration {
  bandId: string
  name: string
  street: string
  unit: string
  city: string
  region: string
  postalCode: string
  country: string
}

const KEY = 'bandit.cover'

let revision = 0
const listeners = new Set<() => void>()

function emit() {
  revision += 1
  for (const listener of listeners) listener()
}

export function subscribeCover(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getCoverRevision() {
  return revision
}

function storedRegistration(value: unknown): Registration | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  if (typeof item.bandId !== 'string' || !item.bandId) return null
  const stringField = (key: string) => typeof item[key] === 'string' ? item[key] : ''
  return {
    bandId: item.bandId,
    name: stringField('name'),
    street: stringField('street'),
    unit: stringField('unit'),
    city: stringField('city'),
    region: stringField('region'),
    postalCode: stringField('postalCode'),
    country: stringField('country'),
  }
}

function readStored(): Registration[] {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return []
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      window.localStorage.removeItem(KEY)
      return []
    }
    if (!Array.isArray(parsed)) {
      window.localStorage.removeItem(KEY)
      return []
    }
    const registrations = parsed.map(storedRegistration).filter((item) => item !== null)
    const sanitized = JSON.stringify(registrations)
    // Remove fields older versions of the form saved here.
    if (raw !== sanitized) window.localStorage.setItem(KEY, sanitized)
    return registrations
  } catch {
    return []
  }
}

/** The address this phone saved for a band, if any. */
export function getSavedRegistration(bandId: string): Registration | null {
  if (isViewing()) return null
  const stored = readStored().find((item) => item.bandId === bandId)
  return stored ? { ...blankRegistration(bandId), ...stored } : null
}

export function saveRegistration(registration: Registration) {
  const next = readStored().filter((item) => item.bandId !== registration.bandId)
  const stored = storedRegistration(registration)
  if (!stored) return
  next.push(stored)
  window.localStorage.setItem(KEY, JSON.stringify(next))
  emit()
}

export function clearRegistrations() {
  window.localStorage.removeItem(KEY)
  emit()
}

export function useRegistration(bandId: string | null): Registration | null {
  const revisionNow = useSyncExternalStore(subscribeCover, getCoverRevision, getCoverRevision)
  return useMemo(() => (bandId ? getSavedRegistration(bandId) : null), [bandId, revisionNow])
}

export function blankRegistration(bandId: string): Registration {
  return {
    bandId,
    name: '',
    street: '',
    unit: '',
    city: '',
    region: '',
    postalCode: '',
    country: 'United States',
  }
}
