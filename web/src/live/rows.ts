// The live run's rows as the page reads them, and the module's time in the page's clock.

import type { Timestamp } from 'spacetimedb';
export type { Band, BandPlace, Claim, Decision, IncidentMarker, LiveRun, VenueSpot } from '../module_bindings/types';

/** A timestamp in milliseconds since the epoch, as `Date.now()` counts. */
export function ms(t: Timestamp | undefined): number {
  return t ? Number(t.microsSinceUnixEpoch / 1000n) : 0;
}
