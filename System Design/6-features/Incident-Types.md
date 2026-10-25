# Incident types

Every incident becomes a claim the same way: evidence pack, The Evidence Engine, the insurance Decision Engine, the organizer. What changes from one type to the next is who claims, which policy pays and who, if anyone, is charged.

This file lists the types in one place. The claim flow they share, the charges and the policy clauses are in [Insurance](Insurance.md); the clause search is in [Elastic](../7-integrations/Elastic.md).

## The types

| Type (`incident_kind`) | What happened | Who claims | Which policy pays | Who can be charged |
|---|---|---|---|---|
| `fall`, `sos` | an attendee is hurt | the attendee | the venue's policy, medical payments cover | nobody |
| `property` | venue or sponsor equipment is broken | the venue | the venue's policy, property cover, above its deductible | the attendee who broke it, when staff named them |
| `theft` | venue or sponsor property is taken, such as merch or a laptop from a booth | the venue | the venue's policy, property cover, where its theft clause covers the loss | the attendee who took it, when staff named them |
| `belongings` | an attendee's own things are lost, stolen or broken | the attendee | the attendee's own policy, personal property cover; the venue's policy excludes property in its care | the attendee who took or broke it, when staff named them |

## The attendee's own policy

Each attendee can have their own policy on file, an `attendee_policy` row: the insurer, the policy number, the personal property cover's per-claim limit, its yearly limit and its deductible, and the policy document it was read from.

A `belongings` claim pays from it: the item's value up to the per-claim limit, less the deductible, which the attendee carries. BandIt pays it into the attendee's wallet and collects it from their insurer.

With no policy on file the claim goes to the organizer with the venue's exclusion clause, and the tap page gives the attendee the incident record for their own insurer.

The crowd of the live run has no documents. Each crowd attendee's policy terms are drawn once from a generator seeded with their identity, so the same attendee always has the same policy.

## Reporting and evidence

| Type | How it opens | First source | Second source | Also in the pack |
|---|---|---|---|---|
| `fall`, `sos` | the band | the band | the light circle and the medic's note, or the security cameras | the hospital report |
| `property` | the security cameras or staff, with a cost note for the repair | the staff report | the security cameras | the bands at the spot, the attendee named |
| `theft` | staff, with the item and its value | the staff report | the security cameras | the bands at the spot, the attendee named |
| `belongings` | staff, for the attendee, with the item and its value | the staff report | the security cameras | the attendee's own policy, the bands at the spot, the attendee named |

Resolving a `property`, `theft` or `belongings` incident with a cost note opens its claim.

## The person responsible

Staff name the attendee who broke or took it with `name_responsible_band`. Code checks the band against SpacetimeDB's exact record: it was in the incident's zone at the time, it was one of the bands at the spot within 10 m when the incident opened, and the security cameras agree when they saw it. The band is never the claimant's own.

The named attendee is in the evidence pack, and Claude recommends a charge or none. The organizer approves or waives every charge, and the charged attendee pays it from their wallet or disputes it on their tap page ([Insurance](Insurance.md#charges-to-an-attendee-next-to-build)).

## What The Evidence Engine looks for

The Evidence Engine handles each type explicitly. Its de-identified claim copy carries the type, the cover, the loss and whether an attendee was named. Its clause search looks in the sections that can decide that type:

| Type | Clauses it should find |
|---|---|
| `fall`, `sos` | the venue's medical payments clause, its exclusions, its service window, the other-insurance clause |
| `property` | the venue's property clause, its deductible, the subrogation clause |
| `theft` | the venue's theft clause and its conditions, the subrogation clause |
| `belongings` | the venue's exclusion of property in its care; the attendee policy's personal property clause and its deductible |

## The live run

The live run's seeded generator draws these types too: who breaks or takes what, whether a camera covers the spot, the item and its value. The floor staff play security: the camera sighting, the cost note, naming the attendee and resolving the incident.
