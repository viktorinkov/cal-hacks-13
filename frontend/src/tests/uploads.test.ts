import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_MEDICAL_FILE_BYTES, sha256, uploadBlob, validateMedicalFile } from '@/stdb/uploads'

function fileWithBytes(content: string, type = 'application/pdf'): File {
  const bytes = new TextEncoder().encode(content).buffer
  const file = new File([bytes], 'record.pdf', { type })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes })
  return file
}

beforeEach(() => vi.stubGlobal('crypto', webcrypto))
afterEach(() => vi.unstubAllGlobals())

describe('medical file validation', () => {
  it('accepts PDFs and images, and rejects empty, unsupported, and oversized files', () => {
    expect(validateMedicalFile(fileWithBytes('%PDF-example'))).toBeNull()
    expect(validateMedicalFile(fileWithBytes('image', 'image/png'))).toBeNull()
    expect(validateMedicalFile(fileWithBytes('', 'application/pdf'))).toMatch(/empty/i)
    expect(validateMedicalFile(fileWithBytes('plain text', 'text/plain'))).toMatch(/image or PDF/i)
    const tooLarge = fileWithBytes('%PDF')
    Object.defineProperty(tooLarge, 'size', { value: MAX_MEDICAL_FILE_BYTES + 1 })
    expect(validateMedicalFile(tooLarge)).toMatch(/10 MB/)
  })
})

describe('private blob uploads', () => {
  it('hashes the bytes, uses the verified route and session header, and returns server page count', async () => {
    const file = fileWithBytes('%PDF-example')
    const bytes = await file.arrayBuffer()
    const hash = await sha256(bytes)
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ hash, pages: 3 }) })
    vi.stubGlobal('fetch', fetch)

    await expect(uploadBlob(file, 'history', 'ephemeral-secret')).resolves.toEqual({ hash, pageCount: 3 })
    expect(fetch).toHaveBeenCalledWith('/api/blobs?purpose=history', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/pdf', 'x-bandit-session': 'ephemeral-secret' },
      body: bytes,
    }))
    expect(localStorage.getItem('ephemeral-secret')).toBeNull()
  })

  it('rejects a response with a different hash before it can be submitted for reading', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ hash: '0'.repeat(64), pages: 1 }) }))
    await expect(uploadBlob(fileWithBytes('%PDF-example'), 'insurance', 'session')).rejects.toThrow(/could not be verified/)
  })

  it('keeps backend refusal messages and explains request-size refusal', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: 'unknown API session' }) })
    vi.stubGlobal('fetch', fetch)
    await expect(uploadBlob(fileWithBytes('%PDF-example'), 'insurance', 'session')).rejects.toThrow('unknown API session')
    fetch.mockResolvedValue({ ok: false, status: 413, json: async () => { throw new Error('not JSON') } })
    await expect(uploadBlob(fileWithBytes('%PDF-example'), 'insurance', 'session')).rejects.toThrow(/smaller file/)
  })

  it('rejects an invalid file without reading it or calling the upload service', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(uploadBlob(fileWithBytes('text', 'text/plain'), 'history', 'session')).rejects.toThrow(/image or PDF/)
    expect(fetch).not.toHaveBeenCalled()
  })
})
