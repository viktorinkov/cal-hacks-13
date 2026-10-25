## Medic routing

When an attendee falls or holds SOS, their band strobes red, and every band near enough to hear it at -58 dBm pulses blue. That light circle shows the medic where to go, and it works with the venue laptop offline.

Within half a second, `watch_bands` in the module opens the incident. In the same transaction it freezes a snapshot of the zone and records the bands in the light circle as witnesses.

A medic takes the incident with "Take it" in the organizer portal (/organizer, Claims). Tapping the attendee's band opens their medical card on the tap page (/t/code), with the same button. Organizers do not dispatch medics, because the medic knows whether they are free.

The organizer portal (/organizer, Live) draws the medic walking in from the nearest door. The route follows the aisles on a 25 cm grid of the real venue floor, found with an A* search, and the medic stops 1.4 m from the attendee.

Medics wear no bands, so the walk is the route in, not a tracked position. The page works it out from the time the medic took the incident, stored in the module's `incident_marker` row, so every open screen shows the medic at the same spot.

The crowd walks the same floor grid with the same search inside the module. Anyone within 3 m of the attendee lights the circle and steps back to 4.2 m.

In the live run, `bandit-claims live` plays the medic. It takes each incident 12 to 20 seconds after it opens and resolves it 10 to 15 seconds later.

Resolving sends the band a clear command. The incident's snapshot, witnesses and medic notes become the claim's evidence when the attendee files.

When the doors close, everyone walks to the nearest exit. An attendee who is down stays until the medic is done, and the doors wait up to 2 minutes for that.
