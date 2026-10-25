import { afterEach, describe, expect, it, vi } from 'vitest'
import { uploadPhoto, validatePhotoFile } from '@/stdb/uploads'

describe('event frame upload', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('rejects a file that is not an image', () => {
    const file = new File(['notes'], 'notes.txt', { type: 'text/plain' })
    expect(validatePhotoFile(file)).toMatch(/image/)
  })

  it('posts the frame and returns the blob address', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'pit.jpg', { type: 'image/jpeg' })
    const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer()).then((bytes) =>
      Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join(''),
    )
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ hash, url: `/blobs/${hash}`, pages: 0, size_bytes: 3 }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const uploaded = await uploadPhoto(file)

    expect(uploaded).toEqual({ hash, url: `/blobs/${hash}` })
    expect(fetchMock).toHaveBeenCalledWith('/api/blobs?purpose=photo', expect.objectContaining({ method: 'POST' }))
  })
})