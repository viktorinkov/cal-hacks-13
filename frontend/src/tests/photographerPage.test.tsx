import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PhotographerPage } from '@/components/photo/PhotographerPage'
import { useCatalog } from '@/stdb/catalog'
import { useSession } from '@/stdb/session'

afterEach(() => {
  cleanup()
  useCatalog.setState({ zones: [], photos: [] })
  useSession.setState({ phase: 'idle', roles: [], owner: false })
})

describe('photographer page', () => {
  it('keeps a dropped frame waiting, then reports when the desk is not connected', async () => {
    if (!URL.createObjectURL) URL.createObjectURL = () => 'blob:frame'
    if (!URL.revokeObjectURL) URL.revokeObjectURL = () => {}
    useSession.setState({ phase: 'live', roles: ['photographer'], owner: false })
    useCatalog.setState({
      zones: [{ id: '3', name: 'Pit', stationId: 1 }],
      photos: [],
    })
    render(<PhotographerPage />)

    expect(screen.getByRole('heading', { name: 'Frames' })).toBeInTheDocument()
    const file = new File([new Uint8Array([1, 2, 3])], 'encore.jpg', { type: 'image/jpeg', lastModified: Date.parse('2026-10-25T03:00:00Z') })
    fireEvent.change(screen.getByLabelText('Choose frames'), { target: { files: [file] } })

    expect(screen.getByLabelText('Caption for encore.jpg')).toBeInTheDocument()
    expect(screen.getByLabelText('Zone for encore.jpg')).toHaveValue('3')
    fireEvent.click(screen.getByRole('button', { name: 'Send to the desk' }))
    expect(await screen.findByText('The database is not connected.')).toBeInTheDocument()
  })
})