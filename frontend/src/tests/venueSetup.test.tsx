import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { VenuePage } from '@/components/desk/VenuePage'
import { RouteProvider } from '@/cover/route'
import { seedSession, useSession } from '@/stdb/session'
import { DEFAULT_SETUP_ID, useVenueSetup, type VenueSetupView, type VenueStepView } from '@/stdb/venueSetup'
import { boundsPoint, palacePoint } from '@/map/hallMesh'
import { MODEL_MARGIN, chosenModelOf } from '@/venue/chosenModel'
import { PALACE_SETUP, PALACE_STEPS, palaceRun } from '@/venue/palaceRun'
import {
  activeStage,
  buildRun,
  clock,
  describeStep,
  detailParts,
  findingOf,
  frameAt,
  speedFactor,
  stageSpans,
} from '@/venue/runs'

const START = Date.UTC(2026, 9, 25, 7, 0)

function liveSetup(over: Partial<VenueSetupView> = {}): VenueSetupView {
  return {
    ...PALACE_SETUP,
    id: '7',
    eventName: 'Tree Hacks 2027',
    status: 'running',
    venueName: 'Huang Engineering Center',
    address: '475 Via Ortega, Stanford, CA 94305',
    mapUrl: 'https://example.org/map',
    modelUrl: '',
    modelBytes: 0,
    meshes: 0,
    triangles: 0,
    sizeX: 0,
    sizeY: 0,
    sizeZ: 0,
    floorPlans: [],
    sources: [],
    createdAt: START,
    updatedAt: START,
    ...over,
  }
}

function liveSteps(): VenueStepView[] {
  return [
    { id: '70', setupId: '7', step: 'Searching', detail: 'Searching the web for "Tree Hacks 2027"', at: START },
    { id: '71', setupId: '7', step: 'Found the event', detail: 'treehacks.com · Huang Engineering Center', at: START + 12_000 },
    { id: '72', setupId: '7', step: 'Reading pages', detail: 'treehacks.com, treehacks.com/venue', at: START + 30_000 },
  ]
}

function resetVenue() {
  useVenueSetup.setState({
    setupsReady: true,
    stepsReady: true,
    chosenReady: true,
    error: null,
    setups: [],
    steps: [],
    chosenId: DEFAULT_SETUP_ID,
    starting: false,
    startError: null,
    choosing: false,
    chooseError: null,
  })
}

function page() {
  return render(
    <RouteProvider>
      <VenuePage />
    </RouteProvider>,
  )
}

beforeEach(() => {
  seedSession([])
  resetVenue()
})

afterEach(() => {
  cleanup()
  resetVenue()
})

