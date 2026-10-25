# Handoff

This file is for the coding agent that takes over Band1t (the repo still says BandIt in many places) when the Claude setup stops. It holds only what the repository does not already say: Viktor's standing rules from outside the repo, his decisions from the chats, the work that was unfinished at handoff, the steps that only work on Viktor's Mac, where the credentials live, and the research. For how the system works, read the files under "Read first". Do not copy their content into this file.

Snapshot: 2026-10-25 07:15 UTC, vik-e2e at `86060eb` plus this file, deployed on band1t.vip. Refresh it right before the handoff with the steps in the last section.

## Verified follow-up, 25 October 2026

- Elastic migration and explicit rule-scope review are deployed in `5029dca9414c1d4b665c1353992b6be1764dd9f2`, verified at 10:03:25 UTC. Worker model tasks use Elastic Workflows and Agent Builder, with Claude as a configured model. Older narrower-looking rules require explicit review; the automated runner cannot grant that approval. Eddie's latest frontend changes were preserved.
- The [main Plus board](https://app.excalidraw.com/s/8CxNdcrvsHz/65Xc8JRcGo5) now has all 32 distinct frames, verified online: dedicated sponsor/API integrations connect to feature journeys, claims have separate settlement/amount/rule diagrams, and all hardware/vision detail remains on this board. The current readability revision is verified online: 1,956 active elements, 32 frames, 213 images and 44 assets. Descriptive property cells are nested inside their parent cards; the user’s small station-position adjustment is preserved. The separate claims scene is a saved checkpoint only. See [saved versions](diagrams/HISTORY.md), [all 75 views](diagrams/views.md), and the [current gap audit](handoff/research/audits/diagram-review-2026-10-25.md).
- Policy amounts now contains a published, verified inset showing a calculated split: $895 covered care, $55 plan copay, $840 health-plan share and $55 venue-cover payout. It assumes excess cover and both payout limits at least $55. The formulas are unchanged and the inset is not a separate frame; calculated shares are not proof of external plan payment.
- Earlier diagram reduction: 21 distinct titles were retained on the same board. Interest suggestions, Buy a memory and Exit guidance move to existing Devpost prose, with their feature facts and the saved 24-frame source retained. The rule presentation drops historical repair detail and a repeated decision lane; code approval guards are unchanged. This reduction is published and verified on the canonical Plus board.
- The published 24-frame product-flow consolidation adds Fire evacuation, How your photos find you and Your photo on your merch alongside the existing technical diagrams. The existing response diagram remains; no extra medic diagram is added. Supplied source boards and three original photo illustrations are preserved. Canonical Plus synchronization passed exact readback verification.
- The published 26-frame revision has explicit purposes: Elastic claim investigation, Find policy documents, Prepare the event and Capture a public venue map. Existing Routes and clear space content is partitioned into Medic route display and Crowd clearance without new medic artwork. Architecture names search and model tasks, friend search names candidate ranking, and Memories engine names photo analysis; claim-specific Evidence Engine wording remains. Finance and firmware colors are unchanged. Canonical Plus verification passed exact readback.
- The 26-frame board remains a historical reviewed checkpoint. Its provider, discovery, SpacetimeDB and crowd-presentation refinements are included in the 29-frame revision.
- The 29-frame reader/finance revision is published and verified: separate SpacetimeDB live-update and subscription diagrams, an external Claude provider, consolidated public-source discovery, and three explicit charge/receipt/cost flows. Make space for help replaces the scripted crowd drawing with people noticing band alerts and stepping aside; it does not claim automatic physical movement. Firmware changes were palette-only at that checkpoint; the following readability revision completes the split. Canonical Plus API readback, independent saved-result review and native browser checks passed.
- The 32-frame readability revision explains subscription rows and access conditions, places the live-lease guard at result application, and separates server jobs from the band-command lifecycle. Three compact firmware diagrams preserve the approved incident, helper and exit behavior with distinct fills and unchanged signal colors. These are presentation corrections; runtime and hardware code are unchanged. Canonical Plus readback and independent review passed.
- Viktor confirmed that Leo created the supplied hardware drawing and is still implementing it. Preserve that approved design and the unchanged original hardware source. Fetched firmware differences are implementation gaps owned by Leo, not a reason to weaken the drawing.
- Organizer-triggered full event import is deployed in `ec63ce0` and verified end to end: import 1 reached Ready and job 852 reached Done on its first attempt, creating exactly one import run. Existing IDs, zone mappings and financial/rule state were preserved. Server workers run the importer. An organizer does not run it on a laptop; venue discovery/map setup is a separate organizer action.
- Typed friend search `517c63d` is deployed (10:31:21 UTC) and verified in an authenticated production browser at [band1t.vip/friends](https://band1t.vip/friends). It uses recorded, findable encounters and named-place evidence before Elastic ranks eligible candidates. Automatic suggestions separately use booth interests; interest similarity is never proof of a meeting.
- Latest checkout decision: catalog purchases are available during and after the event. Personalized recommendations remain tied to departure or event end. Commits `530820a` and `8b63c89` implement this intentional scope; do not restore an event-end gate to catalog checkout.
- `devpost.md` received targeted corrections and independent review. It remains intentionally untracked. The older snapshot and unfinished-work lists below are historical context; check the current audit and code before treating an item as still open.

## Read first

| File | What it gives you |
| --- | --- |
| `README.md` | the product and its happy path, the reference for every feature. Viktor's own file: never edit it (his Mac copy starts with a line that says AI must not edit it) |
| `AGENTS.md` | agent rules. Codex loads it |
| `CLAUDE.md` | the Git and wording rules. Codex does not load it, so its rules are repeated under "Standing rules" |
| `System Design/README.md` | terms, folder map, reading order. Each component file ends with its Decisions table, and `1-overview/Decisions.md` is the decision log |
| `scripts/e2e/README.md` | how to start everything, publish the module, set up the database and walk the happy path |
| `LINKS.md` | the live links, band codes, Kibana dashboards and the current Excalidraw board link |
| `deploy/setup.sh`, `deploy/autodeploy.sh`, `scripts/deploy-vm` | the Vultr VM, Caddy (band1t.vip and dev.band1t.vip), systemd and the auto-deploy of vik-e2e |
| `deploy/cloud-setup.sh` | the old Claude cloud environment, useful if you build a Linux environment for Codex |
| `frontend/README.md` | Eddie's desk (the command center) |
| `diagrams/generator/LABELS.md`, `handoff/research/devpost/TERMS.md` | the wording rules for diagrams and for the Devpost |

## What the Claude setup did that you now do yourself

Claude sessions ran the SessionStart hooks in `.claude/hooks/`, and a coordinator session told each thread what to do. Codex runs neither.

1. In every clone and worktree, before the first commit:

   ```sh
   git config user.name "Viktor Minchev"
   git config user.email vikitominchev@gmail.com
   git config core.hooksPath .githooks
   ```

   `.githooks/commit-msg` then rejects any message or author that points at Claude or Codex.
2. Credentials are already in place on the Mac. On a fresh Linux machine, see "Credentials".
3. After each push to vik-e2e, read https://band1t.vip/deploy/status.txt until it names your commit as deployed, then tell Viktor in one line. The coordinator used to do this.
4. `.claude/settings.json`, `.claude/hooks/` and `scripts/agent-permissions` are Claude Code permission settings. They do nothing for Codex. Leave them in place.

## Standing rules

These were the Claude project's instructions from Viktor, adapted for one agent. Nothing else in the repo holds them.

### Shipping and Git

- Shipping means merging into vik-e2e and pushing. The VM deploys each new vik-e2e commit within about 15 to 75 seconds. Check status.txt.
- Publish a Maincloud module change (`E2E_TARGET=maincloud scripts/e2e-publish`) before you push the commit that needs it. The services on the VM call the new reducers as soon as they deploy.
- Only vik-e2e publishes the module. Keep band1t.vip serving during wipes and redeploys.
- Each feature gets its own `vik-<feature>` branch, merged into vik-e2e with `git merge -m "merge <what it brings>" <branch>`. Push often.
- Commit and merge messages are one short line. No AI attribution anywhere: no Co-Authored-By, no "Generated with", no session links, and no AI named as an author in code comments or docs.
- Open pull requests with a title only and an empty body. Use git and gh directly (`gh pr create`, `gh pr merge --merge`). Merge, never rebase.
- PR #22 (vik-e2e into main) is the team's main PR. Merge teammates' PRs into vik-e2e, and open new PRs onto vik-e2e when needed. Keep #22 mergeable: vik-e2e builds, tests pass, band1t.vip runs the tip.
- The tests: `cargo test --workspace` at the repo root and `cargo test` in `spacetimedb/server` (the module is outside the workspace). At the snapshot, 288 and 78 passed.
- Verify a fact before you report it, for example that an env value is set or that code is on a pushed branch. When something blocks you, say what blocked you and what you need. Never infer the answer another way.

### Maincloud database `bandit-calhacks13-sp82j`

- Viktor authorizes publishing, running the setup scripts and writing data on it without asking. There are no real users and no data worth keeping.
- Publish in place. Never write migrations.
- Wipe only for a column type change. Before the wipe, save the `owner` and `staff_role` rows with `scripts/e2e-sql` (the Mac keeps earlier copies in `.dev/maincloud-*-before-*.txt`). Publish from vik-e2e with `--delete-data`, run `E2E_TARGET=maincloud scripts/e2e-setup`, then add each owner back with `scripts/e2e-owner <identity>` and each person's role with the `grant_role` reducer.

### The VM

- Viktor authorizes redeploying the Vultr server without asking. Push vik-e2e, or run `scripts/deploy-vm root@band1t.vip` from the Mac, which also updates the VM's `.env`. Never use the old sslip.io target.
- Run things yourself and show Viktor the result in his Chrome on the Mac (`open <url>`). Don't hand him commands or links to run.

### Product scope

- The README's happy path is the reference. Don't invent features. Bandshake was invented and removed.
- When you find a feature that seems missing, or want to suggest one, ask Viktor before you build it. Cameras, hardware and the crowd are scripted on purpose and are not missing features.
- If an existing feature seems far-fetched, ask Viktor. Never remove it on your own.
- Mostly happy paths. An edge case needs a reason, such as the insurance cases that the Hyphenate track looks for.
- No privacy or security work beyond what the README asks. Always show people's names.
- Random outcomes, such as whether a claim matches the insurance, come from a seeded random generator in code, never from a model.
- Decide technical questions yourself. Don't ask Viktor.
- IDs and similar choices stay reasonable. Band codes are 8-character Crockford Base32 with a check character.

### Design priorities

- Design before code. The System Design docs and the Excalidraw board show the intended behavior. Settle them first, then write the code to match.
- Updated on 2026-10-25: use one architecture overview, dedicated diagrams for major API integrations, and feature journeys that refer to those engines with their logos. Fold standalone Vultr hosting into architecture. Keep useful vision, wiring, firmware and transmitted-data detail on the same board; there is no fixed diagram-count limit. Keep each main actor, component or object as an outer card, with small filled property rectangles inside it. Only actual actors and workflow/calculation stages become separate process cards with arrows. Related formula inputs and conditions stay within their calculation group; descriptive properties must not become artificial process steps.
- SpacetimeDB is the most important sponsor, but show the unique strengths of both SpacetimeDB and Elastic. SpacetimeDB owns live state, transactional coordination and settlement authority. Updated by Viktor on 2026-10-25: Elastic owns suitable model execution, including the Decision Engine investigation. Bounded tasks use Workflows; retrieval and investigation use Agent Builder with worker-controlled tools and code guards. Claude may be the model behind Elastic's connector; it is not a separate direct-call decision layer.
- Elastic reads every insurance document: the venue's policy PDFs, each attendee's own policy PDFs and the medical records. Policy terms (minimum payout, limits, deductible) are per-event or per-attendee variables that drive the Decision Engine.
- Show the human in the loop (the organizer's review) clearly.
- Main focuses: the insurance and claims features (Hyphenate's track), merch, and Meta's track (connecting people, memories, photos).
- Functionality over looks for now.

### Wording

- Never write "demo", "simulated", "simulation", "sample" or "mock": not in code, identifiers, env vars, scripts, file or folder names, UI text, docs, the Devpost, commit messages or messages to Viktor. Say what the thing is: bands, test bands, attendees, the venue, the scripted run. Two exceptions: sponsor text quoted word for word, and the one closing section of devpost.md that lists what is scripted.
- User-facing UI never names the underlying tech (Elastic, SpacetimeDB, Claude, Kibana, Bright Data) unless the user needs the name to act. Staff pages may keep the names where they help, such as the Kibana links.
- No "or" alternatives and no open questions in docs.
- Explanations belong in the Devpost and the diagrams, not in the portal UI.

### Frontends

- Viktor's pages in `web/` stay quick and plain: the default browser style, no custom theme, rich in tables and buttons, just enough to drive and test the backend.
- `frontend/` is Eddie's. Leave changes there to him, and tell Viktor what you would change.

### The Mac

- Disk space is tight. Build with debug info off (already set in `Cargo.toml`), never leave files in `/private/tmp`, and delete Rust target folders and temp files when a build job ends.
- Work in the background. Never take over Viktor's screen without asking.

## Viktor's decisions and preferences from the chats

Taken from the project chat and the threads. Dates are 2026-10-24 and 2026-10-25 (UTC). Most of these are also reflected in the code or the System Design docs; they are here so you know they were Viktor's calls and don't undo them.

### Scope and features

- The README's happy path is the spec. Bandshake was invented and removed. Paying at the venue with a band was cut. The table of proposed firmware extensions was cut: "you are not working on the hardware".
- The bands vibrate and point people along dispersion routes. That stays.
- Capital One Nessie is the wallet: a $200 sandbox account per attendee, catalog purchases during and after the event, and insurance payouts paid into it. Personalized recommendations start at departure or event end.
- Sharing a recap photo is one tap: the phone's share menu with a caption that tags everyone's Instagram handles. Socials are Meta's only (Instagram, Facebook, Threads), because Meta has the track.
- Test attendees get full made-up identities so the people graph looks like a crowd. Viktor offered his own Instagram, `viktorinkovski`.
- Every role wears a band (hackers, booth staff, speakers, organizers, photographers), except medics.
- Booths are interests: what people have in common comes from the booths they spent time at. "Also there with you" is ranked by shared interests, with a reason line for each person.
- The live run's movement must look real: people stay inside the venue and walk at a believable speed, and the sponsor names sit where the sponsors are on the venue layout.
- He keeps his plain pages on dev.band1t.vip to test with, even though Eddie's desk is the main site.
- Dropped on 2026-10-25 as new work: alerts on the medics' phones, and a logged opening of medical cards in View as. Cancelled as Leo's work: camera sightings for falls and SOS, exit colors per zone, low visibility guiding every band, and SOS above the other ring states. No firmware changes.
- The happy path is Cal Hacks, but the product must work for any venue.
- No Instagram sign-in. The recap shows who is in each photo.
- Cut from the recap as never requested: the Claude-written "story of the night", an "Is this you?" step on photos, match scores on cards, and a "min at the sponsor booths" line on merch picks. Who counts as having met someone is Leo's (vision).
- Updated on 2026-10-25: keep the current minutes together and minutes per booth in the recap and diagrams. Viktor superseded only the earlier instruction to remove those values. `web/src/recap.ts` shows time together, each person's booth minutes and shared-place durations; Eddie's graph details in `frontend/src/components/desk/graphModel.ts` and `GraphPage.tsx` also show minutes for encounters and booth visits. Check current code before raising a mismatch; all other handoff decisions still apply.
- "Also there with you" is a list of suggestions from the attendee's side, not a search: people they spent time with but didn't swap details with, and booths the same way. Never people they didn't meet.
- The people graph shows memories (photos) together with people and companies, built on an existing graph library.
- Tapping a band in a browser signed in as a medic opens that person's medical info. Everyone else gets the sign-in screen.
- Sponsor merch belongs to the Cal Hacks booths and is assumed to exist before the event. Each sponsor gets merch, smaller sponsors one type only. The images were made with Gemini through computer use, not by an API in the product.
- The shopping agent suggests merch for that one person and never buys by itself. The organizer does not rerun it.
- Catalog checkout is available during and after the event. A person who leaves early gets personalized merch recommendations after leaving; other attendees get them when the event ends.
- The organizer has a Merch tab with the templates and every order. Staff, photographers included, are added by email.
- Venue setup: the organizer names the event and Bright Data scrapes the rest, with Cal Hacks as the default in a dropdown. Judges don't need a live scrape. Bright Data also finds the insurance policies on the web, the attendee's plan and the venue's policy, instead of agents fetching them by hand.
- Kibana syncs by itself, so no import buttons for it in the UI.
- The crowd is 1,000 test bands, generated in code, not by a model.
- The Live tab on Viktor's pages: a big venue map with side panels, plain style, many tables and buttons, tables that scroll and search, and the legend as a table. Run controls (pause, end the event) sit at the top of every screen, and the run writes to SpacetimeDB like the real system. Every attendee is in a search bar: pick one to act as them or open their portal, or click them on the map. A real band dragged onto a person shows as that attendee. Exit stations and sponsor names are marked on the map.
- Evacuation (fire, evacuate everyone) is for the scripted run on Viktor's dev pages only.

### Insurance (Hyphenate's track, a main focus)

- The insurance Decision Engine is the part Viktor shows Hyphenate first. Keep it clear and quick to walk through.
- Claims are checked against the insurance policies themselves (the venue's policy and the attendee's own plan), not against past claims.
- Complicated claims always go to a person: a real policy mismatch or gap that needs a case-by-case call. A complicated claim never teaches a rule. The organizer's decision is kept as a precedent and shown on the next matching claim, never applied by itself. A bill line missing from the fee schedule is not complicated.
- The attendee's plan lookup is for their insurance plan only, with no belongings.
- When several people have the same plan, the PDF's storage, its Elastic pages, its reading and its clauses are done once per file (by SHA-256). The fetch, the pick and the search still run per person, and Viktor approved skipping the web search when someone types a plan another attendee already found.
- Check the earlier research before starting new research (see "Research").
- For Hyphenate, talk less about insurance and more about settling the payments between the parties.
- Incidents cover injuries, damage to the venue's property, and theft from the venue (not attendees' stolen belongings). Each person sees their charges in their portal.
- The organizer can file a claim as any attendee and pick whether its outcome is real, fake or random. The claim's evidence trail is shown visually.
- The Costs tab covers this event's operational costs so far, merch and booth reconciliation included, and nothing out of scope. Finance terms are defined on hover.
- A rule proposal's ceiling is the highest payout among past approved claims, and the organizer still approves it. Viktor accepted this at 06:12.
- Policy PDFs become chunks searchable by meaning in Elastic, to show what Elastic does that SpacetimeDB doesn't.
- The scorer script (it plants real and fake claims and scores which ones got paid) stays as the proof for Hyphenate's and Anthropic's tracks. The scorecard page was dropped.

### Sponsors

- SpacetimeDB owns live state and enforced decisions. Elastic supplies indexed evidence, semantic ranking, cited checks, proposed rules and model orchestration. The old "Elastic validates, Claude decides" split was superseded by Viktor's 2026-10-25 migration decision. Medical history and insurance-card extraction, including scanned-page transcription, belong in private Elastic workflows; do not retain a direct model fallback after the image path has been verified.
- Kibana dashboards stay, because they are visual for judges.
- Use a sponsor's API only where it truly fits. The merch images were made by hand with an image model, since no sponsor fit.
- The app's name is Band1t.
- Vultr hosts Band1t, for the MLH Vultr prize. Microsoft's track is entered anyway because it doesn't need Azure. See `artifacts/hosting-sponsor-research.md`.
- Hyphenate was dropped at 00:03 after Viktor's talk with them and brought back at 00:08. Make the social side stronger anyway.

### The Devpost

- Put “What it does” before “How it works”: product images and visuals first, technical diagrams and API suitability second. Keep the enclosure design in the technical hardware section.
- Give sponsor explanations space in proportion to their substantive contribution, especially Elastic and SpacetimeDB. Focus on important technical insights; remove repeated explanations and “this addresses the challenge” filler. Sponsor ranking stays unchanged.
- Devpost product/story order is safety, social, shopping, financial management. This writing order is separate from the established sponsor ranking; do not reorder sponsor-track sections or the main diagram board from this preference.
- Introduce sign-up in the Devpost opening. Group the recap around people, photos and personal shopping. Name the final product section “Financial management for large events,” limited to the existing claims, charges, receipts, ledgers and merch booth accounting.
- `diagrams/band-enclosure-design.png` is an unchanged copy of Leo’s `bandit_hardware_handoff/renders/bandit_v2_preview.png`. Caption it as an enclosure design.
- State actual actors and actions positively in Devpost prose. Remove unprompted explanations of what does not happen; retain necessary limits and consent boundaries as enforced behavior.
- Devpost writing only: use ordinary, exact words and natural, connected sentences. Explain each technical term once; remove repeated explanations and mechanical first/second enumerations while keeping important facts. Keep one live-site URL in "Try it out" and a brief closing disclosure. Preserve sponsor quotations. This preference does not replace the diagram guide.
- The Devpost may describe things that are not built yet, as long as the rest of the rules hold.
- Lean heavily on Meta for connecting people. The social part and the interests need detailed diagrams and their own detailed section.
- Each sponsor has its own section, the four big ones above all, quoting the sponsor's prompt word for word (never paraphrased, and not the prizes).
- Elastic is called the Evidence Engine.
- The best fit is Meta, Visa and a Cal Hacks track. The Devpost order follows from that.
- One Excalidraw board holds every diagram. Diagrams show the intended behavior, and come before the code.
- Build what the Devpost describes and the code lacks, asking Viktor first when it goes beyond the README. Don't delete Devpost text unless it clearly repeats itself for a weaker sponsor, and avoid deleting features unless they conflict or would cost points.
- The SOS-to-portal timing is a TODO for later. Don't measure it now.

### Working style

- Keep replies short. Viktor reads quickly and in passing.
- Don't ask him things you can check yourself, for example with git. Don't say "most likely" when you can verify.
- Ask him only about removals and new features, one at a time.
- Breaking things is fine: this is a hackathon project with no data worth keeping.
- Tell him each time band1t.vip deploys. Keep vik-e2e ready for PR #22 at least every 30 minutes.
- Show him things in his Chrome instead of giving him links.

## Team and ownership

| Person | Owns | GitHub |
| --- | --- | --- |
| Viktor Minchev | all non-frontend software: the module, the Rust services, the pipeline, deploy, docs, the Devpost, `web/` | `viktorinkov` |
| Eddie (Edward Lai) | all frontend and visuals: `frontend/`, the desk at band1t.vip/organizer and /cc/, the venue splat | `elai410` |
| Leo | vision, firmware and hardware: the bands, the gateway, the station markers, the security view (`pipeline/security*.py`), camera sightings | `leopozh` (commits as `pullbro`) |

- Never change firmware or hardware. Leo's branches (`firmware`, `bridge-hardware`, `security-vision`, `venue-photos-1080p`) and Eddie's (`venue-splat`) stay theirs.
- Viktor confirmed that Leo made the supplied [hardware board](https://excalidraw.com/#json=SV8r2zpCNd0WMnaBi5Y17,BXzlynJTGvIPFxko8A9lag) and is still implementing it. Follow that drawing's intended behavior, including its 100 Hz sensor path, free-fall sequence, three helpers, zone hysteresis and SOS precedence. Record differences in fetched firmware as ongoing implementation; do not silently weaken the design. Preserve `diagrams/hardware-source.excalidraw` unchanged.
- "(TBD -- LEO)" in the System Design docs and "LEO TBD" in devpost.md mark Leo's open parts. List them with `grep -rn "TBD -- LEO" "System Design"` and `grep -n "LEO TBD" devpost.md`. `System Design/README.md` (Legend) says what they cover: the security cameras and the security view, the band's zone pick, exit routing and the medic approach.
- Viktor's call on 2026-10-25: Leo fixes the camera side, including the `report_camera_sighting` reducer that devpost.md names but the module doesn't have. Exit colors per zone, low visibility guiding every band and SOS above the other ring states are firmware, so they are Leo's too.
- Eddie's desk now serves band1t.vip/organizer. Viktor's own organizer page is at band1t.vip/portal and at dev.band1t.vip/organizer, which serves all of Viktor's plain pages for testing. The desk has no Live tab, View as, Proposed rules, Venue setup or Kibana tab, and its crowd runs in each browser. Its control panel and `frontend/README.md` use banned words. Tell Viktor rather than editing Eddie's code.

## Where things run and where the credentials live

Names and locations only. Never copy a value into the repo, a commit or a message.

| Where | What | Holds |
| --- | --- | --- |
| Viktor's Mac, `~/Development/CalHacks 13.0` | the main checkout, on vik-e2e | everything below marked Mac |
| Mac: `.env` (repo root, gitignored) | service keys | `SPACETIMEDB_URL`, `SPACETIMEDB_DATABASE`, `NESSIE_BASE_URL`, `NESSIE_API_KEY`, `BRIGHTDATA_API_TOKEN`, `BRIGHTDATA_ZONE`, `BRIGHTDATA_BROWSER_ZONE`, `BRIGHTDATA_BROWSER_PASSWORD`, `BRIGHTDATA_CUSTOMER_ID`, `ELASTICSEARCH_URL`, `ELASTICSEARCH_API_KEY`, `KIBANA_URL`, `KIBANA_API_KEY`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` |
| Mac: `~/.config/spacetime/cli.toml` | the Maincloud owner login (`spacetime login`, GitHub sign-in) | `spacetimedb_token`. `scripts/e2e-env` reads it as `BANDIT_OWNER_TOKEN` |
| Mac: `.dev/e2e-maincloud/identities/` | the services' and test people's SpacetimeDB identities | one file each: `bandit-api`, `bandit-indexer`, `worker`, `sim`, `tester`, `vision`, `ops`, `medic`, `photographer`, `dana`, `jordan`, `lee`, `maya`, `priya`, `sam`, `sam-patel` |
| Mac: `SPONSOR_SETUP.txt` (untracked) | the sponsor accounts, credits and where each key came from | notes, read before signing up for anything again |
| Mac: Viktor's SSH key | `ssh root@band1t.vip` | the VM's root login |
| VM `bandit` (Vultr, 104.207.149.22): `/opt/bandit/.env` | the services' keys on the VM | written by `scripts/deploy-vm` from the Mac's `.env`, plus `BANDIT_OWNER_TOKEN` |
| VM: `/var/lib/bandit/identities/` | the services' identities on the VM | copied by `scripts/deploy-vm` |
| Claude project files: `/mnt/project-files/bandit-cloud.env` | the cloud threads' keys (lost at handoff) | `BANDIT_ENV_B64`, `BANDIT_SPACETIME_TOKEN`, `BANDIT_DEPLOY_KEY_B64`, `BANDIT_IDENTITIES_B64`: base64 copies of the Mac's `.env`, owner token and identities, plus a separate deploy key for root@band1t.vip. `deploy/cloud-setup.sh` shows how they were unpacked |

Accounts behind the keys: GitHub `viktorinkov`, SpacetimeDB Maincloud (signed in with GitHub), Elastic Cloud (Kibana link in `LINKS.md`), Bright Data, Capital One Nessie, the Anthropic Console (prepaid credits with auto-reload off), Vultr (server `bandit`), Porkbun (the band1t.vip DNS, account `leopoz`) and Excalidraw Plus (GitHub `viktorinkov`, `vikitominchev@gmail.com`; the earlier UCSB account assumption was wrong). The SpacetimeAuth client id is public and is in `LINKS.md`. The Anthropic API key pays for the app's Claude calls. It is separate from Claude Code usage, so the app keeps working after the Claude setup stops, as long as the API credits last.

## Mac-only steps and blocked paths

Claude's cloud threads could not do these, so they went through a Claude session on the Mac. Codex running on the Mac can do all of them directly.

- Maincloud publishes, `spacetime sql` and `spacetime call` on the live database, reopening the event and starting Live runs. A safety check in the cloud threads refused them.
- `ssh root@band1t.vip` and `scripts/deploy-vm`. Cloud threads shipped only by pushing vik-e2e.
- Exporting the Excalidraw board to excalidraw.com (`diagrams/generator/share.py`). The cloud container could not reach excalidraw.com.
- Editing `devpost.md`, which lives only in the Mac checkout.
- Running a whole flow in Viktor's Chrome to show him.
- The Mac's own state at 06:33 UTC: on vik-e2e, 50 commits behind origin (pull first). `README.md` has Viktor's own uncommitted first line: never commit it and never revert it. Untracked and meant to stay so: `devpost.md`, `SPONSOR_SETUP.txt`, `bandit_hardware_handoff/` (Leo's hardware notes), `.env.example`, `loaded.png`, `.claude/settings.local.json`. `var/` (gitignored) holds older Devpost, board and research copies.
- The Hyphenate workshop deck and its extracted text (`hyphenate-workshop-deck.pdf`, `hyphenate-workshop-deck-text.txt`) are in `var/handoff-research/` on the Mac only, because the repo is public and the deck is Hyphenate's. `var/research/raw/` on the Mac holds the raw sponsor pages the first research read (Devpost rules, Hive prizes, the Elastic, Visa and Hyphenate docs).

## Unfinished work at handoff

### Branches on origin not in vik-e2e

Refresh this table with `handoff/branches.sh`.

| Branch | Commits not in vik-e2e | Last commit (UTC) | Author | What it is |
| --- | --- | --- | --- | --- |
| `vik-medic-alerts` | 1 | 10-25 05:54 | Viktor | design only, dropped by Viktor: alerts on the medics' phones. Don't merge |
| `vik-medical-view-as` | 1 | 10-25 05:55 | Viktor | design only, dropped by Viktor as new work: View as opens a medical card only through a logged opening. Don't merge |
| `vik-security-sightings` | 1 | 10-25 05:55 | Viktor | design only, cancelled: Leo does the camera side. Don't merge |
| `vik-merch-buy-as` | 3 | 10-25 01:16 | Claude | superseded: buying merch as any attendee is already on vik-e2e (`buy_merch_as`). Its commits are authored as Claude. Don't merge |
| `bridge-hardware` | 3 | 10-24 07:34 | Leo | PR #2 into vik-e2e: harden the gateway bridge. Leo's |
| `firmware` | 11 | 10-23 21:12 | Leo | the band, gateway and station firmware. Leo's |
| `security-vision` | 4 | 10-24 14:19 | Leo | security view and splat work. Leo's |
| `venue-photos-1080p` | 1 | 10-24 22:15 | Leo | 1080p venue photos. Leo's |
| `venue-splat` | 2 | 10-24 23:38 | Eddie | Gaussian splat of the hall, now the final 30k-step version. Eddie's |

Open PRs: #22 (vik-e2e into main, the team's PR), #41 (`vik-cloud-config` into main: cloud-thread push and Maincloud rules, waiting for Eddie's or Leo's review because main is protected) and #2 (above).

### Work in progress or left over

- **Attendee's plan to cut venue costs**: shipped (`54e3924`, merge `2787ead`). The attendee's plan pays first and the venue's excess cover pays only the copay the plan leaves. Left: check that devpost.md has its paragraph.
- **Index fetched PDFs for search by meaning**: shipped (`443bb8f`, `7525163`). Fetched plan and venue PDFs are chunked into `bandit-policy-clauses` and each check cites the chunk it matched. A PDF that any lookup kept now stays in Elastic when another lookup passes it over.
- **Reuse a plan**: shipped (merge `c2f0aae`) and published: Maincloud has `plan_lookup.reused_from`.
- **Evacuate the live run**: shipped (merge `86060eb`) and published. An Evacuate button on Viktor's Live tab sends the live run's crowd to the exits (`evacuate_live_run`, `live_evacuation`). Left: watch one evacuation on dev.band1t.vip.
- **Hospital report**: merged (`0de153d`) and published. Maincloud has `apply_hospital_report` and no longer `apply_medical_record`. Left: check that no claim is stuck in `ReadingRecord`, and apply its 12 Devpost edits.
- **Queues**: once the hospital report is live (it is), move `claim_record_extract` to `document_read` under Elastic in the System Design docs, the Excalidraw board and the Devpost.
- **Complicated claims**: shipped. Two complications are designed but not built: policies that disagree on who pays first, and two clauses that conflict. The venue-costs work above covers part of the first.
- **Default branch**: Viktor decided at 06:57 that it stays `main`. Work from vik-e2e.
- **Claim evidence timeline** and **file claims as any attendee**: both threads stalled at about 00:48 after the code they waited for landed (`web/src/evidence-trail.ts`, `file_claim_for_wearer`). Nobody checked them against Viktor's asks. Filing for an attendee who has no incident yet was named as a gap.

## Devpost

- The master is `devpost.md` at the root of the Mac checkout. It is uncommitted on purpose and Viktor edits it by hand. Make only targeted edits: read the file right before you write, and change only the sentences in question. Never rewrite or reformat it.
- Viktor explicitly requested the Simple English skill in Plain mode for future Devpost edits. Preserve sponsor quotations, facts, the agreed fit order, intended features and unrelated prose. Keep implementation status in review notes instead of deleting intended features to match incomplete code.
- The style guide is `handoff/research/devpost/TERMS.md`: one word for one thing, each service named as company plus product. Image explanations usually have one to three paragraphs, but judge total reading length from words and sentences together; more very short paragraphs or one longer paragraph can work. “What it does” explains general product behavior in nontechnical language, including the policy allocation visual. “How it works” explains technical systems and API choices. Describe general behavior even when an image shows a particular claim; keep its individual amounts and evidence details in the image or source notes. Reuse existing artwork, with medic routing and crowd clearance explained in separate diagrams. Viktor said the Devpost may describe things that are not built yet.
- The Devpost is written around the best-fit tracks. The research behind that order is in `handoff/research/artifacts/track-fit-and-devpost-reorder.md`.
- Diagrams follow the single guide in `handoff/research/devpost/TERMS.md#diagrams`: large original images/logos, filled parent cards with nested property cells, and arrows between actual process stages. Keep all current diagrams on the canonical Plus board linked in `LINKS.md` and devpost.md; public share links are saved checkpoints. The generator and share script preserve editable source and publication history.

### Gaps the Devpost reworded instead of fixing, or still states

- Medic phone alerts were dropped. devpost.md now has the medic take the incident on the organizer portal and tap the band.
- View as reads anyone's medical card with no medical access log row. devpost.md now names the owner, through View as, among those who can read the card.
- Camera sightings for falls and SOS: devpost.md says the security view calls `report_camera_sighting`, marked LEO TBD. The module doesn't have the reducer. The scripted run writes sightings through `submit_vision_assessment`, and only for property.
- Exit guidance, low visibility and SOS precedence on the band are marked LEO TBD (firmware).
- devpost.md still says "a bug in a web page cannot show a private row" (Views section and the SpacetimeDB track). It is not true for `encounter`, `zone_visit`, `departure`, `incident_marker`, `decision` and `live_plan`, which are public. The rules say to reword it, not to add privacy work.
- devpost.md still has a TODO: measure the time from an SOS press to the incident on the organizer portal while the crowd of 1,000 runs, and quote it.
- devpost.md's "Try it out" links an older board than `LINKS.md`.
- README features that neither the code nor the Devpost has: the bands around a faller vibrating and flashing red, a compass pointing the way to disperse, steering people out of a medic's path, and cameras tracking crowded areas. The Devpost chose a blue pulse with no vibration.
- Judges have no way into the organizer pages: both need a staff email that the owner added. Viktor has not decided how judges get in.
- The full audit, with line references, is `handoff/research/audits/devpost-missing-features.md`. Several of its items were fixed after it was written, so check the code before you act on one.

## Pending verifications

Nobody confirmed these:

- No claim on Maincloud is stuck in `ReadingRecord` after the hospital report change.
- "Also there with you" ranks by shared interests on the live database. The check: reopen the event, move test bands 90, 92 and 93 to the sponsor row (station 103) for 6.5 minutes with no run, move 92 and 93 to station 0, start an 8-minute Live run (1,000 people, speed 8, Start fresh off) with band 90 still at the sponsor row, then read the recaps for Jordan, Sam and Lee through `/api/recap` and check each reason line.
- A rule proposal reaches "proposed" after the next scripted claims run: `spacetime sql bandit-calhacks13-sp82j "SELECT id, status, ceiling_cents, rule FROM rule_proposal"`.
- The plan and venue checks on the VM (in `/opt/bandit` with `BANDIT_DATA_DIR=/var/lib/bandit ./target/debug/bandit-workers --once`): `plan_lookup` for Blue Shield of California, Silver 70 PPO, CA; then `document_read` with the returned file hash, which should say the reader read this PDF already; then `venue_policy_lookup` for Harborline Casualty, CG 00 01 and CP 00 10.
- A whole claim on band1t.vip in Viktor's Chrome: file as the attendee, the evidence timeline, Claude's decision, the organizer's review and the payout.
- The one-time venue floor load for realistic movement ran on Maincloud.
- dev.band1t.vip/cc/ serves Eddie's desk now that `frontend/` is on vik-e2e. It returned 404 at 06:35.

## Research

Everything the threads researched, saved in the repo so it outlives the Claude project. Pages that were published on claude.ai are in `handoff/research/artifacts/`, converted to Markdown.

| File | What it is |
| --- | --- |
| `sponsors/sponsor-tracks.md` | every sponsor track's criteria, quoted word for word from Devpost, Hive and Slack, with the judging rules (read 2026-10-25) |
| `sponsors/slack-sponsor-asks.md` | what each sponsor posted in the Cal Hacks Slack: tracks, credits, workshops; and the channels not read |
| `artifacts/track-fit-and-devpost-reorder.md` | which tracks fit Band1t best and the Devpost order that follows from it |
| `artifacts/spacetimedb-track-winners.md` | past SpacetimeDB track winners, and how Band1t shows SpacetimeDB and Elastic (3 tabs) |
| `artifacts/spacetimedb-vs-elastic-decision.md` | where each data flow could live, SpacetimeDB against Elastic, with what a judge would see |
| `sponsors/people-graph.md` | the decision on where the people graph lives (SpacetimeDB for the graph, Elastic for meaning) and the test crowd |
| `artifacts/hyphenate-winners-and-insurance-ideas.md` | the closest Hyphenate-style winners and the insurance ideas taken from them |
| `artifacts/insurance-what-to-cut.md` | the five insurance parts to cut, each grounded in a cited outside policy form |
| `artifacts/who-pays-whom-on-injury.md` | who pays whom when an attendee is hurt: the venue's insurer, the claims fund, the attendee's own plan |
| `artifacts/hyphenate-walkthrough-script.md` | the short walkthrough for showing Hyphenate the insurance flow on band1t.vip |
| `hyphenate-workshop/taught-rules.md` | whether Hyphenate wants taught rules on complicated claims, from their workshop deck (the deck itself is on the Mac, see above) |
| `sponsors/hyphenate-costs.md` | how the event costs tab fits Hyphenate's track |
| `insurance/follow-up-policy-matching.md` | Viktor's call: match claims against the insurance policies, not past claims |
| `insurance/evidence-engine-research.md` | how past projects drew their Elastic part, for the Evidence Engine frame |
| `artifacts/nessie-prize-winners.md` | past Capital One "Best Use of Nessie" winners and what made them win |
| `artifacts/nessie-post-event-purchasing.md` | the Capital One Nessie design for post-event merch and payouts |
| `artifacts/bright-data-scraping-plan.md` | the Bright Data plan for the event's people, companies, venue and floor plan |
| `sponsors/bright-data-vs-apify.md` | Bright Data against Apify for a hackathon, and how to frame using both |
| `venue-3d/venue-map-sources.md` | where the Cal Hacks 13.0 venue map lives and how to get it |
| `venue-3d/brightdata-export-source.md`, `venue-3d/brightdata-export-report.md`, `venue-3d/renders/` | the venue 3D model exported through Bright Data, with every request logged, and renders of it. The model itself is `web/venue/venue.glb` |
| `artifacts/claude-vision-research.md` | how to use Claude for vision: a detector per frame, Claude to judge events |
| `artifacts/hosting-sponsor-research.md` | which sponsor cloud hosts Band1t: Microsoft, Annapurna Labs, Vultr (MLH) |
| `sponsors/merch-image-api.md` | which image API makes the merch pictures |
| `sponsors/meta-tagged-sharing.md` | whether a recap photo can be shared with everyone pre-tagged on Meta's apps |
| `artifacts/devpost-first-draft.md` | the first Devpost draft (2026-10-24), superseded by the Mac's devpost.md |
| `devpost/TERMS.md` | the Devpost and diagram style guide |
| `devpost/draft-what-it-does.md`, `devpost/draft-system-design.md`, `devpost/draft-system-design-short.md`, `devpost/medic-routing.md` | earlier drafts of Devpost sections |
| `devpost/claude-decisions-edits.md`, `devpost/hybrid-search-edits.md` | targeted Devpost edits written for two features. Check the Mac's devpost.md before applying either |
| `audits/devpost-missing-features.md` | the audit of Devpost claims against the code (2026-10-25 05:16) |
| `audits/readme-audit.md` | the README happy path against vik-e2e, line by line, with owners |
| `audits/e2e-run-checklist.md` | the first end-to-end run on Maincloud: what passed and what failed |
| `screenshots/` | the eight screenshots taken for the Devpost |

Links inside these files may point at old paths such as `../system-design/`. The current docs are in `System Design/`.

Left out on purpose: the timed Devpost snapshots (the Mac's `devpost.md` is newer), the old System Design versions and patches (in git history), the screenshots taken to check fixes, and two claude.ai pages with no content ("Live bands: showing SpacetimeDB and Elastic at their best" was never written, and "BandIt: showing both SpacetimeDB and Elastic" only points to the decision doc above).

## Refresh before handoff

Run this from a Claude session right before the handoff, then commit with one short line and ship:

1. `handoff/branches.sh` and replace the branches table with its output. Write one line per branch on what it is.
2. Read the open threads (states working, blocked and review_ready) and update "Work in progress or left over" and "Pending verifications". Drop items that are done.
3. Add any new decisions of Viktor's from the project chat.
4. Copy anything new under `/mnt/project-files/` that is research into `handoff/research/`, and any new claude.ai research page as Markdown into `handoff/research/artifacts/`.
5. Update the snapshot line at the top with the time and the vik-e2e commit.
