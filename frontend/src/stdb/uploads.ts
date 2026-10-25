export type MedicalDocumentKind = 'insurance' | 'history'

export const MAX_MEDICAL_FILE_BYTES = 10 * 1024 * 1024

/** Validate before reading a sensitive file into memory or sending any bytes. */
export function validateMedicalFile(file: File): string | null {
  if (!file.size) return 'This file is empty. Choose a photo or PDF with content.'
  if (file.size > MAX_MEDICAL_FILE_BYTES) return 'This file is too large. Choose a file under 10 MB.'
  if (file.type !== 'application/pdf' && !file.type.startsWith('image/')) {
    return 'Choose an image or PDF file.'
  }
  return null
}

export async function sha256(bytes: ArrayBuffer): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('Secure uploads need HTTPS. Open the secure event link and try again.')
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export interface UploadedBlob {
  hash: string
  pageCount: number
}

export const MAX_PHOTO_BYTES = 12 * 1024 * 1024

/** A frame for the event album: an image, under 12 MB. */
export function validatePhotoFile(file: File): string | null {
  if (!file.size) return 'This file is empty. Choose a frame with content.'
  if (file.size > MAX_PHOTO_BYTES) return 'This frame is over 12 MB. Choose a smaller one.'
  if (!file.type.startsWith('image/')) return 'Choose an image file.'
  return null
}

export interface UploadedPhoto {
  hash: string
  url: string
}

/** Stores an event frame. The photo purpose is shared, so it does not need the attendee session. */
export async function uploadPhoto(file: File): Promise<UploadedPhoto> {
  const invalid = validatePhotoFile(file)
  if (invalid) throw new Error(invalid)
  const bytes = await file.arrayBuffer()
  const hash = await sha256(bytes)
  const response = await fetch('/api/blobs?purpose=photo', {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'image/jpeg' },
    body: bytes,
    signal: AbortSignal.timeout(60_000),
  })
  const data: unknown = await response.json().catch(() => null)
  const row = data && typeof data === 'object' ? data as Record<string, unknown> : null
  if (!response.ok) {
    const message = typeof row?.error === 'string' ? row.error : 'This frame could not be uploaded. Try again.'
    throw new Error(response.status === 413 ? 'The upload service rejected this frame. Try a smaller one.' : message)
  }
  const url = typeof row?.url === 'string' ? row.url : ''
  if (!url.startsWith('/blobs/') || typeof row?.hash !== 'string' || row.hash.toLowerCase() !== hash) {
    throw new Error('The uploaded frame could not be verified. Try again.')
  }
  return { hash, url }
}

/**
 * Contract verified in crates/bandit-api/src/web.rs on origin/main and the vik-e2e worktree.
 * This endpoint registers the blob as owner_only for the identity behind x-bandit-session.
 * register_blob is service-only; an attendee must not call it again from the browser.
 * The endpoint can store images, but the current medical worker only extracts PDFs.
 */
export async function uploadBlob(file: File, kind: MedicalDocumentKind, sessionToken: string): Promise<UploadedBlob> {
  const invalid = validateMedicalFile(file)
  if (invalid) throw new Error(invalid)
  if (!sessionToken) throw new Error('Your upload session is not ready. Try again.')
  const bytes = await file.arrayBuffer()
  const hash = await sha256(bytes)
  const response = await fetch(`/api/blobs?purpose=${kind}`, {
    method: 'POST',
    headers: { 'Content-Type': file.type, 'x-bandit-session': sessionToken },
    body: bytes,
    signal: AbortSignal.timeout(30_000),
  })
  const data: unknown = await response.json().catch(() => null)
  const row = data && typeof data === 'object' ? data as Record<string, unknown> : null
  if (!response.ok) {
    const message = typeof row?.error === 'string' ? row.error : 'Your file could not be uploaded. Try again.'
    throw new Error(response.status === 413 ? 'The upload service rejected this file size. Try a smaller file.' : message)
  }
  if (typeof row?.hash !== 'string' || row.hash.toLowerCase() !== hash) {
    throw new Error('The uploaded file could not be verified. Try again.')
  }
  const pages = row.pages
  const pageCount = file.type === 'application/pdf' && typeof pages === 'number' && Number.isInteger(pages) && pages > 0 ? pages : 1
  return { hash, pageCount }
}

/** A staff PDF: the venue policy, or a clinic report. The organizer portal posts these without an attendee session. */
export async function uploadDeskPdf(file: File, purpose: 'policy' | 'medical'): Promise<UploadedBlob> {
  if (!file.size) throw new Error('This file is empty. Choose a PDF with content.')
  if (file.size > MAX_MEDICAL_FILE_BYTES) throw new Error('This PDF is over 10 MB. Choose a smaller one.')
  if (file.type !== 'application/pdf') throw new Error('Choose a PDF.')
  const bytes = await file.arrayBuffer()
  const hash = await sha256(bytes)
  const response = await fetch(`/api/blobs?purpose=${purpose}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/pdf' },
    body: bytes,
    signal: AbortSignal.timeout(60_000),
  })
  const data: unknown = await response.json().catch(() => null)
  const row = data && typeof data === 'object' ? data as Record<string, unknown> : null
  if (!response.ok) {
    const message = typeof row?.error === 'string' ? row.error : 'This PDF could not be uploaded. Try again.'
    throw new Error(response.status === 413 ? 'The upload service rejected this PDF. Try a smaller one.' : message)
  }
  if (typeof row?.hash !== 'string' || row.hash.toLowerCase() !== hash) {
    throw new Error('The uploaded PDF could not be verified. Try again.')
  }
  const pages = row.pages
  const pageCount = typeof pages === 'number' && Number.isInteger(pages) && pages > 0 ? pages : 1
  return { hash, pageCount }
}

