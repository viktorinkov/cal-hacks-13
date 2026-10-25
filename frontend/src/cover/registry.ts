import { useMemo, useSyncExternalStore } from 'react'

/**
 * What a tap reads. Seeds cover the demo bands that appear in tonight's claims.
 * Anything saved in this browser replaces the seed for that band.
 */
export interface Registration {
  bandId: string
  name: string
  email: string
  bloodType: string
  allergies: string
  conditions: string
  medications: string
  emergencyName: string
  emergencyPhone: string
  street: string
  unit: string
  city: string
  region: string
  postalCode: string
  country: string
  carrier: string
  memberId: string
  groupId: string
  cardBrand: string
  last4: string
  exp: string
  lastChargeCents?: number
  lastChargeAt?: number
}

const KEY = 'bandit.cover'

type StoredRegistration = Pick<Registration,
  | 'bandId'
  | 'name'
  | 'email'
  | 'emergencyName'
  | 'emergencyPhone'
  | 'street'
  | 'unit'
  | 'city'
  | 'region'
  | 'postalCode'
  | 'country'
  | 'cardBrand'
  | 'last4'
  | 'exp'
  | 'lastChargeCents'
  | 'lastChargeAt'
>

const SEEDS: readonly Registration[] = [
  {
    bandId: 'band-02',
    name: 'Judge B',
    email: 'judge.b@mainstage.test',
    bloodType: 'A+',
    allergies: 'Peanuts',
    conditions: 'None',
    medications: 'None',
    emergencyName: 'Sam Ito',
    emergencyPhone: '415-555-0148',
    street: '',
    unit: '',
    city: '',
    region: '',
    postalCode: '',
    country: 'United States',
    carrier: 'Northline',
    memberId: 'NL-44002',
    groupId: 'NL-MAIN',
    cardBrand: 'Visa',
    last4: '1881',
    exp: '09/28',
  },
  {
    bandId: 'band-04',
    name: 'Judge C',
    email: 'judge.c@mainstage.test',
    bloodType: 'O+',
    allergies: 'None',
    conditions: 'Asthma',
    medications: 'Albuterol inhaler',
    emergencyName: 'Priya Shah',
    emergencyPhone: '415-555-0174',
    street: '',
    unit: '',
    city: '',
    region: '',
    postalCode: '',
    country: 'United States',
    carrier: 'Northline',
    memberId: 'NL-44004',
    groupId: 'NL-MAIN',
    cardBrand: 'Mastercard',
    last4: '5520',
    exp: '11/27',
  },
  {
    bandId: 'band-05',
    name: 'Judge D',
    email: 'judge.d@mainstage.test',
    bloodType: 'B+',
    allergies: 'Penicillin',
    conditions: 'None',
    medications: 'None',
    emergencyName: 'Elena Vasquez',
    emergencyPhone: '415-555-0190',
    street: '',
    unit: '',
    city: '',
    region: '',
    postalCode: '',
    country: 'United States',
    carrier: 'Northline',
    memberId: 'NL-44005',
    groupId: 'NL-MAIN',
    cardBrand: 'Visa',
    last4: '9033',
    exp: '04/29',
  },
  {
    bandId: 'band-06',
    name: 'Judge E',
    email: 'judge.e@mainstage.test',
    bloodType: 'O-',
    allergies: 'None',
    conditions: 'None',
    medications: 'None',
    emergencyName: 'Chris Dalton',
    emergencyPhone: '415-555-0116',
    street: '',
    unit: '',
    city: '',
    region: '',
    postalCode: '',
    country: 'United States',
    carrier: 'Northline',
    memberId: 'NL-44006',
    groupId: 'NL-MAIN',
    cardBrand: 'Mastercard',
    last4: '4416',
    exp: '02/28',
  },
]

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

/** Browser storage is only for typed contact details and the mock card. */
function storedRegistration(value: unknown): StoredRegistration | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  if (typeof item.bandId !== 'string' || !item.bandId) return null
  const stringField = (key: string) => typeof item[key] === 'string' ? item[key] : ''
  const next: StoredRegistration = {
    bandId: item.bandId,
    name: stringField('name'),
    email: stringField('email'),
    emergencyName: stringField('emergencyName'),
    emergencyPhone: stringField('emergencyPhone'),
    street: stringField('street'),
    unit: stringField('unit'),
    city: stringField('city'),
    region: stringField('region'),
    postalCode: stringField('postalCode'),
    country: stringField('country'),
    cardBrand: stringField('cardBrand'),
    last4: stringField('last4'),
    exp: stringField('exp'),
  }
  for (const key of ['lastChargeCents', 'lastChargeAt'] as const) {
    const amount = item[key]
    if (typeof amount === 'number' && Number.isSafeInteger(amount) && amount >= 0) {
      next[key] = amount
    }
  }
  return next
}

function readStored(): StoredRegistration[] {
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
    // Also remove medical/insurance fields written by older versions of the form.
    if (raw !== sanitized) window.localStorage.setItem(KEY, sanitized)
    return registrations
  } catch {
    return []
  }
}

/** For the signup form: an unsaved band must never inherit a demo identity. */
export function getSavedRegistration(bandId: string): Registration | null {
  const stored = readStored().find((item) => item.bandId === bandId)
  return stored ? { ...blankRegistration(bandId), ...stored } : null
}

export function getRegistration(bandId: string): Registration | null {
  return getSavedRegistration(bandId) ?? SEEDS.find((item) => item.bandId === bandId) ?? null
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
  return useMemo(() => (bandId ? getRegistration(bandId) : null), [bandId, revisionNow])
}

export function blankRegistration(bandId: string): Registration {
  return {
    bandId,
    name: '',
    email: '',
    bloodType: '',
    allergies: '',
    conditions: '',
    medications: '',
    emergencyName: '',
    emergencyPhone: '',
    street: '',
    unit: '',
    city: '',
    region: '',
    postalCode: '',
    country: 'United States',
    carrier: '',
    memberId: '',
    groupId: '',
    cardBrand: 'Visa',
    last4: '',
    exp: '',
  }
}
