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

function readStored(): Registration[] {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is Registration => !!item && typeof item === 'object' && typeof (item as Registration).bandId === 'string')
  } catch {
    return []
  }
}

export function getRegistration(bandId: string): Registration | null {
  const stored = readStored().find((item) => item.bandId === bandId)
  if (stored) return stored
  return SEEDS.find((item) => item.bandId === bandId) ?? null
}

export function saveRegistration(registration: Registration) {
  const next = readStored().filter((item) => item.bandId !== registration.bandId)
  next.push(registration)
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
    carrier: 'Northline',
    memberId: '',
    groupId: 'NL-MAIN',
    cardBrand: 'Visa',
    last4: '',
    exp: '',
  }
}
