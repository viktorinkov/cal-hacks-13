import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  blankRegistration,
  clearRegistrations,
  getRegistration,
  getSavedRegistration,
  saveRegistration,
} from '@/cover/registry'

const KEY = 'bandit.cover'

beforeEach(clearRegistrations)
afterEach(clearRegistrations)

describe('registration browser storage', () => {
  it('persists only typed contact details, mock card fields and tap accounting', () => {
    saveRegistration({
      ...blankRegistration('band-01'),
      name: 'Alex',
      email: 'alex@example.test',
      emergencyName: 'Sam',
      emergencyPhone: '415-555-0123',
      cardBrand: 'Visa',
      last4: '4242',
      exp: '12/28',
      bloodType: 'A+',
      allergies: 'Extracted allergy',
      conditions: 'Extracted condition',
      medications: 'Extracted medication',
      carrier: 'Extracted insurer',
      memberId: 'Private member ID',
      groupId: 'Private group ID',
      lastChargeCents: 1250,
      lastChargeAt: 1_700_000_000_000,
    })

    expect(JSON.parse(window.localStorage.getItem(KEY)!)).toEqual([{
      bandId: 'band-01',
      name: 'Alex',
      email: 'alex@example.test',
      emergencyName: 'Sam',
      emergencyPhone: '415-555-0123',
      cardBrand: 'Visa',
      last4: '4242',
      exp: '12/28',
      lastChargeCents: 1250,
      lastChargeAt: 1_700_000_000_000,
    }])
    expect(getSavedRegistration('band-01')).toMatchObject({
      name: 'Alex',
      bloodType: '',
      allergies: '',
      conditions: '',
      medications: '',
      carrier: '',
      memberId: '',
      groupId: '',
    })
  })

  it('retains demo seeds for floor taps without prefilling signup with them', () => {
    expect(getRegistration('band-05')).toMatchObject({ name: 'Judge D', allergies: 'Penicillin' })
    expect(getSavedRegistration('band-05')).toBeNull()
    expect(blankRegistration('band-05')).toMatchObject({ name: '', carrier: '', groupId: '' })

    saveRegistration({ ...blankRegistration('band-05'), name: 'Alex' })
    expect(getRegistration('band-05')).toMatchObject({ name: 'Alex', allergies: '', carrier: '' })
    clearRegistrations()
    expect(getRegistration('band-05')?.name).toBe('Judge D')
  })

  it('scrubs medical data and unexpected upload fields from every legacy record on read', () => {
    window.localStorage.setItem(KEY, JSON.stringify([
      { ...blankRegistration('band-01'), name: 'Alex', allergies: 'Private allergy', file: { contents: 'private bytes' } },
      { ...blankRegistration('band-02'), memberId: 'Private member ID', medicalCard: { bloodType: 'A+' } },
    ]))

    expect(getSavedRegistration('band-01')).toMatchObject({ name: 'Alex', allergies: '' })
    const raw = window.localStorage.getItem(KEY)!
    expect(raw).not.toMatch(/allergies|memberId|medicalCard|contents|private|Private/)
    expect(JSON.parse(raw)).toHaveLength(2)
  })

  it('removes malformed saved values rather than trusting nested contact data', () => {
    window.localStorage.setItem(KEY, JSON.stringify([
      null,
      { name: 'Missing band' },
      { bandId: 'band-01', name: { document: 'private bytes' }, last4: 1234, lastChargeAt: -1 },
    ]))

    expect(getSavedRegistration('band-01')).toMatchObject({ name: '', last4: '' })
    const stored = JSON.parse(window.localStorage.getItem(KEY)!)
    expect(stored).toHaveLength(1)
    expect(stored[0]).not.toHaveProperty('lastChargeAt')
    expect(window.localStorage.getItem(KEY)).not.toContain('private bytes')
  })

  it.each(['{"file":"private bytes"}', 'invalid JSON'])('removes invalid legacy storage: %s', (raw) => {
    window.localStorage.setItem(KEY, raw)
    expect(getSavedRegistration('band-01')).toBeNull()
    expect(window.localStorage.getItem(KEY)).toBeNull()
  })
})
