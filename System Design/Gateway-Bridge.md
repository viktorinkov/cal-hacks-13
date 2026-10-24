# Gateway-Bridge

`bandit-bridge` is the Rust process on the demo laptop that joins the radio fleet to SpacetimeDB. It reads the gateway's serial lines, keeps the latest report per band, and every 250 ms sends what changed to the `bandit` module in one `ingest_band_reports` call. In the other direction it subscribes to the server's intent (`band_directive`, `band_command`, `fleet_config`) and turns it into gateway text commands, re-sending until each band reports what the server wants. `bandit-protocol` is the shared Rust crate that mirrors the firmware's packet, flags, states and commands so the bridge, the simulator and the module agree byte for byte. The bridge exists so that the bands never need a database client and so that there is exactly one place where radio loss, reboots and reconnects are handled.

## Role in the system

Responsibilities:

- Own the serial port to the gateway: read every line, parse it, log it raw, and write command lines.
- Keep the latest report per band and per station, with liveness and a packet-loss estimate.
- Batch changed reports to the module every 250 ms as one reducer call, under the `bridge` role.
- Reconcile the server's sticky intent (`band_directive`, `fleet_config`) against what each band reports, and re-send after loss, reboot or expiry.
- Deliver one-shot commands (`band_command`) exactly once per command and acknowledge them.
- Validate and rate-limit everything that goes down the command line, so a dashboard bug cannot recolour the stations or flood the gateway.
- Report its own health through `heartbeat` every 5 s.
- Keep running through serial and server outages and resync when they end.

Explicit non-responsibilities:

- It decides nothing about safety: no incident logic, no exit assignment, no density. Those live in the module ([Safety](Safety.md)). The bridge is a courier with a memory.
- It holds no truth. Everything it knows is in `band_report`, `service_heartbeat` or its raw log, and a restart loses nothing the system needs.
- It never speaks for simulated bands (ids 1000 and above); [Simulator](Simulator.md) reports those itself.
- It does not synchronise clocks; it timestamps lines with the laptop clock on receipt and sends ages, not timestamps.
- It does not run any feature flow; it relays prompts down and the press flag up, and the module decides.

## Interfaces

| Interface | Direction | Counterpart | What flows | Transport |
|---|---|---|---|---|
| Gateway uplink | in | Gateway | one JSON object per heard packet (fields in [Hardware](Hardware.md)), plus boot, `ack` and `err` lines | USB serial, nominal 115200 baud |
| Gateway downlink | out | Gateway | text lines `cmd <target> <name> [arg] [arg2]` | USB serial |
| `ingest_band_reports` | out, reducer call | `bandit` module | a batch of changed reports (fields below) | SpacetimeDB Rust client SDK, caller role `bridge` |
| `ack_band_command` | out, reducer call | `bandit` module | command id and outcome (`sent` or `expired`) | SDK |
| `heartbeat` | out, reducer call every 5 s | `bandit` module | service `bridge`, version, counters: serial lines per second, parse errors, commands sent, per-band loss | SDK |
| `band_directive` | in, subscription | `bandit` module | desired sticky state per target: forced state and hold, exit colour, override flag | SDK |
| `band_command` | in, subscription | `bandit` module | one-shot commands not yet acknowledged: target, kind (`pay`, `paid`, `buzz`, `clear`), argument, created time | SDK |
| `fleet_config` | in, subscription | `bandit` module | live calibration: yellow and red counts, neighbour and circle RSSI thresholds | SDK |
| Raw log | out | file on the laptop; read by [Simulator](Simulator.md) replay and by the calibration capture | one JSON object per line, every line in and out | `.jsonl` file, one per run |
| Configuration | in | environment or a small file ([Rust-Backend](Rust-Backend.md)) | serial port path or auto-detect, SpacetimeDB host, database name `bandit`, identity token path, log folder | local |

The report the bridge sends for each band inside `ingest_band_reports`:

