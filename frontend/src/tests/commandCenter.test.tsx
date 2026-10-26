/**
 * Integration: the real command centre, stores, sync layer and mock backend, with only the WebGL
 * map stubbed out (jsdom has no WebGL). Time is driven by hand so every step is deterministic.
 */
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandCenter } from '@/components/dashboard/CommandCenter'
import { TooltipProvider } from '@/components/ui/tooltip'
import { MockBackendAdapter } from '@/services/MockBackendAdapter'
import { startRuntime, stopRuntime } from '@/services/runtime'
import { useVenuePlan } from '@/map/venuePlan'
import { useUi } from '@/stores/ui'
import { useWorld } from '@/stores/world'

vi.mock('@/map/VenueMap', () => ({ VenueMap: () => <div data-testid="venue-map" /> }))

const controller = vi.hoisted(() => ({
  attach: vi.fn(),
  detach: vi.fn(),
  engine: null,
  fit: vi.fn(),
  focus: vi.fn(),
  focusIncident: vi.fn(() => true),
  frame: vi.fn(),
  zoom: vi.fn(),
  rotate: vi.fn(),
  resetView: vi.fn(),
}))
vi.mock('@/map/controller', () => ({ mapController: controller }))

let adapter: MockBackendAdapter

async function boot(opts: { latencyMs?: number } = {}) {
  adapter = new MockBackendAdapter({ driver: 'manual', latencyMs: opts.latencyMs ?? 0, crowdSize: 220, warmupS: 2 })
  startRuntime(adapter, {
    schedule: (fn) => {
      const id = setTimeout(fn, 0)
      return () => clearTimeout(id)
    },
  })
  render(
    <TooltipProvider>
      <CommandCenter />
    </TooltipProvider>,
  )
  await waitFor(() => expect(useWorld.getState().ready).toBe(true))
}

/** Advance the simulated venue and let React catch up. */
async function advance(seconds: number) {
  await act(async () => {
    adapter.advance(seconds * 1000)
    await new Promise((r) => setTimeout(r, 5))
  })
}

async function pressSos() {
  await act(async () => {
    await adapter.demo.pressSos('band-03')
  })
  await advance(0.5)
}

function incidentPanel() {
  return screen.getByRole('heading', { level: 2, name: 'SOS pressed' }).closest('section') as HTMLElement
}

beforeEach(() => {
  useVenuePlan.setState({ plan: 'simulation' })
  useUi.setState({ selection: { kind: 'none' }, pending: {} })
  Object.values(controller).forEach((f) => typeof f === 'function' && 'mockClear' in f && (f as ReturnType<typeof vi.fn>).mockClear())
})

afterEach(() => {
  cleanup()
  stopRuntime()
})