describe('venue run steps', () => {
  it('maps every step the worker writes to its stage and tool', () => {
    expect(describeStep('Searching')).toEqual({ stage: 'search', tool: 'search', kind: 'progress' })
    expect(describeStep('Found the event')).toMatchObject({ stage: 'search', tool: 'claude' })
    expect(describeStep('Reading pages')).toMatchObject({ stage: 'read', tool: 'unlocker' })
    expect(describeStep('Opening the 3D map')).toMatchObject({ stage: 'capture', tool: 'browser' })
    expect(describeStep('No model there')).toMatchObject({ stage: 'capture', kind: 'dead-end' })
    expect(describeStep('No 3D map found')).toMatchObject({ kind: 'failed' })
    expect(describeStep('Saved the model')).toMatchObject({ stage: 'save', kind: 'done' })
  })

  it('reads queries, pages and links out of the details', () => {
    expect(detailParts('Searching', PALACE_STEPS[0].detail).map((p) => p.kind === 'chip' && p.text)).toEqual([
      'Cal Hacks 13.0',
      'Cal Hacks 13.0 venue map',
      'Cal Hacks 13.0 venue 3D map floor plan',
    ])
    expect(detailParts('Reading pages', 'hive.hackberkeley.org/venue-map, palaceoffinearts.com')).toEqual([
      { kind: 'chip', text: 'hive.hackberkeley.org/venue-map', href: 'https://hive.hackberkeley.org/venue-map' },
      { kind: 'chip', text: 'palaceoffinearts.com', href: 'https://palaceoffinearts.com' },
    ])
    expect(detailParts('No model there', 'https://a.example/map: timed out')).toEqual([
      { kind: 'link', href: 'https://a.example/map', text: 'a.example/map' },
      { kind: 'text', text: ': timed out' },
    ])
  })

  it('splits the Palace run into stages whose times add up to the run', () => {
    const run = palaceRun()
    const frame = frameAt(run, run.duration)
    const spans = stageSpans(run, frame)
    expect(spans.map((s) => [s.stage, clock(s.to - s.from)])).toEqual([
      ['search', '0:31'],
      ['read', '0:27'],
      ['capture', '1:54'],
    ])
    expect(spans.reduce((sum, s) => sum + (s.to - s.from), 0)).toBe(run.duration)
    expect(clock(run.duration)).toBe('2:52')
    expect(activeStage(frame, spans)).toBe('capture')
  })

  it('shows only what was known at that point of a replay', () => {
    const run = palaceRun()
    const start = frameAt(run, 0)
    expect(start.steps.map((s) => s.step)).toEqual(['Searching'])
    expect(start.status).toBe('running')
    expect(start.setup.venueName).toBe('')
    expect(start.setup.triangles).toBe(0)

    const found = frameAt(run, 20_000)
    expect(found.setup.venueName).toBe('Palace of Fine Arts')
    expect(found.setup.modelUrl).toBe('')
    expect(findingOf(found, run.setup.eventName)).toBe('Cal Hacks 13.0 at the Palace of Fine Arts: found the event, 0:20 in.')

    const capturing = frameAt(run, 100_000)
    expect(capturing.current?.step).toBe('Opening the 3D map')
    expect(activeStage(capturing, stageSpans(run, capturing))).toBe('capture')

    const done = frameAt(run, run.duration)
    expect(done.finished).toBe(true)
    expect(done.setup.triangles).toBe(115_545)
    expect(findingOf(done, run.setup.eventName)).toBe('Palace of Fine Arts, captured from hive.hackberkeley.org/venue-map: 214 × 97 m, 115,545 triangles.')
  })

  it('plays the whole run in 30 seconds at that speed', () => {
    const run = palaceRun()
    expect(run.duration / speedFactor('fit', run.duration)).toBe(30_000)
    expect(speedFactor('x4', run.duration)).toBe(4)
    expect(speedFactor('real', run.duration)).toBe(1)
  })

  it('keeps a live run growing with the clock while it works', () => {
    const run = buildRun(liveSetup(), liveSteps())
    const frame = frameAt(run, 0, START + 45_000)
    expect(frame.finished).toBe(false)
    expect(frame.span).toBe(45_000)
    expect(frame.steps).toHaveLength(3)
    expect(frame.current?.step).toBe('Reading pages')
    expect(findingOf(frame, 'Tree Hacks 2027')).toBe('Tree Hacks 2027 at the Huang Engineering Center: reading pages, 0:45 in.')
  })

  it('matches the Palace model that ships with the app', () => {
    const file = readFileSync(resolve(process.cwd(), 'public/venue/venue.glb'))
    expect(file.length).toBe(PALACE_SETUP.modelBytes)
    const jsonLength = file.readUInt32LE(12)
    const gltf = JSON.parse(file.subarray(20, 20 + jsonLength).toString('utf8')) as {
      meshes: { primitives: { indices?: number; attributes: { POSITION: number } }[] }[]
      accessors: { count: number; min?: number[]; max?: number[] }[]
    }
    let triangles = 0
    const lo = [Infinity, Infinity, Infinity]
    const hi = [-Infinity, -Infinity, -Infinity]
    for (const mesh of gltf.meshes) {
      for (const p of mesh.primitives) {
        triangles += Math.floor(gltf.accessors[p.indices ?? p.attributes.POSITION].count / 3)
        const pos = gltf.accessors[p.attributes.POSITION]
        for (let i = 0; i < 3; i++) {
          lo[i] = Math.min(lo[i], pos.min?.[i] ?? 0)
          hi[i] = Math.max(hi[i], pos.max?.[i] ?? 0)
        }
      }
    }
    expect(gltf.meshes).toHaveLength(PALACE_SETUP.meshes)
    expect(triangles).toBe(PALACE_SETUP.triangles)
    expect(Math.round((hi[0] - lo[0]) * 10) / 10).toBe(PALACE_SETUP.sizeX)
    expect(Math.round((hi[1] - lo[1]) * 10) / 10).toBe(PALACE_SETUP.sizeY)
    expect(Math.round((hi[2] - lo[2]) * 10) / 10).toBe(PALACE_SETUP.sizeZ)
  })
})

