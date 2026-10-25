/** The organizer's Kibana desk: the jobs the Elastic project does, and the host's Kibana address. */
import { create } from 'zustand'
import { HOST_FALLBACK, loadHostConfig, type HostConfig } from './host'

export const useHost = create<{ host: HostConfig | null }>(() => ({ host: null }))

/** Reads the host's config.json once, for the Kibana address. */
export async function loadDeskHost(): Promise<HostConfig> {
  let host: HostConfig
  try {
    host = await loadHostConfig()
  } catch {
    host = HOST_FALLBACK
  }
  useHost.setState({ host })
  return host
}

export interface KibanaJob {
  job: string
  what: string
  views: readonly (readonly [label: string, path: string])[]
}

export const KIBANA_INTRO = {
  title: 'Kibana',
  text: 'Search, pipelines and claim checks. Every view opens in the Elastic project.',
} as const

/** Each job the Elastic project does, with the Kibana views that show it. */
export const KIBANA_JOBS: readonly KibanaJob[] = [
  {
    job: 'Event import',
    what: 'Scraped event data joined, deduplicated and loaded in one transaction.',
    views: [
      ['Scrape pipeline', '/app/dashboards#/view/bandit-pipeline-calhacks-13'],
      ['Sponsors and prizes', '/app/dashboards#/view/bandit-event-calhacks-13'],
      ['bandit-organize runs', '/app/workflows/bandit-organize'],
      ['bandit-organizer agent', '/app/agent_builder/agents/bandit-organizer'],
    ],
  },
  {
    job: 'Radio log',
    what: 'Every packet from bands, stations and cameras, kept for after the event.',
    views: [['Band radio and photos', '/app/dashboards#/view/bandit-radio']],
  },
  {
    job: 'Recap ranking',
    what: 'Attendee suggestions ranked against their interests.',
    views: [['Recap suggestions', '/app/dashboards#/view/bandit-recap']],
  },
  {
    job: 'Documents',
    what: 'Quoted facts extracted from policies and reports.',
    views: [
      ['Document runs', '/app/workflows/bandit-read-document'],
      ['Document reader agent', '/app/agent_builder/agents/bandit-document-reader'],
      ['Task runs', '/app/workflows/bandit-run-task'],
    ],
  },
  {
    job: 'Claim evidence',
    what: 'Claims checked against venue and attendee policies.',
    views: [
      ['Claims dashboard', '/app/dashboards#/view/bandit-claims'],
      ['Investigation runs', '/app/workflows/bandit-investigate-claim'],
      ['Claim investigator agent', '/app/agent_builder/agents/bandit-claim-investigator'],
    ],
  },
  {
    job: 'Payment rules',
    what: 'Payout ceilings proposed from approved claims.',
    views: [
      ['bandit-propose-rule runs', '/app/workflows/bandit-propose-rule'],
      ['bandit-rule-proposer agent', '/app/agent_builder/agents/bandit-rule-proposer'],
    ],
  },
]

/** `${kibana_url}${path}`, as the dev portal builds it. A trailing slash on the address is dropped. */
export function kibanaHref(kibanaUrl: string, path: string): string {
  return `${kibanaUrl.replace(/\/+$/, '')}${path}`
}
