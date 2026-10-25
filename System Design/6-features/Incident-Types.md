# Incident types

Every incident at the event becomes a claim the same way: evidence pack, the Evidence Engine, the Decision Engine, the organizer. What changes from one incident type to the next is who claims, which policy pays and who, if anyone, is charged.

This file is the one place that lists them. [Insurance](Insurance.md) holds the claim flow they all share.

## The five types

| Type (`incident_kind`) | What happened | Who claims | Which policy pays | Who is charged |
|---|---|---|---|---|
| `fall` | an attendee's band saw them fall | the attendee | the venue's policy, medical payments cover | nobody |
| `sos` | an attendee held their band's button | the attendee | the venue's policy, medical payments cover | nobody |
| `property` | the venue's own equipment was broken | the venue | the venue's policy, property cover | the attendee who broke it, when security names one |
| `theft` | an attendee's belonging was stolen | the attendee | the attendee's own policy, personal property cover | the attendee who took it, when security names one |
| `breakage` | an attendee's belonging was broken by someone else | the attendee | the attendee's own policy, personal property cover | the attendee who broke it, when security names one |

## Which policy pays

The venue's general liability policy pays injuries (medical payments, no fault needed) and the venue's own equipment (property cover, the venue carries the deductible).

The venue's policy never pays for an attendee's own belongings. A general liability policy excludes guests' property, so a stolen laptop is a claim on the attendee's own policy.

Each attendee has their own policy, an `attendee_policy` row: the insurer, the policy number, the personal property cover's per-claim limit, its yearly limit and its deductible. The policy terms come from the attendee's policy PDF, which the Evidence Engine reads.

The crowd of the live run has no PDFs. Each crowd attendee's terms are drawn once from a generator seeded with their identity, so the same attendee always has the same policy.

Amounts, all in code:

| Cover | Payout | The claimant carries |
|---|---|---|
| medical payments | the covered bill lines, up to the limits | nothing |
| property (venue) | the repair cost, up to the limits | the venue carries the deductible |
| personal property (attendee) | the item's value up to the per-claim limit, less the deductible | the deductible |

BandIt pays a personal property claim into the attendee's wallet at once and collects the payout from the attendee's insurer, the same way it collects from the venue's insurer.

## Reporting

An injury opens from the band: the fall or the SOS.

Venue equipment opens from the security cameras or from staff. Staff log the repair cost on the incident.

A theft or a breakage opens from the attendee. On their tap page they press "Something stolen or broken?", say what it was, what it was worth and what happened. The incident opens where their band is, with their report as its `incident_loss` row.

Security then answers it on the floor: checks the security cameras, writes a note and resolves it. Resolving a `property`, `theft` or `breakage` incident with a cost opens its claim, and the attendee's report is the claim's statement.

## Who is responsible

Security names the person responsible on the incident with `name_responsible`: the band, and how they know (the camera footage, a witness, the band itself).

Code accepts only a band that SpacetimeDB had at the spot when it happened: one of the incident snapshot's bands present, within 10 m. It refuses the claimant's own band, and a band nobody wears.

The named person becomes two facts in the evidence pack: who it is and that their band was at the spot.

## Evidence by type

| Type | First source | Second source | Also in the pack |
|---|---|---|---|
| `fall`, `sos` | the band | the light circle and the medic's note, or the security cameras | the hospital report |
| `property` | the staff report and repair cost | the security cameras | the bands at the spot, the person named |
| `theft`, `breakage` | the attendee's report: the item and its value | the security cameras | where the attendee's band had been, the bands at the spot, the person named |

The corroboration rule is the one in [Insurance](Insurance.md): a camera sighting that agrees on time and zone corroborates a non-injury claim, a camera that disagrees disputes it, and no camera leaves it uncorroborated.

## The Evidence Engine

The Evidence Engine handles every type explicitly. Its de-identified claim document carries the type, the cover, the kind of item (`laptop`, `phone`, `speaker`), its value and whether a person was named at the spot. It never carries a name.

| Type | Clauses it should match |
|---|---|
| `fall`, `sos` | the venue policy's medical payments clause; its employee exclusion |
| `property` | the venue policy's property clause, its deductible |
| `theft` | the venue policy's guest property exclusion; the attendee policy's theft clause, its deductible |
| `breakage` | the venue policy's guest property exclusion; the attendee policy's accidental damage clause, its deductible |

1. Validation. The `bandit-claims-validate` pipeline knows the five types and refuses nothing: a theft or a breakage with no item or no value fails validation.
2. Policy clauses. The Evidence Engine matches the claim to the clauses of both policies, the venue's and the attendee's own, by meaning. Each clause is a document in the `bandit-policy-clauses` index: the policy, the clause, the cover it belongs to and whether it grants or excludes.

   A theft finds the venue policy's exclusion of guests' property and the attendee policy's theft clause. A broken speaker finds the venue policy's property clause and its deductible. The matched clauses go into the claim's checks, so Claude and the organizer read the wording that decides it.

## The Decision Engine

Claude reads the type's evidence before it decides: for `theft` and `breakage` the attendee's report, the security cameras, the person named and the matched policy clauses; for `property` the security cameras and the clauses.

Code holds Claude to the same limits for every type: Claude never sets an amount, pays only inside a rule an organizer approved, and refuses on its own only on a failed check.

## Charges

A charge is what the person responsible owes. Code proposes it when the claim is paid: the whole loss, the repair cost or the item's value.

The organizer always decides a charge: approve or drop. No rule and no model charges a person.

An approved charge is collected from the person's wallet, a purchase at the venue on their Capital One Nessie account. From it the attendee who lost the item gets their deductible back into their wallet, and the rest repays the insurer (journal `J5 recovery`).

## What attendees see

On the tap page every attendee sees their own claims of every type, with their status and payout, and their charges: what for, how much and whether the organizer has approved it. Payouts, refunds and charges all show in the wallet's movements.

## The live run

The live run's seeded generator draws these types too: who loses what, who takes or breaks it, whether a camera covers the spot, and the item's value. The floor staff play security: the camera sighting, the note naming the person and the resolve.