| Report field | Meaning | Source |
|---|---|---|
| `band_id` | 1 to 9 for bands, 101 to 105 for stations | packet `id` |
| `kind` | band or station | packet `type` |
| `flags` | the flag bits, accumulated with OR over every packet since the last batch | packet `flags` |
| `neigh`, `zone`, `bat`, `state` | the band's latest values | latest packet |
| `seq` | latest packet counter | latest packet |
| `gateway_rssi` | signal at the gateway, a coverage diagnostic | latest packet |
| `heard_age_ms` | milliseconds since the gateway last heard this band, measured when the batch is sent | laptop clock |
| `loss_pct` | estimated packet loss over the last 5 s, from `seq` gaps | bridge |
| `gateway_id` | which gateway heard it (200 in v0.1) | configuration |

[SpacetimeDB](SpacetimeDB.md) owns how these land in `band_report` and `station`; the module derives alive (heard within 2 s) and stale (5 s) from the heard time it stores, using its own clock, so no clock agreement with the laptop is needed.

## Design

### Internals

What runs inside the process and what flows between the parts. Each box is a task; arrows are channels.

```mermaid
flowchart TB
    GW["Gateway"] -->|"JSON lines, USB serial"| RD["Serial reader"]
    RD -->|"every raw line"| LOG["Raw .jsonl log"]
    RD -->|"lines"| PA["Line parser (bandit-protocol)"]
    PA -->|"reports"| FM["Fleet map: latest report per band, liveness, seq gaps"]
    FM -->|"changed reports, every 250 ms"| BT["Batcher"]
    BT -->|"ingest_band_reports, heartbeat"| STDB["bandit module"]
    STDB -->|"band_directive, band_command, fleet_config"| SUB["Subscriptions"]
    SUB -->|"desired state per target"| RC["Reconciler"]
    FM -->|"reported state, reboots"| RC
    RC -->|"commands, prioritised and coalesced"| Q["Command queue and rate limiter"]
    Q -->|"one cmd line in flight"| WR["Serial writer"]
    WR -->|"text lines, USB serial"| GW
    PA -->|"ack and err lines"| Q
    Q -->|"ack_band_command"| STDB
    Q -->|"sent commands"| LOG
    classDef device fill:#FFF3E0,stroke:#E65100,color:#1A1A1A
    classDef rust fill:#FBE9E7,stroke:#BF360C,color:#1A1A1A
    classDef stdb fill:#E8EAF6,stroke:#283593,color:#1A1A1A
    class GW device
    class RD,LOG,PA,FM,BT,SUB,RC,Q,WR rust
    class STDB stdb
```

The process is a small async runtime with one task per box. The serial reader is the only task that touches the port for reading and runs with nothing else on its thread, because the gateway drops lines whenever nobody is reading ([Hardware](Hardware.md)). The serial crate is `serialport` (or its async wrapper `tokio-serial`); the SpacetimeDB client is the Rust SDK crate `spacetimedb-sdk`, which gives the bridge a persistent connection, subscriptions and reducer calls under one identity whose role is `bridge` ([Rust-Backend](Rust-Backend.md) describes how the owner grants that role).

### The `bandit-protocol` crate

The crate is the single Rust mirror of the firmware's shared header. It compiles for the laptop and for the module's WebAssembly target, so it carries no I/O and no heavy dependencies. It holds:

| Contents | Used by |
|---|---|
| The packet field list, the flag bits, the ten light states with their names and colours, the nine command numbers and names, the six exit colours and the id ranges (bands, stations, gateway, simulated) | bridge, simulator, module, and the dashboards through generated bindings |
| The constants that are fixed by firmware: beacon rates, neighbour window 2 s, zone window 3 s, press flag 1 s, prompt window 8 s, longest forced hold 25.5 s | bridge, simulator, module |
| A parser for gateway lines that returns a report, a boot line, an `ack`, an `err` or an unparseable line, and never panics on garbage | bridge, simulator replay |
| A formatter and validator for command lines (ranges, target rules, the never-broadcast rules below) | bridge |
| The band's state-precedence function and its density state machine with hysteresis, written once from the firmware's order | simulator (to behave like a band), bridge (to judge whether a reported state is consistent with a directive) |

