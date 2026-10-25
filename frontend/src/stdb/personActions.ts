import { linkReducers } from './link'
import { useRun, type RunAttendee, type RunState } from './runOps'
import { useSession } from './session'

export type CrowdAction = 'injury' | 'theft'

export function personActionUnavailable(person: RunAttendee, run: RunState): string {
  if (!person.crowd) return 'Actions are available only for the test crowd.'
  if (!run.linked) return 'Waiting for the event connection.'
  if (!run.bands.some((band) => band.id === person.bandId && band.hasPosition)) return 'This band has no recorded place.'
  const open = new Set(run.incidents.map((incident) => incident.id))
  if (run.incidents.some((incident) => incident.subjectBand === person.bandId)
    || run.plans.some((plan) => plan.culpritBand === person.bandId && open.has(plan.incidentId))) {
    return 'This person already has an open incident.'
  }
  return ''
}

export async function stagePersonAction(bandId: number, action: CrowdAction): Promise<void> {
  const session = useSession.getState()
  if (!session.owner && !session.roles.includes('ops')) throw new Error('Only an organizer can choose a bot action.')
  const run = useRun.getState()
  const person = run.attendees.find((item) => item.bandId === bandId)
  if (!person) throw new Error('This band has no named attendee.')
  const reason = personActionUnavailable(person, run)
  if (reason) throw new Error(reason)
  if (action !== 'injury' && action !== 'theft') throw new Error('Choose an injury or theft action.')
  await linkReducers<{ stageCrowdAction(args: { bandId: number; action: string }): Promise<unknown> }>().stageCrowdAction({ bandId, action })
}
