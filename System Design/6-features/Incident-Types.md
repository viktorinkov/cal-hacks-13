# Incident types

Every incident becomes a claim the same way: evidence pack, The Evidence Engine, the insurance Decision Engine, the organizer. What changes from one type to the next is who claims, which policy pays and who, if anyone, is charged.

This file lists the types in one place. The claim flow they share, the charges and the policy clauses are in [Insurance](Insurance.md); the clause search is in [Elastic](../7-integrations/Elastic.md).

## The types

| Type (`incident_kind`) | What happened | Who claims | Which policy pays | Who can be charged |
|---|---|---|---|---|
| `fall`, `sos` | an attendee is hurt | the attendee | the venue's general liability, medical payments cover | nobody |
| `property` | the venue's own equipment is broken | the venue | the venue's property policy, above its deductible | the attendee who broke it, when staff named them |
| `theft` | someone steals from the venue: its equipment, merch or a sponsor's gear at its booth | the venue | the venue's property policy, theft as a cause of loss, above its deductible | the attendee who took it, when staff named them |

An attendee's own belongings are not a claim at the venue. The venue's policy excludes guests' property, and the attendee's own insurer pays them, so BandIt opens no claim for them.

The module keeps one more kind, `breakage`, from an earlier design. Nothing opens it, and it is answered like `property`.

## The venue's policy

The venue holds one package policy with two parts. Its general liability part pays injuries (medical payments, no fault needed); a liability policy excludes property the venue owns, rents or occupies. Its property part, the venue's property policy, pays to repair or replace the venue's own equipment, and to replace what was stolen from it, above a deductible the venue carries.

The speaker knocked off its stand: a $2,400 repair. The insurer pays $1,900 and the venue carries the $500 deductible.

## Reporting and evidence

| Type | How it opens | First source | Second source | Also in the pack |
|---|---|---|---|---|
| `fall`, `sos` | the band | the band | the light circle and the medic's note, or the security cameras | the hospital report |
| `property` | the security cameras or staff, with a cost note for the repair | the staff report | the security cameras | the bands at the spot, the attendee named |
| `theft` | staff, at the spot, with a cost note for what was taken and its value | the staff report | the security cameras | the bands at the spot, the attendee named |

Resolving a `property` or `theft` incident with a cost note opens the venue's claim.

## The person responsible

Staff name the attendee who broke or took it with `name_responsible_band`. Code checks the band against SpacetimeDB's exact record: it was in the incident's zone at the time, it was one of the bands at the spot within 10 m when the incident opened, and the security cameras agree when they saw it.

The named attendee is in the evidence pack, and Claude recommends a charge or none. The organizer approves or waives every charge once the claim is paid, and the charged attendee pays it from their wallet or disputes it on their tap page ([Insurance](Insurance.md#charges-to-an-attendee-next-to-build)).

A charge is the whole loss. Paid, it repays the insurer what it paid on the claim and the venue its deductible: the speaker's $2,400 charge is $1,900 to the insurer (`insurer_payable`) and $500 to the venue (`recoveries`), journal J5.

## What The Evidence Engine looks for

The Evidence Engine handles each type explicitly. Its de-identified claim copy carries the type, the cover, the loss and whether an attendee was named. Its clause search looks in the sections that can decide that type:

| Type | Clauses it should find |
|---|---|
| `fall`, `sos` | the venue's medical payments clause, its exclusions, its service window, the other-insurance clause |
| `property` | the venue's property clause, its deductible, the subrogation clause |
| `theft` | the venue's property clause on theft, its conditions and exclusions, its deductible, the subrogation clause |

## The live run

The live run's seeded generator draws these types too: who breaks or takes what, whether a camera covers the spot, what it was and its value. The floor staff play security: the camera sighting, the cost note, naming the attendee and resolving the incident.
