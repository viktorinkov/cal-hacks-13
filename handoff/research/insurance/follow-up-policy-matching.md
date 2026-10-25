# Follow-up: match claims against the insurance policies, not past claims

Viktor's call (Oct 25, 01:46): comparing a claim against past claims does not make sense. The Evidence Engine should find what the actual insurance policy says about this claim. The design comes first; no code changes until it is agreed.

## What changes, as the branch stands today

On vik-claude-decisions, the Evidence Engine's part in a claim is past claims:
- The verify job ranks the 3 closest past claims (`similar_claims` on `bandit-claims`).
- Claude's tools `search_past_claims` (semantic search) and `past_claim_stats` (ES|QL counts by outcome) read the same index.

## Proposed direction

1. Index the policy wording, clause by clause, in a new Evidence Engine index. That covers the venue's general liability policy (medical payments and property cover: insuring agreement, limits, exclusions, conditions) and the attendee's own policy from the insurance card PDF they upload. Each clause gets an id, its section, the policy it belongs to, and a semantic_text body.
2. Replace Claude's two past-claims tools with policy tools:
   - `search_policy {query}`: the clauses closest in meaning, for example "injury before the event", "services more than 30 days after", "employee injured at work".
   - `read_clause {clause_id}`: one clause in full.
3. The decision cites clauses: a covered clause for a pay, an exclusion for a refusal. Code checks that every cited clause exists and belongs to a policy on this claim, the same way it checks cited facts.
4. The guard stays: amounts from code, pay only inside an organizer's authority, refuse alone only on a failed check, and now a refusal that cites an exclusion clause could count as grounded.
5. The verify job's "3 closest claims" either goes, or becomes "the clauses this claim touches", so the organizer sees the policy text next to the evidence.

## Open questions for the design

- Does the attendee's own policy decide anything here, or only the venue's (medical payments cover pays regardless of the attendee's insurance)? A likely use: coordination of benefits, so the letter names the attendee's insurer.
- Do the policy PDFs exist yet? The venue policy is a generated summary in code today (`policy_summary` in insurance/flow.rs). The attendee's insurance card is read into the medical card, not stored as clauses.
- Do learned rules stay as the organizer's authority, or should each rule point at the clause it applies?
