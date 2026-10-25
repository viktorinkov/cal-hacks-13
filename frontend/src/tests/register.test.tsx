import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RegisterPage } from '@/components/join/RegisterPage'
import { blankRegistration, clearRegistrations, getSavedRegistration, saveRegistration } from '@/cover/registry'
import { RouteProvider, useRoute } from '@/cover/route'
import { useSession, type MedicalCardView } from '@/stdb/session'
import { MAX_MEDICAL_FILE_BYTES } from '@/stdb/uploads'

const initialSession = useSession.getState()
const claimBand = vi.fn<() => Promise<void>>()
const registerBand = vi.fn<() => Promise<void>>()
const submitMedicalDocument = vi.fn<() => Promise<{ hash: string }>>()
const retryMedicalDocument = vi.fn<() => Promise<void>>()
const confirmMedicalCard = vi.fn<() => Promise<void>>()

const extractedCard: MedicalCardView = {
  bandId: 5,
  name: 'Alex Guest',
  bloodType: 'O+',
  allergies: 'Peanuts',
  conditions: 'None',
  medications: 'None',
  emergencyContact: 'Sam Guest',
  insurer: 'Northline',
  plan: 'Weekend plan',
  memberId: 'MEMBER-123',
  groupNumber: 'GROUP-456',
  status: 'extracted',
}

beforeEach(() => {
  vi.resetAllMocks()
  claimBand.mockResolvedValue(undefined)
  registerBand.mockResolvedValue(undefined)
  submitMedicalDocument.mockResolvedValue({ hash: 'uploaded-hash' })
  retryMedicalDocument.mockResolvedValue(undefined)
  confirmMedicalCard.mockResolvedValue(undefined)
  clearRegistrations()
  window.history.replaceState(null, '', '/register?band=band-05')
  useSession.setState({
    ...initialSession,
    phase: 'live',
    eventReady: true,
    departureReady: true,
    myBand: { bandId: 5, status: 'claimed', expiresAt: null },
    myBandReady: true,
    medicalDocuments: [],
    medicalDocumentsReady: true,
    medicalCard: null,
    medicalCardReady: true,
    signupError: null,
    walletError: null,
    claimBand,
    registerBand,
    submitMedicalDocument,
    retryMedicalDocument,
    confirmMedicalCard,
  })
})

afterEach(() => {
  cleanup()
  useSession.setState(initialSession, true)
  clearRegistrations()
  window.history.replaceState(null, '', '/')
})

function renderRegistration() {
  return render(<RouteProvider><RegisterPage /></RouteProvider>)
}

async function fillPersonAndShipping(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Name', { exact: true }), 'Alex Guest')
  await user.type(screen.getByLabelText('Street', { exact: true }), '1 Market St')
  await user.type(screen.getByLabelText('City', { exact: true }), 'San Francisco')
  await user.type(screen.getByLabelText('State', { exact: true }), 'CA')
  await user.type(screen.getByLabelText('ZIP', { exact: true }), '94107')
}

