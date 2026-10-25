# Evacuation visual evidence

Checked on 2026-10-25 against fetched `origin/vik-e2e`, commit `219d48e079651fc5851e32cf0cb172eebededa57`. Line numbers below refer to that commit, not an uncommitted checkout.

Current title: **Fire evacuation**

Proposed caption: **The organizer starts an evacuation. People follow venue paths to exits while medics finish helping injured attendees. Those attendees leave once their incident is resolved.**

Use a compact product illustration with two branches: the crowd heading to exits, and a medic helping an attendee before that attendee leaves. This describes the implemented event model; it is not evidence of a real evacuation.

| Claim | Exact code evidence |
| --- | --- |
| The organizer starts the evacuation. | `web/src/live-run.ts:359–363` renders the Evacuate control and calls `evacuateLiveRun`. `spacetimedb/server/src/live/mod.rs:379–395` requires the ops role, records evacuation state and calls `head_for_exits`. |
| The crowd heads toward nearby exits. | `spacetimedb/server/src/social/crowd.rs:364–365` chooses the nearest exit by straight-line distance. Lines `887–913` choose a door for each team and start its members walking there. |
| People follow the loaded venue's walkable paths. | `spacetimedb/server/src/social/crowd.rs:219` loads the floor. Lines `234–248` use its pathfinder for the team and each member. `spacetimedb/server/src/social/walks.rs:72–86` routes legs around obstructions. Without a loaded floor, the fallback is a straight line (`walks.rs:75`). |
| People with an open SOS or fall stay for help. | `spacetimedb/server/src/live/mod.rs:224–228` treats unresolved SOS and fall markers as down. `spacetimedb/server/src/social/crowd.rs:905–910` excludes them from exit walks; lines `1194–1202` keep them at the incident location. |
| Once the incident is resolved, they leave too. | `spacetimedb/server/src/safety/mod.rs:515–530` permits ops or medic to resolve the incident. `spacetimedb/server/src/live/log.rs:195–196` updates its marker. `spacetimedb/server/src/social/crowd.rs:1147–1157` starts the recovered person's walk toward their team's destination, which the evacuation set to an exit. Lines `1180–1181` mark them outside after arrival while the venue is evacuating or closing; `live/mod.rs:208–209` defines that condition. |

Claims to avoid: a safest or congestion-optimized exit; a separate nearest-exit calculation for every attendee; medical judgment about when a real person can walk; verified delivery of evacuation directions to physical wristbands; or a claim that this illustration is a live evacuation screenshot. The implemented crowd model selects each team's nearest door and continues its existing medical-response flow.

## Fire context

The current reducer explicitly describes this evacuation as suitable for a fire or another emergency (`spacetimedb/server/src/live/mod.rs:375–377`). The portal action is the organizer selecting **Evacuate** and confirming the prompt (`web/src/live-run.ts:361–363`). The visual names this scenario while preserving that manual trigger. It does not add a detector, a fire location, smoke-aware routing or an automated alarm.

The earlier approved title and image are preserved in `checkpoints/before-fire-title/`. The rendered SVG and JPEG remain behavior illustrations, not application screenshots.
