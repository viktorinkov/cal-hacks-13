import type {
  CameraOutcome,
  ConnectionState,
  EntityFrame,
  GuidanceCommand,
  GuidancePreviewRequest,
  Incident,
  ResolutionReason,
  StreamEvent,
  WorldSnapshot,
} from '@/contracts/domain'

export type Unsubscribe = () => void

/**
 * The only way the interface talks to a backend. LiveBackendAdapter speaks HTTP and WebSocket to
 * the Rust service; MockBackendAdapter drives the in-browser simulator. Components never import an
 * adapter directly; they go through the stores and operatorCommands.
 *
 * Every command resolves with the backend's authoritative copy of what changed, or rejects. A
 * resolved promise means the backend accepted the command, not that a band has acted on it: band
 * acknowledgements arrive later as guidance events.
 */
export interface BackendAdapter {
  readonly kind: 'mock' | 'live'
  readonly label: string
  start(): void
  dispose(): void
  getInitialState(): Promise<WorldSnapshot>
  subscribeToEvents(cb: (event: StreamEvent) => void): Unsubscribe
  subscribeToFrames(cb: (frame: EntityFrame) => void): Unsubscribe
  subscribeToConnection(cb: (state: ConnectionState) => void): Unsubscribe
  acknowledgeIncident(incidentId: string): Promise<Incident>
  resolveIncident(incidentId: string, reason: ResolutionReason): Promise<Incident>
  previewGuidance(request: GuidancePreviewRequest): Promise<GuidanceCommand>
  approveGuidance(commandId: string): Promise<GuidanceCommand>
  cancelGuidance(commandId: string): Promise<GuidanceCommand>
  resendGuidance(commandId: string): Promise<GuidanceCommand>
  resetSimulation(): Promise<void>
  /** Presentation controls. Null when no authorised presentation service is available. */
  readonly demo: DemoControls | null
}

export type DemoCapability =
  | 'triggerCongestion'
  | 'pressSos'
  | 'suspectFall'
  | 'setCameraOutcome'
  | 'setFlakyRadio'
  | 'setLinkDown'
  | 'setPlaying'
  | 'setSpeed'
  | 'setAutoplay'

export interface DemoControls {
  /** Which controls this presentation service supports; the panel hides the rest. */
  readonly capabilities: ReadonlySet<DemoCapability>
  triggerCongestion(): Promise<void>
  pressSos(deviceId?: string): Promise<void>
  suspectFall(deviceId?: string): Promise<void>
  setCameraOutcome(outcome: CameraOutcome): Promise<void>
  setFlakyRadio(on: boolean): Promise<void>
  /** Simulate losing the connection between this browser and the backend. */
  setLinkDown(on: boolean): Promise<void>
  setPlaying(on: boolean): Promise<void>
  setSpeed(speed: number): Promise<void>
  setAutoplay(on: boolean): Promise<void>
}

export class BackendError extends Error {
  readonly code: string
  readonly status?: number
  constructor(code: string, message: string, status?: number) {
    super(message)
    this.name = 'BackendError'
    this.code = code
    this.status = status
  }
}