describe('band signup', () => {
  it.each(['/register', '/register?band='])(
    'requires a band for %s',
    (path) => {
      window.history.replaceState(null, '', path)
      renderRegistration()

      expect(screen.getByRole('heading', { name: 'Your wristband opens this page.' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument()
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
      expect(claimBand).not.toHaveBeenCalled()
    },
  )

  it('passes a band the tag names through to the host, which decides whether it exists', async () => {
    window.history.replaceState(null, '', '/register?band=band-999')
    renderRegistration()

    expect(screen.getByText(/You’re on band 999/)).toBeInTheDocument()
    await waitFor(() => expect(claimBand).toHaveBeenCalledExactlyOnceWith('BANDIT-999'))
  })

  it('shows the tapped band without a selector or identity prefill', () => {
    renderRegistration()

    expect(screen.getByText(/You’re on band 05/)).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Band' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Name', { exact: true })).toHaveValue('')
    expect(screen.queryByLabelText('Email', { exact: true })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Emergency contact', { exact: true })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Last four', { exact: true })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /findable|discovery|find me/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: /findable|discovery|find me/i })).not.toBeInTheDocument()
    expect(claimBand).not.toHaveBeenCalled()
  })

  it('opens the wallet from the header', async () => {
    renderRegistration()

    await userEvent.click(within(screen.getByRole('navigation', { name: 'Night' })).getByRole('button', { name: 'Wallet' }))
    expect(window.location.pathname).toBe('/wallet')
  })

  it('prefills typed details from an actual save for this band', () => {
    saveRegistration({ ...blankRegistration('band-05'), name: 'Returning guest' })
    renderRegistration()

    expect(screen.getByLabelText('Name', { exact: true })).toHaveValue('Returning guest')
    expect(claimBand).not.toHaveBeenCalled()
  })

  it('resets the draft when navigation changes only the tapped band query', async () => {
    function AnotherTap() {
      const { go } = useRoute()
      return <button onClick={() => go('/register?band=band-06')}>Open band 06</button>
    }
    const user = userEvent.setup()
    render(<RouteProvider><RegisterPage /><AnotherTap /></RouteProvider>)
    await user.type(screen.getByLabelText('Name', { exact: true }), 'Band five guest')
    await user.click(screen.getByRole('button', { name: 'Open band 06' }))

    expect(screen.getByText('You’re on band 06')).toBeInTheDocument()
    expect(screen.getByLabelText('Name', { exact: true })).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Save this band' })).toBeDisabled()
    await waitFor(() => expect(claimBand).toHaveBeenCalledExactlyOnceWith('BANDIT-06'))
  })

  it('shows a claim refusal and stops before profile and payment setup', async () => {
    useSession.setState({ myBand: null })
    claimBand.mockRejectedValue(new Error('This band belongs to someone else.'))
    renderRegistration()

    expect(await screen.findByRole('alert')).toHaveTextContent('This band belongs to someone else.')
    expect(claimBand).toHaveBeenCalledExactlyOnceWith('BANDIT-05')
    expect(registerBand).not.toHaveBeenCalled()
    expect(submitMedicalDocument).not.toHaveBeenCalled()
  })

  it('waits for the band view before attempting a claim', () => {
    useSession.setState({ myBand: null, myBandReady: false })
    renderRegistration()
    expect(claimBand).not.toHaveBeenCalled()
  })

  it('connects a tapped band without a press or a claim button', async () => {
    useSession.setState({
      myBand: { bandId: 5, status: 'waiting_for_press', expiresAt: Date.now() + 60_000 },
      medicalCard: { ...extractedCard, status: 'confirmed' },
    })
    renderRegistration()

    expect(screen.queryByText(/Press the button/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try claiming again' })).not.toBeInTheDocument()
    expect(screen.getByText(/Connected · ready for your details/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Insurance card/)).toBeEnabled()
    expect(screen.getByLabelText(/Medical history/)).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Save this band' })).toBeEnabled()
    await waitFor(() => expect(claimBand).toHaveBeenCalledExactlyOnceWith('BANDIT-05'))
  })

  it('rejects an invalid type and oversized file before any upload action', async () => {
    const user = userEvent.setup({ applyAccept: false })
    renderRegistration()
    const insurance = screen.getByLabelText(/Insurance card/)

    await user.upload(insurance, new File(['plain text'], 'notes.txt', { type: 'text/plain' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Choose an image or PDF file.')
    expect(insurance).toHaveAttribute('aria-invalid', 'true')
    expect(insurance).toHaveAccessibleDescription(/Choose an image or PDF file/)
    expect(submitMedicalDocument).not.toHaveBeenCalled()

    const largeFile = new File([new Uint8Array(MAX_MEDICAL_FILE_BYTES + 1)], 'large.pdf', { type: 'application/pdf' })
    await user.upload(insurance, largeFile)
    expect(screen.getByRole('alert')).toHaveTextContent('This file is too large.')
    expect(submitMedicalDocument).not.toHaveBeenCalled()
  })

  it('shows uploading until bytes arrive, then uses the live document status', async () => {
    let finishUpload!: (result: { hash: string }) => void
    submitMedicalDocument.mockReturnValue(new Promise((resolve) => { finishUpload = resolve }))
    const user = userEvent.setup()
    renderRegistration()
    const file = new File(['%PDF-1.7'], 'insurance.pdf', { type: 'application/pdf' })

    await user.upload(screen.getByLabelText(/Insurance card/), file)
    const statusList = screen.getByRole('list', { name: 'Document status' })
    expect(within(statusList).getByText('Uploading', { exact: true })).toBeInTheDocument()
    expect(submitMedicalDocument).toHaveBeenCalledExactlyOnceWith(file, 'insurance')

    await act(async () => finishUpload({ hash: 'uploaded-hash' }))
    expect(within(statusList).getByText('Reading', { exact: true })).toBeInTheDocument()

    act(() => useSession.setState({ medicalDocuments: [{
      id: '1', kind: 'insurance', fileHash: 'uploaded-hash', pageCount: 1,
      status: 'read', jobId: 'job-1', dropped: ['insurer_phone: no legible value'], uploadedAt: 100,
    }] }))
    expect(within(statusList).getByText('Read', { exact: true })).toBeInTheDocument()
    expect(within(statusList).queryByText('Reading', { exact: true })).not.toBeInTheDocument()
    expect(within(statusList).getAllByText('insurance.pdf', { exact: true })).toHaveLength(1)
    expect(within(statusList).getByText('insurer_phone: no legible value')).toBeInTheDocument()
  })

  it('explains current photo and multi-file backend limits without sending unsupported files', async () => {
    const user = userEvent.setup()
    renderRegistration()
    const insurance = screen.getByLabelText(/Insurance card/)
    await user.upload(insurance, new File(['photo'], 'front.png', { type: 'image/png' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Photo reading is not available yet.')
    await user.upload(insurance, [
      new File(['%PDF-front'], 'front.pdf', { type: 'application/pdf' }),
      new File(['%PDF-back'], 'back.pdf', { type: 'application/pdf' }),
    ])
    expect(screen.getByRole('alert')).toHaveTextContent('Please combine these pages into one PDF.')
    expect(submitMedicalDocument).not.toHaveBeenCalled()
  })

  it('shows failed documents and retries the selected document', async () => {
    useSession.setState({ medicalDocuments: [{
      id: '2', kind: 'history', fileHash: 'failed-hash', pageCount: 1,
      status: 'failed', jobId: 'job-2', dropped: [], uploadedAt: 200,
    }] })
    const user = userEvent.setup()
    renderRegistration()

    expect(within(screen.getByRole('list', { name: 'Document status' })).getByText('Failed')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry Medical history · document 2' }))
    expect(retryMedicalDocument).toHaveBeenCalledExactlyOnceWith('2')
  })

  it('confirms an extracted card through the session action', async () => {
    useSession.setState({ medicalCard: extractedCard })
    const user = userEvent.setup()
    renderRegistration()

    expect(screen.getByText('MEMBER-123')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'This is right' }))
    expect(confirmMedicalCard).toHaveBeenCalledOnce()
  })

  it('saves typed details and shows the completed slip', async () => {
    useSession.setState({ medicalCard: { ...extractedCard, status: 'confirmed' } })
    const user = userEvent.setup()
    renderRegistration()
    await fillPersonAndShipping(user)
    await user.click(screen.getByRole('button', { name: 'Save this band' }))

    expect(await screen.findByRole('heading', { name: 'Saved on band 05.' })).toBeInTheDocument()
    expect(registerBand).toHaveBeenCalledExactlyOnceWith('BANDIT-05', 'Alex Guest')
    expect(screen.getByText(/Alex Guest/)).toBeInTheDocument()
    expect(screen.queryByText('MEMBER-123')).not.toBeInTheDocument()
    expect(getSavedRegistration('band-05')).toMatchObject({
      name: 'Alex Guest',
      street: '1 Market St', city: 'San Francisco', region: 'CA', postalCode: '94107', country: 'United States',
    })
  })

  it('requires confirmation and valid typed fields before saving', async () => {
    useSession.setState({ medicalCard: extractedCard })
    const user = userEvent.setup()
    renderRegistration()
    expect(screen.getByRole('button', { name: 'Save this band' })).toBeDisabled()

    act(() => useSession.setState({ medicalCard: { ...extractedCard, status: 'confirmed' } }))
    await user.click(screen.getByRole('button', { name: 'Save this band' }))
    expect(screen.getByLabelText('Name', { exact: true })).toHaveAccessibleDescription('Name the person wearing it.')
    expect(screen.getByLabelText('Street', { exact: true })).toHaveAccessibleDescription('Give a street address.')
    expect(screen.getByLabelText('ZIP', { exact: true })).toHaveAccessibleDescription('Use a ZIP code, like 94107.')
    expect(registerBand).not.toHaveBeenCalled()
    expect(getSavedRegistration('band-05')).toBeNull()
  })

  it('allows saving with a wallet still pending and displays the account once it arrives', async () => {
    useSession.setState({
      medicalCard: { ...extractedCard, status: 'confirmed' },
      walletError: 'The wallet is still opening.',
    })
    renderRegistration()
    expect(screen.getByRole('button', { name: 'Save this band' })).toBeEnabled()
    expect(screen.getByText(/Wallet pending:/)).toHaveTextContent('Your registration can still be saved.')

    act(() => useSession.setState({ wallet: { accountId: 'wallet-05', balanceCents: 0 } }))
    await waitFor(() => expect(screen.getByText('Wallet account wallet-05')).toBeInTheDocument())
  })

  it('keeps a pending medical view distinct from an empty card', () => {
    useSession.setState({ medicalCardReady: false, medicalDocumentsReady: false })
    renderRegistration()
    expect(screen.getByText(/Still reading your documents/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'This is right' })).not.toBeInTheDocument()
  })
})