describe('command center', () => {
  it('starts quiet', async () => {
    await boot()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('No open incidents.')
  })

  it('an SOS creates an incident, opens it and focuses the map on it', async () => {
    await boot()
    await pressSos()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Someone pressed SOS.')
    const panel = incidentPanel()
    expect(within(panel).getByText(/Needs a person/)).toBeInTheDocument()
    expect(within(panel).getByText(/Radio estimate ±6 m/)).toBeInTheDocument()
    expect(within(panel).getByText('CAM-01 is looking')).toBeInTheDocument()
    const id = Object.keys(useWorld.getState().incidents)[0]
    expect(useUi.getState().selection).toEqual({ kind: 'incident', id })
    expect(controller.focusIncident).toHaveBeenCalledWith(id)
  })

  it('keeps the SOS visible and unconfirmed when the camera cannot see it', async () => {
    await boot()
    await act(async () => adapter.demo.setCameraOutcome('not_visible'))
    await pressSos()
    await advance(3)
    const panel = incidentPanel()
    expect(within(panel).getByText("Not in CAM-01's view")).toBeInTheDocument()
    expect(within(panel).getByText(/The SOS still stands/)).toBeInTheDocument()
    expect(within(panel).getByText(/Radio estimate ±6 m/)).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'Acknowledge' })).toBeEnabled()
  })

  it('shows acknowledgement only after the backend confirms it', async () => {
    await boot({ latencyMs: 60 })
    await pressSos()
    const user = userEvent.setup()
    const panel = incidentPanel()
    await user.click(within(panel).getByRole('button', { name: 'Acknowledge' }))
    // in flight: the status has not changed and the button says it is waiting
    expect(within(panel).getByText(/Needs a person/)).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: /Waiting for the backend/ })).toBeDisabled()
    await waitFor(() => expect(within(incidentPanel()).getByText('Acknowledged')).toBeInTheDocument())
  })

  it('walks guidance from preview through pending to every band confirming', async () => {
    await boot()
    await pressSos()
    await advance(3)
    const user = userEvent.setup()
    await user.click(within(incidentPanel()).getByRole('button', { name: 'Acknowledge' }))
    // the panel asks for the preapproved path once acknowledged
    const approve = await screen.findByRole('button', { name: /Clear the path · signal ~?\d+ bands/ }, { timeout: 3000 })
    expect(screen.getByText('Path for First Aid, preview')).toBeInTheDocument()
    expect(screen.getByText('Nothing changes on any band until you send it.')).toBeInTheDocument()
    await user.click(approve)
    await waitFor(() => expect(within(incidentPanel()).getByText('Responding')).toBeInTheDocument())
    expect(screen.getByText(/0 of \d+ test bands confirmed so far/)).toBeInTheDocument()
    await advance(3)
    const cmd = Object.values(useWorld.getState().commands).find((c) => c.approvalStatus === 'approved')!
    expect(cmd.deliveryStatus).toBe('delivered')
    expect(screen.getByText(new RegExp(`${cmd.targets.length} of ${cmd.targets.length} test bands confirmed$`))).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('A path is open.')
  })

  it('shows a partial delivery and lets the operator resend', async () => {
    await boot()
    await act(async () => adapter.demo.setFlakyRadio(true))
    await pressSos()
    await advance(3)
    const user = userEvent.setup()
    await user.click(within(incidentPanel()).getByRole('button', { name: 'Acknowledge' }))
    await user.click(await screen.findByRole('button', { name: /Clear the path/ }, { timeout: 3000 }))
    await waitFor(() => expect(within(incidentPanel()).getByText('Responding')).toBeInTheDocument())
    await advance(4)
    expect(screen.getByText(/did not confirm\. Its light has not changed\./)).toBeInTheDocument()
    // the bands list lives in the folded bottom-left panel
    await user.click(screen.getByRole('button', { name: 'Open' }))
    expect(screen.getAllByText(/No confirmation/).length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: /Resend/ }))
    await advance(2)
    await waitFor(() => expect(screen.queryByText(/did not confirm\./)).not.toBeInTheDocument())
  })

  it('degrades when the link drops and reloads state when it returns', async () => {
    await boot()
    await act(async () => adapter.demo.setLinkDown(true))
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Connection lost.')
    expect(screen.getByRole('alert')).toHaveTextContent(/Not live\. Showing data from/)
    await act(async () => adapter.demo.setLinkDown(false))
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).not.toHaveTextContent('Connection lost.'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('resolves, then a reset returns to the initial state', async () => {
    await boot()
    await pressSos()
    const user = userEvent.setup()
    await user.click(within(incidentPanel()).getByRole('button', { name: 'False alarm' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText(/False alarm/)).toBeChecked()
    await user.click(within(dialog).getByRole('button', { name: /Resolve INC-/ }))
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Resolved.'))
    await act(async () => adapter.resetSimulation())
    await waitFor(() => expect(Object.keys(useWorld.getState().incidents)).toHaveLength(0))
    expect(useWorld.getState().scenario?.step).toBe('normal')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('No open incidents.')
  })
})