Why one crate: a one-byte disagreement between the firmware's enum and a Rust constant would silently miscolour the dashboard, so every Rust process reads the same table, and the header and the crate change together.

### Serial reader and line parser

The reader opens the configured port, or auto-detects the gateway by the XIAO's USB vendor and product ids, at the nominal 115200 baud, and reads with a short timeout so it notices silence. Bytes are split on newline; carriage returns are dropped; a partial line left when the port closes is discarded. Every complete line goes to the log unchanged and to the parser. The parser classifies: a report (object with `id` and `type`), a boot line (object with `gateway`), an `ack`, an `err`, or unparseable. Reports of type 3 (another gateway's command echo) are logged and counted but not forwarded. Parse errors are counted for the heartbeat; a burst of them usually means the wrong baud, a half-flashed gateway or a cable fault.

The reader also measures lines per second, which is the first number to look at when the fleet looks wrong: about 10 per live band plus 5 per station is healthy, and a sudden fall with the stations still present means bands, not the gateway, are the problem.

### Per-band latest-report map

The fleet map is a table keyed by id. For every band and station it keeps the latest packet, the laptop time it arrived, the flags accumulated since the last batch, the last `seq`, a sliding loss window, what was last sent to the module and when, and what the bridge last commanded (forced state and hold, exit colour, override, thresholds) with the time of each. Only the latest packet matters for state; history lives in the raw log. Flags are accumulated rather than overwritten so that a press flag (carried for 1 s in beacons) or a brief fall flag is never lost between two batches even if the latest packet has it cleared.

### Liveness and packet loss

Liveness is derived, never stored: a band is alive if heard within 2 s and stale after 5 s. The bridge does not send an alive flag; it sends `heard_age_ms`, and the module computes the rest with its own clock. The bridge still needs to make sure the module's heard time keeps moving for a band whose values do not change, so each band is re-sent at least once a second (heartbeat report, starting value) even if nothing changed. Without that, a quiet band would look stale while beaconing perfectly.

Packet loss comes from `seq`: each new packet should be the last `seq` plus one. The gap is the number of packets lost. Over a sliding 5 s window (50 expected packets at 10 Hz, starting value) the bridge computes lost over expected as `loss_pct`. A `seq` that goes backwards is one of two things: a wrap (the last value was near 65535 and the new one is small) or a reboot. The rule: backwards by more than 1000 with the last value below 64000 is a reboot (starting value, calibrate); a band reappearing after more than 5 s of silence with a `seq` below 100 is also treated as a reboot. A reboot marks the band for resync (below). Per-band loss and the lines-per-second figure go into the `heartbeat` call so the ops dashboard can show radio health next to service health ([Ops-Dashboard](Ops-Dashboard.md)).

### The 250 ms batcher

Every 250 ms the batcher collects the reports that changed since the last batch and sends them in one `ingest_band_reports` call. Changed means: any of flags, `neigh`, `zone`, `state` or `bat` differs from what was last sent, any flag bit was seen since the last send, a reboot was detected, or the last send is older than 1 s (the heartbeat report). `gateway_rssi` and `seq` changes alone do not trigger a send, because they change on every packet and carry no decision value. An empty batch is skipped. One reducer call per batch, never one per packet, keeps the module's work bounded at four transactions a second from the bridge regardless of fleet size.

How a beacon becomes a dashboard update.

```mermaid
sequenceDiagram
    participant B as Band
    participant G as Gateway
    participant R as bandit-bridge
    participant M as bandit module
    participant D as Ops dashboard
    loop every 100 ms per band
        B->>G: beacon (ESP-NOW broadcast)
        G->>R: JSON line (USB serial)
        R->>R: log raw, parse, update fleet map, seq gap
    end
    loop every 250 ms
        R->>M: ingest_band_reports (changed reports, one call)
        M->>M: upsert band_report, open or refresh incidents, complete prompts
        M-->>D: subscription update (band_report, incident)
    end
    loop every 5 s
        R->>M: heartbeat (lines per second, loss per band)
        M-->>D: service_heartbeat row
    end
```

