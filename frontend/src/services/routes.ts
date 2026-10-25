/**
 * Provisional REST and WebSocket routes for the Rust backend. They are not confirmed yet; change
 * them here and nowhere else. See docs/BACKEND_INTEGRATION.md for the payloads.
 */
export const routes = {
  state: '/v1/state',
  stream: '/v1/stream',
  acknowledge: (incidentId: string) => `/v1/incidents/${encodeURIComponent(incidentId)}/acknowledge`,
  resolve: (incidentId: string) => `/v1/incidents/${encodeURIComponent(incidentId)}/resolve`,
  previewGuidance: '/v1/guidance/preview',
  approveGuidance: (commandId: string) => `/v1/guidance/${encodeURIComponent(commandId)}/approve`,
  cancelGuidance: (commandId: string) => `/v1/guidance/${encodeURIComponent(commandId)}/cancel`,
  resendGuidance: (commandId: string) => `/v1/guidance/${encodeURIComponent(commandId)}/resend`,
  demo: (action: string) => `/v1/demo/${action}`,
} as const
