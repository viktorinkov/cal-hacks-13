/** The sentences the recap reads off a person: where you overlapped, and why they are on the page. */

import { clock } from './night'

export interface Interest {
  name: string
  minutes: number
  yourMinutes: number
  shared: boolean
}

export interface Similar {
  yourBooth: string
  theirBooth: string
  topic: string
}

export function mins(minutes: number): string {
  return `${Math.max(1, Math.round(minutes))} min`
}

function and(names: string[]): string {
  if (names.length < 2) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

function firstName(name: string): string {
  return name.split(' ')[0] || name
}

export function boothPhrase(names: string[]): string {
  const cleaned = names.map((name) => name.replace(/\s+booth$/i, ''))
  return `the ${and(cleaned)} booth${names.length > 1 ? 's' : ''}`
}

/**
 * Why this person is on the recap. Shared booths first, then the closest pair by meaning,
 * then the place you already named (`place` is false when there is none).
 */
export function whyLine(
  person: { name: string; interests: Interest[]; similar: Similar | null },
  neverMet: boolean,
  place: string | false,
): string | null {
  const shared = person.interests.filter((item) => item.shared)
  const end = neverMet ? ' but never met' : ''
  if (shared.length === 1) {
    const interest = shared[0]
    return `You both hung out at ${boothPhrase([interest.name])} (${mins(interest.yourMinutes)} you, ${mins(interest.minutes)} ${firstName(person.name)})${end}`
  }
  if (shared.length > 1) return `You both hung out at ${boothPhrase(shared.slice(0, 3).map((item) => item.name))}${end}`
  if (person.similar) {
    const similar = person.similar
    const pair = `you stood at ${similar.yourBooth}, ${firstName(person.name)} at ${similar.theirBooth}`
    const topic = /^[A-Z0-9]+$/.test(similar.topic) ? similar.topic : similar.topic.toLowerCase()
    return topic ? `You're both into ${topic}: ${pair}` : `Close interests: ${pair}`
  }
  return place || null
}

export function howYouMet(person: {
  minutes: number
  metAt: number
  metZone: string
  interests: Interest[]
  photosTogether: number
}, said: boolean): string {
  const minutes = Math.round(person.minutes)
  const shared = person.interests.filter((item) => item.shared).length
  const photos = person.photosTogether
  const when = person.metAt > 0 ? clock(person.metAt) : ''
  return [
    when && `Met${person.metZone && !said ? ` at ${person.metZone}` : ''} at ${when}`,
    minutes > 0 && !said && `${minutes} min together`,
    shared > 0 && `${shared} shared interest${shared > 1 ? 's' : ''}`,
    photos > 0 && `${photos} photo${photos > 1 ? 's' : ''} together`,
  ].filter(Boolean).join(' · ')
}

export function placeWords(zoneName: string, startedAt: number, minutes: number): string {
  const when = clock(startedAt)
  return `${zoneName} for ${mins(minutes)}${when ? ` from ${when}` : ''}`
}

const PLATFORMS: Record<string, { label: string; url: string }> = {
  instagram: { label: 'Instagram', url: 'https://instagram.com/' },
  facebook: { label: 'Facebook', url: 'https://facebook.com/' },
  threads: { label: 'Threads', url: 'https://threads.net/@' },
}

export function socialLink(platform: string, handle: string): { label: string; href: string | null } {
  const name = handle.replace(/^@/, '')
  const known = PLATFORMS[platform.toLowerCase()]
  return {
    label: `${known?.label ?? platform} @${name}`,
    href: known ? `${known.url}${encodeURIComponent(name)}` : null,
  }
}

export function shareCaption(caption: string, event: string, handles: string[]): string {
  return `${caption || 'Good times'} at ${event} ${handles.join(' ')}`.replace(/\s+/g, ' ').trim()
}