Latency budget from a button press to the module: up to 100 ms for the next beacon, serial transfer in the low milliseconds, up to 250 ms for the next batch, then the reducer. A press flag therefore reaches the module within about 400 ms, well inside the 1 s the band carries it and the 8 s prompt window.

### Server intent: the three subscriptions

The bridge subscribes to all of `band_directive`, all of `fleet_config`, and the `band_command` rows that are not yet acknowledged. Each subscription update wakes the reconciler. The bridge reads directives for targets 0, 1 to 9 and 101 to 105 and ignores targets at 1000 and above, which belong to the simulator. For stations the only meaningful directive fields are exit colour and a forced mode (0 breathe, 1 chase, 9 off).

Precedence between directives: a directive addressed to a band overrides the all-bands directive (target 0) field by field, so a venue-wide evacuation (target 0, forced GUIDE) and a per-band exit colour (target 3, exit 2) combine into "band 3 shows GUIDE in magenta". Who writes which directive, and when, is in [Safety](Safety.md) (evacuation, medic approach, exit assignment) and [Attendee-App](Attendee-App.md) (IDENT for claiming).

### The reconciler

The reconciler runs on every subscription change and on every 250 ms tick. For each live band it computes the desired settings from the directives and compares them with two things: what the band reports (`state`) and what the bridge last sent (for settings the band does not report back, which is everything except the state). It then queues the smallest set of commands that closes the gap.

How a directive becomes a light, and how the bridge knows it worked.

```mermaid
sequenceDiagram
    participant M as bandit module
    participant R as bandit-bridge
    participant G as Gateway
    participant B as Band
    M-->>R: band_directive changed (subscription): band 3, forced GUIDE, exit magenta, hold 60 s
    R->>R: compare with band 3's reported state and last sent values
    R->>G: cmd 3 exit 2
    G->>B: exit command, 3 repeats 40 ms apart
    G-->>R: ack line
    R->>G: cmd 3 state 2 255
    G->>B: state command, 3 repeats
    G-->>R: ack line
    B->>G: next beacon, state 2
    G->>R: JSON line
    R->>M: ingest_band_reports (band 3 state 2)
    Note over R: satisfied. Refresh the hold at 20 s, last send with the remaining time
    R->>G: cmd 3 state 2 200 (at 20 s, 20 s remain)
```

Rules the reconciler follows, each with its reason:

| Situation | What the bridge does | Why |
|---|---|---|
| Reported state differs from the desired forced state | re-send the `state` command, at most once per second per band (starting value) | commands are fire and forget; the report is the only confirmation. The backoff avoids fighting a band that is legitimately elsewhere |
| Reported state is one that outranks the forced state on the band (SOS 3, NEAR_SOS 4, PAY 5, PAID 6, IDENT 8 during a prompt) | treat the directive as satisfied for now; re-check when the band leaves that state | the band's precedence ladder ([Hardware](Hardware.md)) is deliberate: SOS and the light circle must win |
| Desired forced state has a hold longer than 25.5 s | send with the longest hold and refresh at 20 s (starting value); the final send carries the remaining time | the band holds a forced state for at most 25.5 s per command; the last send lets the band release itself exactly when the directive ends |
| Forced state is removed from a directive before its hold ran out | re-send the same state with a 0.1 s hold | there is no "unforce" command. `clear` would also release an SOS latch, so the bridge makes the forced state expire instead |
| Exit colour, override flag or thresholds changed | send once; re-send to each band every 30 s (starting value), staggered | bands do not report these values, so the bridge cannot verify them; the periodic re-send is the safety net against a lost triple |
| A band rebooted (`seq` reset) | mark for resync: re-send `thresh` and `rssi` from `fleet_config`, then exit colour, override and any forced state for that band | a band forgets everything on reset |
| `fleet_config` changed | broadcast `thresh` and `rssi` to target 0 once, then rely on per-band resync and the 30 s re-send | one broadcast reaches the whole fleet; calibration is the one setting where target 0 is right |
| Zone exit assignment changed (the module updated the exit colour in the directives of the bands in that zone) | per-band `exit` commands, never target 0 | an `exit` broadcast would recolour every station marker ([Hardware](Hardware.md)) |
| A station directive changed | `cmd <station> exit <n>` or `cmd <station> state <mode>` by station id | stations accept only these two and only by id or broadcast |
| Desired forced state is OFF (9) for a band | not sent; reported as unsatisfiable in the heartbeat counters | the firmware cannot force OFF in v0.1 |

