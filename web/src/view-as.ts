// The owner's View as: a person's own pages in a frame, live with their data and read-only. The
// organizer portal's View as tab uses it; any owner page that picks a person can too: call
// serveViewers(conn) once, then put an iframe at viewUrl(person, screen) for a screen from screens(person).
// The organizer portal also opens a person straight away at /organizer#viewas/<identity hex>.

import { Identity } from 'spacetimedb';
import { bandCode } from './band-code';
import type { DbConnection } from './module_bindings';

/** A person to view as, from the module's `view_as_people`. */
export type Viewed = { identity: Identity; role: string; bandId: number };

/** The screens a person sees, as [hash, label]: attendees their band page, photographers /photo, staff the portal. */
export function screens(p: Viewed): [string, string][] {
  if (p.role === 'attendee') return [['now', 'Their band page now'], ['card', 'Medical card'], ['recap', 'Recap and merch']];
  if (p.role === 'photographer') return [['now', 'Photo page']];
  return [['claims', 'Organizer portal']];
}

/** The page a screen shows, for the frame's src. An attendee without a band has no band page. */
export function viewUrl(p: Viewed, screen: string): string {
  const view = `?view=${p.identity.toHexString()}#${screen}`;
  if (p.role === 'attendee') return `/t/${bandCode(p.bandId)}${view}`;
  return p.role === 'photographer' ? `/photo${view}` : `/organizer${view}`;
}

/** Lets the frames on this page point their viewer at a person through this owner's connection. */
export function serveViewers(conn: DbConnection) {
  (window as any).banditViewAs = (viewer: string, person: string) =>
    conn.reducers.viewAs({ viewer: Identity.fromString(viewer), target: Identity.fromString(person) });
}