describe('venue setup page', () => {
  it('opens on the finished Palace replay, labelled as reconstructed', () => {
    page()
    expect(screen.getByLabelText('Event name')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Cal Hacks 13.0 at the Palace of Fine Arts' })).toBeInTheDocument()
    expect(screen.getByText(/Reconstructed from the model saved/)).toBeInTheDocument()
    expect(screen.getByText('5 steps')).toBeInTheDocument()
    expect(screen.getByText('Model saved')).toBeInTheDocument()
    expect(screen.getByText('115,545')).toBeInTheDocument()
    expect(screen.getByText('This venue is on the map')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Open the map/ })).toBeInTheDocument()
  })

  it('restarts the replay from the first step and pauses on request', async () => {
    const user = userEvent.setup()
    page()
    await user.click(screen.getByRole('button', { name: /Replay the run/ }))
    expect(screen.getByText('Replaying')).toBeInTheDocument()
    expect(screen.getByText('1 step')).toBeInTheDocument()
    expect(screen.getByText('Waiting for the 3D map.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Pause/ }))
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument()
  })

  it('scrubs the replay from the keyboard', () => {
    page()
    const slider = screen.getByRole('slider', { name: 'Replay position' })
    act(() => {
      fireEvent.keyDown(slider, { key: 'Home' })
    })
    expect(slider).toHaveAttribute('aria-valuetext', '0:00 of 2:52')
    for (let i = 0; i < 3; i++) {
      act(() => {
        fireEvent.keyDown(slider, { key: 'ArrowRight', shiftKey: true })
      })
    }
    expect(slider).toHaveAttribute('aria-valuetext', '1:30 of 2:52')
    expect(screen.getByText('Capturing the 3D map')).toBeInTheDocument()
    act(() => {
      fireEvent.keyDown(slider, { key: 'End' })
    })
    expect(screen.getByText('5 steps')).toBeInTheDocument()
  })

  it('asks for a name before starting a search', async () => {
    const user = userEvent.setup()
    page()
    await user.click(screen.getByRole('button', { name: 'Find the venue' }))
    expect(screen.getByText("Type the event's name first.")).toBeInTheDocument()
  })

  it('shows a refused start next to the field', async () => {
    const user = userEvent.setup()
    page()
    await user.type(screen.getByLabelText('Event name'), 'Tree Hacks 2027')
    await user.click(screen.getByRole('button', { name: 'Find the venue' }))
    expect(await screen.findByText('The database is not connected.')).toBeInTheDocument()
    expect(screen.getByLabelText('Event name')).toHaveAttribute('aria-invalid', 'true')
  })

  it('waits for the connection before a search can start', () => {
    useSession.setState({ phase: 'connecting' })
    page()
    expect(screen.getByRole('button', { name: 'Find the venue' })).toBeDisabled()
    expect(screen.getByText('Connecting…')).toBeInTheDocument()
  })

  it('shows a live search as it works when it is picked', async () => {
    const user = userEvent.setup()
    useVenueSetup.setState({ setups: [liveSetup({ createdAt: Date.now() - 45_000 })], steps: liveSteps().map((s) => ({ ...s, at: s.at - START + Date.now() - 45_000 })) })
    page()
    await user.selectOptions(screen.getByLabelText('Search shown'), '7')
    expect(screen.getByRole('heading', { level: 2, name: 'Tree Hacks 2027 at the Huang Engineering Center' })).toBeInTheDocument()
    expect(screen.getByText('Working')).toBeInTheDocument()
    expect(screen.getByText('3 steps')).toBeInTheDocument()
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Use this venue' })).toBeDisabled()
    expect(screen.getByText('Waiting for the model.')).toBeInTheDocument()
    expect(within(screen.getByText('What it did').closest('section') as HTMLElement).getByText('treehacks.com/venue')).toBeInTheDocument()
  })
})

describe('the chosen venue on the map', () => {
  const other = liveSetup({ status: 'ready', modelUrl: '/blobs/abc123', sizeX: 120.4, sizeY: 14, sizeZ: 60.2 })

  it('keeps the Palace when it is chosen or nothing is', () => {
    expect(chosenModelOf(DEFAULT_SETUP_ID, null)).toBeNull()
    expect(chosenModelOf(DEFAULT_SETUP_ID, other)).toBeNull()
  })

  it('keeps the Palace until the chosen search has a model', () => {
    expect(chosenModelOf('7', liveSetup())).toBeNull()
    expect(chosenModelOf('7', liveSetup({ status: 'no model' }))).toBeNull()
    expect(chosenModelOf('8', other)).toBeNull()
  })

  it('draws a ready venue by its own box, margin included', () => {
    expect(chosenModelOf('7', other)).toEqual({
      setupId: '7',
      venueId: 'setup-7',
      url: '/blobs/abc123',
      venueName: 'Huang Engineering Center',
      eventName: 'Tree Hacks 2027',
      width: 120.4 + 2 * MODEL_MARGIN,
      height: 60.2 + 2 * MODEL_MARGIN,
    })
  })

  it('places the Palace exactly as before', () => {
    expect(palacePoint(3, 2, -5)).toEqual({ x: 5 + 50.84 + 8, y: 3 + 106.57 + 8, h: 2 })
  })

  it('puts another venue on the plan from its low corner, floor at zero', () => {
    const min = { x: -60, y: -0.5, z: -30 }
    expect(boundsPoint(-60, -0.5, -30, min)).toEqual({ x: MODEL_MARGIN, y: MODEL_MARGIN, h: 0 })
    expect(boundsPoint(60, 13.5, 30, min)).toEqual({ x: 120 + MODEL_MARGIN, y: 60 + MODEL_MARGIN, h: 14 })
  })
})