The reconciler is idempotent: running it twice queues nothing new, because the queue coalesces by target and command name and keeps the newest arguments.

### One-shot commands and acknowledgement

`band_command` rows are events, not state: `pay`, `paid`, `buzz` and `clear`. The bridge sends each exactly once (the gateway's three repeats are the retry), then calls `ack_band_command` with the command id and the outcome. The outcome is `sent` when the gateway's `ack` line was seen (or the write succeeded and the ack timed out, which is logged), and `expired` when the command was older than its useful life when the bridge got to it: 8 s for `pay` (the prompt window), 5 s for `paid` and `buzz`, no limit for `clear` (starting values). Expiry matters after an outage: replaying a minute-old `pay` to a band would open a prompt nobody expects. One-shots go to the front of the queue, because a `pay` or `paid` is something a person is watching for.

`clear` is the one command that touches a band's SOS or fall latch, so the bridge sends it only when a `band_command` of kind `clear` asks for it (the module writes that when an incident is resolved or ops clears a band, [Safety](Safety.md)), never on its own initiative.

### Press to confirm

The button is the consent step for payments and for claiming a band. The server opens a short prompt window on the band; a beacon from that band with the press flag inside the window confirms. The bridge's job is to deliver the prompt and to forward the press quickly; the decision is the module's.

The round trip for both uses of the pattern.

```mermaid
sequenceDiagram
    participant A as Merchant terminal or Attendee app
    participant M as bandit module
    participant R as bandit-bridge
    participant G as Gateway
    participant B as Band
    A->>M: start_payment or claim_band_start (opens an 8 s window)
    alt payment
        M->>M: insert band_command pay for the band
        M-->>R: band_command row (subscription)
        R->>G: cmd <id> pay
        G->>B: PAY state for 8 s, double buzz
        R->>M: ack_band_command (sent)
    else claim
        M->>M: band_directive IDENT, hold 8 s
        M-->>R: band_directive row (subscription)
        R->>G: cmd <id> state 8 80
        G->>B: IDENT white blink for 8 s
    end
    B->>B: wearer short-presses, press flag set for 1 s
    B->>G: beacon with flags bit 2
    G->>R: JSON line
    R->>M: ingest_band_reports (press flag, next 250 ms batch)
    M->>M: window still open: record payment or complete the claim
    opt payment
        M->>M: insert band_command paid
        M-->>R: band_command row
        R->>G: cmd <id> paid
        G->>B: PAID green flash 1.5 s
        R->>M: ack_band_command (sent)
    end
```

Two details make this robust. The press flag is accumulated with OR in the fleet map, so it cannot fall between two batches. And the module, not the bridge, decides whether the press was inside the window, so a late or duplicated report cannot confirm anything. If no press arrives, the band's PAY state ends on its own after 8 s and the server marks the attempt declined; the bridge sends nothing. [Payments-Nessie](Payments-Nessie.md) and [Attendee-App](Attendee-App.md) own the two flows.

### Rate limiting and safety rules on the command line

The gateway spends about 120 ms transmitting each command (three repeats, 40 ms apart) and reads its serial input only between commands, so the bridge keeps one command in flight: it writes a line, waits for the `ack` line or 250 ms (starting value), then writes the next. The sustained rate is therefore about six commands a second. The queue is a priority queue: one-shots first, then forced states, then exit colours and override, then calibration re-sends. Entries are coalesced by target and command name, keeping the newest arguments, so a burst of directive changes collapses to one command per band per setting. A fleet-wide per-band exit change (nine commands) takes about 1.5 s to go out, which is acceptable because the state command that makes the colour visible is sent first and the band shows the previous colour until the new one lands.

Rules enforced by `bandit-protocol` before anything is written, so that no caller can break them:

- `exit` is never sent to target 0 (it would recolour every station).
- `state 9` is never sent to a band (ignored by the firmware) and is sent to a station only by its id (it means off).
- `clear` is sent only for an explicit `band_command` of kind `clear`.
- `pay` and `paid` go to a single band id, never target 0.
- `thresh` requires yellow below red, both within 1 to 20; `rssi` magnitudes within 30 to 90; holds within 1 to 255 tenths; every argument fits one byte.
- Targets outside 0, 1 to 9 and 101 to 105 are rejected.

A rejected command is logged and counted in the heartbeat; it is never silently dropped.

### Raw log and calibration capture

The bridge writes every line it reads and every line it writes to a `.jsonl` file: one JSON object per line, the gateway's object unchanged plus the laptop receive time in milliseconds since the epoch, the direction (in or out), and, for outgoing lines, the command text. Unparseable gateway lines are logged as raw text with the same timestamp. A new file starts with each run and whenever the serial port is reopened. At the demo rate the log grows by roughly 50 MB an hour (rough estimate), which the laptop absorbs easily.

The log serves three purposes: replay through [Simulator](Simulator.md), post-mortem of a demo run (what each band reported, what was commanded, when), and calibration capture. For calibration, the bridge tags each logged report with the `fleet_config` values in force when it was received, so an offline pass can group reports by formation and threshold set. The capture itself is driven from the ops dashboard: ops marks the start and end of each formation and the known density, which the module stores as `calibration_point` rows via `set_calibration` ([Ops-Dashboard](Ops-Dashboard.md), [Safety](Safety.md)); the dashboard computes the mean `neigh` over the window from its `band_report` subscription, and the log is the exact record if the numbers are later questioned. The bridge adds nothing to the live calibration loop beyond delivering `thresh` and `rssi`.

### When the serial cable or the server goes away

| Outage | Detection | While it lasts | On recovery |
|---|---|---|---|
| Serial port lost (cable pulled, gateway reset, port renamed) | read error, or no line at all for 3 s while stations should be beaconing (starting value) | keep the SpacetimeDB connection; keep logging whatever arrives (nothing); stop the batcher, so the module's heard times age and every band goes stale on the dashboard, which is the truth; keep the command queue, dropping one-shots as they expire; report the outage in the heartbeat | reopen the port (retry every second, auto-detect again); expect the gateway's boot line if it reset; send queued commands; nothing needs resync on the bands, because they did not reboot |
| SpacetimeDB connection lost (Maincloud unreachable, laptop Wi-Fi) | SDK disconnect callback or a failed reducer call | keep reading and logging; keep only the latest state per band (no backlog); bands keep their local behaviour, which is the point of on-band safety; the last directives already sent keep running on the bands until their holds expire | reconnect and re-subscribe; mark every band changed so the first batch carries the whole fleet; run the reconciler against the fresh directives; send unacked one-shots that have not expired and acknowledge the rest as `expired` |
| Both | both of the above | log only | both recoveries, serial first |

The deployment fallback (standalone SpacetimeDB on the laptop, [SpacetimeDB](SpacetimeDB.md)) changes only the host the bridge connects to.

### Room for a second gateway

A second gateway (with its own id, a proposed firmware extension) is a second serial port on the same bridge process, not a second process, so that one fleet map and one command queue exist. Each incoming report is deduplicated by band id and `seq` within a 1 s window; the first copy wins and the duplicate only updates `gateway_rssi` if it is stronger, which gives a crude "which gateway is closer" signal. Commands are written to every port so that coverage adds up; bands tolerate the repeats because every command is idempotent, except `buzz`, which goes out on one port only. Type 3 echo lines (each gateway hears the other's commands) are already ignored, so nothing else changes.

## Failure modes and fallbacks

| Failure | Effect | Design answer |
|---|---|---|
| Bridge process crashes | no reports, no commands; bands continue locally | restart it (a supervisor or by hand); it holds no state that matters, resubscribes and resyncs in one batch; the ops dashboard shows the missing heartbeat within 10 s |
| Gateway drops lines because the reader stalled | gaps in `seq`, loss estimate rises | the reader runs alone on its thread and never blocks on the module or the log; loss is visible per band in the heartbeat |
| A command triple is lost on air | the band keeps its old state | the reconciler re-sends while the reported state disagrees; unverifiable settings are re-sent every 30 s |
| A band reboots mid-demo | it forgets thresholds and directives | `seq` reset triggers a per-band resync |
| Dashboard or module writes a bad directive (for example exit on target 0) | could recolour every station | `bandit-protocol` validation rejects it; the heartbeat counts rejections |
| Command flood from the server | gateway input overruns, commands lost | one in flight, coalescing by target and name, priority order |
| A `pay` arrives after an outage | a stale prompt on someone's wrist | one-shots carry a useful life; late ones are acknowledged as `expired` and never sent |
| `clear` misuse ends someone's SOS | an SOS vanishes | `clear` is only ever sent for an explicit `band_command`; forced states are released by expiry |
| The laptop clock jumps | ages and log timestamps shift | the bridge sends ages measured from a monotonic clock; only the log's wall-clock field is affected |
| Server reachable but slow | batches queue up | a batch that has not been sent when the next tick comes is replaced by a fresh one (latest state only); nothing accumulates |

## Dependencies

**Depends on**

- [Hardware](Hardware.md): the gateway wire protocol, the band's state precedence and the never-broadcast rules.
- [SpacetimeDB](SpacetimeDB.md): `ingest_band_reports`, `ack_band_command`, `heartbeat`, the tables `band_directive`, `band_command`, `fleet_config`, `band_report`, `service_heartbeat`, and the `bridge` role.
- [Rust-Backend](Rust-Backend.md): the Cargo workspace, service identity and role grant, configuration.

**Used by**

- [Safety](Safety.md): every directive (exit guidance, evacuation, medic approach, manual override) reaches a band through the reconciler; every SOS, fall and press reaches the module through the batcher.
- [Payments-Nessie](Payments-Nessie.md) and [Attendee-App](Attendee-App.md): the press-to-confirm round trip.
- [Ops-Dashboard](Ops-Dashboard.md): fleet liveness, loss and service health from `band_report` and `service_heartbeat`.
- [Simulator](Simulator.md): replays the bridge's raw log and shares `bandit-protocol`.

**If you delete this file**

- Delete [Hardware](Hardware.md)'s software coupling too: real bands can no longer report or receive directives; only [Simulator](Simulator.md) feeds `ingest_band_reports`.
- Move the `bandit-protocol` crate description to [Simulator](Simulator.md), which still needs it.
- Remove the `bridge` role and the bridge rows from the service tables in [Rust-Backend](Rust-Backend.md) and [Architecture](Architecture.md), and the `bandit-bridge` row from the service health panel in [Ops-Dashboard](Ops-Dashboard.md).
- In [Safety](Safety.md), note that `band_directive` and `band_command` rows have no consumer for real bands.

## Open questions

- Should the module expose the per-band "desired versus reported" mismatch (for example as a field on `band_report`) so the ops dashboard can show which bands have not yet obeyed, or is the bridge's heartbeat counter enough?
- Is the 1 s heartbeat report per band the right balance between batch size and liveness accuracy once a second gateway or more bands exist?
- Where do the raw logs go after the event: kept on the laptop, or uploaded through `bandit-api` as `blob_ref` rows for the insurance evidence pack ([Hyphenate](Hyphenate.md))?
