# Devpost features missing in code

Checked devpost.md (project-files copy of 05:16 UTC) against vik-e2e at 17e8b34, plus the firmware on origin/firmware. Six read-only audits, one per Devpost part. About 310 claims hold up. The lines below do not.

Already in their own threads, so left out: the hospital_report reader, rule proposals in an Elastic agent, hybrid and rerank search, plan and venue checks in the reader, and the theft and venue-property rework.

## Features to build, best first

1. **Camera sighting for falls and SOS.** pipeline/security.py finds the 4 Hz flash but never calls the module. No `report_camera_sighting` exists on any branch. The live run sends camera sightings only for property, and `report_property_event` refuses injuries. So no injury claim ever gets camera evidence (Devpost L69, L115, L423, L524). Medium. Vision is Leo's, so the module side and a call from security.py need him in the loop.
2. **Policy terms enforced in code.** `other_insurance` (primary or excess) is stored but never changes who pays. Only the staff exclusion is enforced; pre_existing, off_premises and care_custody_control reach Claude only if the clause search returns them. Claude's policy summary is fixed text, not the confirmed terms (insurance/flow.rs:479). Devpost L97, L99. Medium.
3. **Scorecard results on a page.** The scorecard (straight-through rate, dollars wrongly paid, precision, recall) runs only as a CLI (bandit-claims/src/scorecard.rs). No numbers are published and no page shows them. Hyphenate asks for proof it works; Microsoft asks for measurable usefulness (L664, L775). Medium.
4. **"Also there with you" complete.** It skips the crowd of 1,000 (social/tick.rs:134), shows no shared interests (recap.ts:166) and is not ranked by interests (summary.rs:447). Devpost L233, L241, L363, L725, L847, L863. Small to medium. Touches the same files as the hybrid and rerank thread.
5. **Interests for real and test bands.** Radio and test bands open stays with booth_id 0 (ingest.rs:65, 203), so a judge wearing a band gets no interests and no shared count. "Booths you spent time at" lists every booth in every zone you entered (summary.rs:386). Devpost L225, L229, L239. Medium.
6. **Exit guidance as described.** The low-visibility button sends one `lowvis` that only speeds the chase; bands that are not already red never guide (band.cpp currentState). Each band circles exit 1's blue, since exitIdx is never set from the loudest station and `set_exit` is never called. zones.json gives 3 of 5 zones no exit colour. The crowd on the Live tab ignores low_vis (crowd.rs:1235). The button also shows for medics, whom the reducer refuses. Devpost L27-37, L490. Small, but every band needs reflashing.
7. **Alert on the medic's phone.** There is no sound, vibration or notification. The alert is only a list on the portal's Live tab (L45). Small to medium, in web/.
8. **SOS-to-medic time, measured.** Measure from an SOS press to the incident on the medic's phone while the Live tab's crowd of 1,000 runs, and quote it for "instant". Small.
9. **A way in for judges.** Both organizer pages need a staff email the owner added (organizer.ts:195, roles.rs:93). Try it out gives judges no way in. Small; needs Viktor's call on how (shared judge login or open read-only).
10. **SOS and the light circle on top.** In band.cpp currentState, the near-SOS circle ranks below PAY, PAID, FOUND_ME, FIND and CONNECT, and SOS below IDENT (L43). Small, firmware.
11. **Live tab figures in their ring colour.** Bands 1-99 are always drawn blue (crowd-3d.ts OURS_COLOUR), never green, amber or red (L77). Small.
12. **Every incident marked.** Rings and beams show only during a live run and only for incidents opened after it started (live-run.ts:299). A real SOS with no run gets no ring (L81). Small.
13. **Medical card rules.** View as opens anyone's card with no medical_access_log row (medical/mod.rs:247). Blood type and notes are kept without a page check (medical.rs check()). Devpost L49, L57, L502. Small.
14. **Your own plan in injury claims.** `attendee_policy_hash` stays empty unless the cover is personal_property (flow.rs:274), so a health plan found at sign-up is never searched (L133). Small.
15. **Photo cards with names, handles and interests.** who() shows names only (recap.ts:204). Devpost L251, L265. Small.
16. **Claim number on the wallet payout.** The memo has it, but recap.ts:300 shows "Paid in for your claim" (L299). Small.
17. **Rerun the shopping agent for someone who left.** `rerun_shopping_agent` refuses until the whole event ends (merch/mod.rs:420), L281. Small.
18. **"Leave the event" always reachable.** It is only on the last setup screen (t.ts:327); after a reload a skipped step hides it (L227). Small.
19. **Replay a run by its seed.** The Live tab always sends seed 0, so every run is random, and there is no replay (live-run.ts:362), L329, L929. Small.
20. **Bridge bindings regenerated.** spacetimedb/bridge/src/module_bindings dates from Oct 23 and still has payment tables the module dropped (L602). Small.
21. **Bright Data for every sponsor.** sources.json has LinkedIn for 41, Crunchbase for 4 and Maps only for the venue, of 62 organizations (L337). Medium to scrape the rest, or reword.

