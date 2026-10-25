import { create } from 'zustand'
import type { GuidanceCommand, Incident, StreamEvent, WorldSnapshot } from '@/contracts/domain'
import { applyEvents, emptyWorld, fromSnapshot, isNewerCommand, isNewerIncident, type WorldData } from './reducers'

interface WorldActions {
  applySnapshot(s: WorldSnapshot): void
  applyEvents(events: StreamEvent[]): void
  /** Apply the backend's reply to a command, unless a newer event already moved it on. */
  mergeIncident(incident: Incident): void
  mergeCommand(command: GuidanceCommand): void
  clear(): void
}

export type WorldStore = WorldData & WorldActions

/** Relatively stable domain state: venue, zones, devices, incidents, commands. */
export const useWorld = create<WorldStore>()((set) => ({
  ...emptyWorld,
  applySnapshot: (s) => set(fromSnapshot(s)),
  applyEvents: (events) => set((state) => applyEvents(state, events)),
  mergeIncident: (incident) =>
    set((state) =>
      isNewerIncident(state.incidents[incident.incidentId], incident)
        ? { incidents: { ...state.incidents, [incident.incidentId]: incident } }
        : state,
    ),
  mergeCommand: (command) =>
    set((state) =>
      isNewerCommand(state.commands[command.commandId], command)
        ? { commands: { ...state.commands, [command.commandId]: command } }
        : state,
    ),
  clear: () => set({ ...emptyWorld }),
}))
