# bandit-claims

Drives and shows BandIt's incident-to-claim flow from the terminal. It plays every person and device: simulated bands (ids 90 to 99, never real hardware), the medic, the approvers, the insurer and the vision stub. `bandit-workers` runs the Claude, Elastic and Nessie jobs alongside it.

## Run the story on a local database

```bash
var/stdb publish -s insurance-local -p spacetimedb/server bandit-insurance -c -y
```

```bash
cargo run -p bandit-claims -- setup
```

```bash
SPACETIMEDB_URL=http://127.0.0.1:3088 SPACETIMEDB_DATABASE=bandit-insurance ELASTIC_INDEX_PREFIX=bandit-insurance-local cargo run -p bandit-workers
```

```bash
cargo run -p bandit-claims -- story
```

`var/stdb` wraps the `spacetime` CLI with this clone's own config, so a local login never touches `~/.config/spacetime`. `setup` creates one identity per actor (tokens in `var/identities`), grants roles as the module owner, imports the venue if none is loaded, claims the simulated bands for the attendees, and seeds the policy, covers, authority matrix and camera. It is safe to run twice.

## The story

1. Jordan falls on Main stage with three witnesses. The urgent-care bill is cut from $1,308.00 to $895.00 by the fee schedule (one unrelated line excluded), so the claim goes to Dana Ruiz. A stale approval fails closed; her real approval pays Jordan through Nessie and teaches rule v1.
2. Maya falls the same way with a first-aid record for $180.00 and settles automatically under rule v1.
3. Sam Patel's record says the ankle was hurt at home. Every code check passes; the claims agent sends it to a person.
4. Lee falls but the light circle formed on Sponsor row: refused, with the checks listed.
5. A speaker falls on Main stage with camera evidence: routed to Dana, approved, recovery letter requested.
6. The insurer pays claim 1 and it reconciles.

## Commands

| Command | Does |
|---|---|
| `setup`, `status` | prepare the database; show identities and whether the worker is running |
| `fall --band 90 --witnesses 94,95,96 [--zone "Main stage"] [--witness-zone ...]` | a simulated fall and its light circle |
| `treat --incident N --note "..."`, `resolve --incident N` | the medic's part; resolving opens the claim |
| `property --zone "Main stage" --note "..." --cost 2400.00 [--camera]` | a property incident, optionally with the vision stub |
| `attach-record --claim N --template urgent-care-wrist` | renders the synthetic record for the claim's date and zone and files it |
| `claims`, `show N`, `letters N`, `verify-pack N` | the queue, one claim in full, its letters, its pack hash recomputed |
| `approve N --as dana [--ceiling 1000.00] [--no-learn] [--stale]`, `refuse N --as dana --reason "..."` | the named approver |
| `insurer-paid N --amount 895.00 --ref NWM-55120`, `recovery N --to "..." --contact ...` | reconciliation and the recovery query |
| `wait N --status settled` | block until a claim reaches a status |
| `scorecard [--rounds 3]` | planted genuine and fake claims; straight-through rate, dollars wrongly paid, precision and recall |

Record templates are in `fixtures/medical-records/`. The Kibana dashboard for the Elastic copy is installed with `crates/claims-elastic/kibana/install.sh`.
