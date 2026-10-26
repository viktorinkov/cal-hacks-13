# devpost.md: targeted edits for Claude's claim decisions

These match the code on branch vik-claude-decisions. Each one replaces a sentence or paragraph that now says the old thing (Claude only reviews, code and the organizer alone refuse). Apply them to the Mac's devpost.md by hand or as find-and-replace. The wording follows /mnt/project-files/devpost/TERMS.md.

## How it works, insurance paragraph

Find: "Claude checks whether the story holds up, and code decides coverage and the amount from a fee schedule. A claim that code can't settle goes to the organizer, who decides it."

Replace: "Claude investigates the evidence source by source and decides: pay, refuse or ask the organizer. Code decides coverage and the amount from a fee schedule, and holds Claude's decision to limits a person set."

## How we built it, the claims paragraph

Replace the paragraph that starts "**The claims agent.**" with these three:

**The insurance Decision Engine.** Our Rust workers take claim jobs from a queue in SpacetimeDB. The Anthropic Claude API (Claude Opus 5.5) reads the hospital report PDF into structured facts, and a de-identified copy of the claim goes through an Elastic ingest pipeline that validates it and ranks similar past claims.

Then Claude investigates with tools. It reads each evidence source itself (the band, the light circle, the security cameras, the medic's notes, the hospital report, the checks), searches the Evidence Engine's past claims by meaning, and counts how claims like this one ended with Elastic ES|QL. Every step shows live in the decision history.

Code checks every decision and holds it to its limits. Claude pays on its own only when every check passed, the evidence is corroborated and an organizer's approval gave it authority up to a ceiling; it refuses on its own only on a failed check. Anything else goes to the organizer as Claude's recommendation, and the model never sets an amount.

## Anthropic track, "What BandIt shows"

Replace with:

**What BandIt shows:** Claude Opus 5.5 decides insurance claims. It investigates each claim with tools, one evidence source at a time, weighs sources that disagree, and decides to pay, refuse or ask the organizer, with every step in the decision history.

We know where it could go wrong. A wrong refusal hurts an injured attendee most, so a refusal on Claude's judgment alone always goes to a person; Claude pays only inside the authority a person gave it, and code sets every amount. A decision that cites a fact not in the evidence, invents a dollar figure or pays without reading the evidence is sent back once, then set aside.

Claude also turns medical history PDFs into a medical card, reads hospital reports into facts, and writes the notice of loss and the recovery letter.

## Challenges, "Letting an AI near money"

Replace with:

- **Letting an AI near money.** We wanted Claude to decide claims without letting it pick a payout. Claude decides pay, refuse or ask; code sets coverage and amounts, lets a payment through only inside a learned rule's ceiling, and sends any refusal that rests on judgment alone to a person.

## What we learned, the last bullet

Find: "Claude is great at reading a clinic record or spotting that an injury happened at home. Code is better at money."

Replace: "Claude is great at weighing evidence, like spotting that an injury happened at home. Code is better at money and at holding a decision to its limits."
