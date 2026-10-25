import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FootageCamera, LaptopCamera } from '@/components/desk/CamerasPage'

const getUserMedia = vi.fn<(constraints: MediaStreamConstraints) => Promise<MediaStream>>()
const createObjectURL = vi.fn<(file: Blob) => string>()
const revokeObjectURL = vi.fn<(url: string) => void>()

function cameraStream() {
  const track = { stop: vi.fn(), onended: null as (() => void) | null }
  return { track, value: { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { mediaDevices: { getUserMedia } }))
  vi.stubGlobal('URL', class extends URL {
    static override createObjectURL = createObjectURL
    static override revokeObjectURL = revokeObjectURL
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('laptop camera lifecycle', () => {
  it('asks for video only after a click and releases it on stop', async () => {
    const camera = cameraStream()
    getUserMedia.mockResolvedValue(camera.value)
    render(<LaptopCamera />)
    expect(getUserMedia).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Start camera' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('On'))
    expect(getUserMedia).toHaveBeenCalledExactlyOnceWith({ video: true, audio: false })
    const preview = screen.getByLabelText('Laptop camera preview') as HTMLVideoElement
    expect(preview.srcObject).toBe(camera.value)
    await userEvent.click(screen.getByRole('button', { name: 'Stop camera' }))
    expect(camera.track.stop).toHaveBeenCalledOnce()
    expect(preview.srcObject).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('Camera off')
  })

  it('releases a live camera when leaving the page', async () => {
    const camera = cameraStream()
    getUserMedia.mockResolvedValue(camera.value)
    const page = render(<LaptopCamera />)
    await userEvent.click(screen.getByRole('button', { name: 'Start camera' }))
    await screen.findByRole('button', { name: 'Stop camera' })
    page.unmount()
    expect(camera.track.stop).toHaveBeenCalledOnce()
    expect(camera.track.onended).toBeNull()
  })

  it.each(['cancel', 'leave'] as const)('stops permission results that arrive after %s', async (action) => {
    const camera = cameraStream()
    let finish!: (stream: MediaStream) => void
    getUserMedia.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    const page = render(<LaptopCamera />)
    await userEvent.click(screen.getByRole('button', { name: 'Start camera' }))
    if (action === 'cancel') await userEvent.click(screen.getByRole('button', { name: 'Cancel camera request' }))
    else page.unmount()
    await act(async () => { finish(camera.value) })
    expect(camera.track.stop).toHaveBeenCalledOnce()
    if (action === 'cancel') expect(screen.getByRole('status')).toHaveTextContent('Camera off')
  })

  it('shows an actionable denial and permits another request', async () => {
    getUserMedia.mockRejectedValue(new DOMException('denied', 'NotAllowedError'))
    render(<LaptopCamera />)
    await userEvent.click(screen.getByRole('button', { name: 'Start camera' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Allow it in your browser')
    expect(screen.getByRole('button', { name: 'Start camera' })).toBeEnabled()
  })

  it('reflects a camera that the browser disconnected', async () => {
    const camera = cameraStream()
    getUserMedia.mockResolvedValue(camera.value)
    render(<LaptopCamera />)
    await userEvent.click(screen.getByRole('button', { name: 'Start camera' }))
    await screen.findByRole('button', { name: 'Stop camera' })
    act(() => camera.track.onended?.())
    expect(screen.getByRole('status')).toHaveTextContent('Camera off')
    expect(camera.track.stop).toHaveBeenCalledOnce()
  })
})

describe('recorded camera footage', () => {
  it('labels footage and cleans up each browser-local replacement', async () => {
    createObjectURL.mockReturnValueOnce('blob:first').mockReturnValueOnce('blob:second')
    const page = render(<FootageCamera id="main-hall" name="Main hall" />)
    expect(screen.getByText(/not a live feed/)).toBeInTheDocument()
    const player = () => screen.getByLabelText('Main hall recorded video') as HTMLVideoElement
    expect(player().getAttribute('src')).toBe('/camera-footage/main-hall.mp4')
    const chooser = screen.getByLabelText('Choose video for Main hall')
    await userEvent.upload(chooser, new File(['one'], 'first.mp4', { type: 'video/mp4' }))
    expect(player().getAttribute('src')).toBe('blob:first')
    await userEvent.upload(chooser, new File(['two'], 'second.mp4', { type: 'video/mp4' }))
    expect(player().getAttribute('src')).toBe('blob:second')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:first')
    page.unmount()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:second')
  })

  it('restores venue footage and reports playback failure without a live label', async () => {
    createObjectURL.mockReturnValue('blob:replacement')
    render(<FootageCamera id="booth-aisle" name="Booth aisle" />)
    await userEvent.upload(screen.getByLabelText('Choose video for Booth aisle'), new File(['clip'], 'clip.mp4', { type: 'video/mp4' }))
    await userEvent.click(screen.getByRole('button', { name: 'Restore venue recording' }))
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:replacement')
    const player = screen.getByLabelText('Booth aisle recorded video')
    expect(player.getAttribute('src')).toBe('/camera-footage/booth-aisle.mp4')
    fireEvent.error(player)
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a playable video')
    expect(screen.getByText('Video unavailable')).toBeInTheDocument()
  })
})
