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
  title: 'Elastic, the Evidence Engine',
  text: 'The Evidence Engine organizes and validates data and searches it by meaning. The Decision Engine reviews claim evidence and recommends outcomes. Code checks each recommendation against the policy and approval rules before settlement. Each view opens in Kibana, signed in to the Elastic Cloud project.',
} as const

/** Each job the Elastic project does, with the Kibana views that show it. */
export const KIBANA_JOBS: readonly KibanaJob[] = [
  {
    job: 'Before the event: organizing the scraped event data',
    what: "Bright Data scraped the event pages and the sponsors' company profiles into raw indices. The workflow bandit-organize joins the exact matches with ES|QL LOOKUP JOIN, and the agent bandit-organizer resolves the rest and gives a reason for every merge. Rust checks the bundle and loads it into SpacetimeDB in one transaction: the venue, zones, sponsors, booths and schedule on the other tabs.",
    views: [
      ['Scrape pipeline: raw records, merges and the reason for each', '/app/dashboards#/view/bandit-pipeline-calhacks-13'],
      ['Sponsors and prizes: what the scrape found', '/app/dashboards#/view/bandit-event-calhacks-13'],
      ['bandit-organize runs, step by step', '/app/workflows/bandit-organize'],
      ['bandit-organizer, the agent and its tool calls', '/app/agent_builder/agents/bandit-organizer'],
    ],
  },
  {
    job: "During the event: the bands' radio log and the photos",
    what: "The venue laptop records every packet the gateway hears from the bands and the station markers: zone, battery, SOS, fall and button presses, and the signal strength of every band nearby. It also records every photo's camera, time and place, never the image. The log is kept for after the event; nothing live reads it, since the Map tab comes from SpacetimeDB.",
    views: [['Band radio and photos', '/app/dashboards#/view/bandit-radio']],
  },
  {
    job: "After the event: ordering the recap's suggestions",
    what: "SpacetimeDB supplies the people and booths eligible for each recap. Elastic combines keyword and meaning searches, then reranks the results against the attendee's interests.",
    views: [["Recap suggestions: each attendee's latest ranking next to the minutes order", '/app/dashboards#/view/bandit-recap']],
  },
  {
    job: 'Documents and other model tasks',
    what: 'The document reader extracts quoted facts from policies and hospital reports. Separate workflows handle medical cards, images, letters and recommendations. Rust checks each result before saving it.',
    views: [
      ['Document reading runs', '/app/workflows/bandit-read-document'],
      ['Document reader and its page tools', '/app/agent_builder/agents/bandit-document-reader'],
      ['Text extraction, drafting and recommendation runs', '/app/workflows/bandit-run-task'],
    ],
  },
  {
    job: 'Claims: checking the evidence',
    what: 'Elastic checks claim copies without names and searches the venue and attendee policies for relevant clauses. The investigator requests evidence through Rust workers, which restrict every request to the claim. Code enforces policy amounts and approval rules before settlement.',
    views: [
      ['Claims evidence: validation, outcomes and approved amounts', '/app/dashboards#/view/bandit-claims'],
      ['Claim investigation runs', '/app/workflows/bandit-investigate-claim'],
      ['Claim investigator', '/app/agent_builder/agents/bandit-claim-investigator'],
    ],
  },
  {
    job: "Claims: proposing payment rules from the organizer's approvals",
    what: 'After three claims of one kind receive organizer approval, the rule proposer suggests their highest payout as the ceiling. Code checks the cited claims, enforced scope and ceiling. Future claims can use the rule only after the organizer approves that scope.',
    views: [
      ['bandit-propose-rule runs, step by step', '/app/workflows/bandit-propose-rule'],
      ['bandit-rule-proposer, the agent and its counts', '/app/agent_builder/agents/bandit-rule-proposer'],
    ],
  },
]

/** `${kibana_url}${path}`, as the dev portal builds it. A trailing slash on the address is dropped. */
export function kibanaHref(kibanaUrl: string, path: string): string {
  return `${kibanaUrl.replace(/\/+$/, '')}${path}`
}
