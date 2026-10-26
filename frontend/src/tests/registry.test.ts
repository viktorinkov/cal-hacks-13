import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  blankRegistration,
  clearRegistrations,
  getSavedRegistration,
  saveRegistration,
} from '@/cover/registry'

const KEY = 'bandit.cover'

beforeEach(clearRegistrations)
afterEach(clearRegistrations)

describe('registration browser storage', () => {
  it('persists only the name and shipping details the phone can use again', () => {
    saveRegistration({
      ...blankRegistration('band-01'),
      name: 'Alex',
      street: '1 Market St',
      unit: 'Floor 4',
      city: 'San Francisco',
      region: 'CA',
      postalCode: '94107',
      country: 'United States',
    })

    expect(JSON.parse(window.localStorage.getItem(KEY)!)).toEqual([{
      bandId: 'band-01',
      name: 'Alex',
      street: '1 Market St',
      unit: 'Floor 4',
      city: 'San Francisco',
      region: 'CA',
      postalCode: '94107',
      country: 'United States',
    }])
    expect(getSavedRegistration('band-01')).toMatchObject({
      name: 'Alex',
      street: '1 Market St',
      city: 'San Francisco',
      postalCode: '94107',
    })
  })

  it('starts every band empty: no seeded identity ever comes back', () => {
    expect(getSavedRegistration('band-05')).toBeNull()
    expect(blankRegistration('band-05')).toMatchObject({ name: '', street: '', postalCode: '' })

    saveRegistration({ ...blankRegistration('band-05'), name: 'Alex' })
    expect(getSavedRegistration('band-05')).toMatchObject({ name: 'Alex' })
    clearRegistrations()
    expect(getSavedRegistration('band-05')).toBeNull()
  })

  it('scrubs card, medical and unexpected fields from every legacy record on read', () => {
    window.localStorage.setItem(KEY, JSON.stringify([
      { bandId: 'band-01', name: 'Alex', allergies: 'Private allergy', file: { contents: 'private bytes' } },
      { bandId: 'band-02', memberId: 'Private member ID', medicalCard: { bloodType: 'A+' }, last4: '4242' },
    ]))

    expect(getSavedRegistration('band-01')).toMatchObject({ name: 'Alex' })
    const raw = window.localStorage.getItem(KEY)!
    expect(raw).not.toMatch(/allergies|memberId|medicalCard|last4|contents|private|Private/)
    expect(JSON.parse(raw)).toHaveLength(2)
  })

  it('removes malformed saved values rather than trusting nested contact data', () => {
    window.localStorage.setItem(KEY, JSON.stringify([
      null,
      { name: 'Missing band' },
      { bandId: 'band-01', name: { document: 'private bytes' }, last4: 1234 },
    ]))

    expect(getSavedRegistration('band-01')).toMatchObject({ name: '' })
    const stored = JSON.parse(window.localStorage.getItem(KEY)!)
    expect(stored).toHaveLength(1)
    expect(stored[0]).not.toHaveProperty('last4')
    expect(window.localStorage.getItem(KEY)).not.toContain('private bytes')
  })

  it.each(['{"file":"private bytes"}', 'invalid JSON'])('removes invalid legacy storage: %s', (raw) => {
    window.localStorage.setItem(KEY, raw)
    expect(getSavedRegistration('band-01')).toBeNull()
    expect(window.localStorage.getItem(KEY)).toBeNull()
  })
})