Two more belong to existing threads: the hospital report as a real PDF with an itemized bill goes to the hospital_report thread (today Claude writes plain text, clinic.rs render_text). The ACORD 1 property notice still has ACORD 3 headings and the letters prompt always says ACORD 3 (letters.rs:162, prompts.rs:110); that is the theft and venue-property thread's area.

## Flags for Viktor, not built

- **band1t.vip/organizer is now Eddie's desk** (deploy/setup.sh, his commits of Oct 24 22:21-22:30). Viktor's portal moved to band1t.vip/portal and stays at dev.band1t.vip/organizer. The desk has no Live tab, View as, Proposed rules, Venue setup or Kibana tab. Its crowd runs in the browser, so viewers don't share one run. Its control panel is labeled with a word the project bans. It does not show Claude's claim steps. Try it out (L917) and about ten other lines send judges there. Fix the Devpost links, and tell Eddie about the wording and the browser crowd.
- **Claude's steps syncing live is real**, on Viktor's portal. The worker sends each step through `report_claim_step` into the public `decision` table, and the portal subscribes to it (organizer.ts:52, evidence-trail.ts:157, live-run.ts:468). Eddie's desk and the tap page don't subscribe.
- **"A bug in a web page cannot show one person's row"** (L566-578) is untrue: encounter, zone_visit, departure, incident_marker, decision (with medic notes) and live_plan are public. The project rules say no privacy work beyond the README, so reword the Devpost instead of closing them.
- **README features that neither the Devpost nor the code has:** bands around a faller vibrating and flashing red, a compass pointing the way to disperse, steering people out of a medic's path, and cameras tracking crowded areas. The Devpost chose a blue pulse with no vibration.
- Low value, skip: a released band's old link starts a new claim; the stale-screen approval fails closed only in the CLI.

## Devpost wording fixes (for the Devpost threads)

- Module counts are 101 tables, 131 reducers and 75 views, not 93, 114 and 65 (L469, L602). The 6 timers are right.
- L385: code alone refuses only the staff exclusion. No cover and over-limit claims go to the organizer, as L409 says.
- L389: a duplicate bill goes to the organizer only when Claude would pay; Claude may refuse on it.
- L407: $5,000 and $25,000 are the medical limits. Property is $10,000 and $50,000 with a $500 deductible.
- L413: billed, not covered and deductibles come from claim rows, not only journals.
- L437: the camera takes the strongest flash in the whole frame, with no zone filter.
- L349: the LOOKUP JOINs match on domain and room-to-zone; booths are placed in Rust from booths.json.
- L558: `crowd_tick` moves the crowd every 2 s; `live_tick` stages incidents.
- L560: the script opens incidents directly; `watch_bands` skips crowd bands.
- L327: an outside process (bandit-claims live) plays the medic, clinic, camera and costs; the medic's walk is drawn by the page.
- L510: the tab is Settlements, not Claims. L103: the button says "Ask the venue to pay".
- L153: "$150.00 for Jordan Alvarez (claim 4)" comes from a test with a $150 limit; it contradicts $5,000 and the $895 paid in full.
- L245: up to 20 people are tagged after Claude counts, not eight.
- L201: say "one tap from" Instagram, Facebook and Threads; BandIt only links profiles.
- L727, L865: no drone or quadcopter booth exists in the event data; use a real booth pair.
- L912: Gemini is not in the code; keep it only if the merch images were made in Gemini by hand.
- devpost.md's closing section on what is scripted should add: the crowd's time together runs 6x the clock (crowd.rs TOGETHER_SPEEDUP), and a Live run is a 12-minute night.
- L777 "every limit comes from the venue's own policy": a term that fails keeps the default, and the fee schedule has a default.
- L721 says "the workflow and the agent"; there are two of each.
- L75 "every door": only the 4 exits have markers. L87 "press": an SOS needs a 3 s hold. L85 lets staff open a card; L57 says only medics.
- L117: the Evidence Engine reads the report (true once the hospital_report move lands).
- L11: "Council", "15.6M", "We built", and one spelling of the name.
- Docs drift: Vision.md and SpacetimeDB.md say Claude judges camera sightings; Test-Bands.md puts the scorecard on the Claims queue; crates/bandit-claims/README.md lists approve flags that no longer exist.
