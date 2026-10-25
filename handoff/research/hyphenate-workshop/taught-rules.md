# Does Hyphenate want taught rules on complicated claims?

Read 2026-10-25 03:20 UTC. Sources: the workshop deck "Beyond Agentic Harnesses · Hyphenate CalHacks Workshop.pdf" (pinned in Slack #cohost-hyphenate by Pavan Kumar, 2026-10-21; copy in this folder, text in `deck-text.txt`), the track doc and the #cohost-hyphenate posts quoted in `research/sponsor-tracks.md` (read 01:00 to 01:15 UTC).

Not read: Slack again (the Slack connector failed to connect in this session) and the workshop recording (the container cannot reach fathom.video).

## Answer

A person never teaches a rule directly. Each decision on an exception is kept as a precedent. A rule ("policy") comes later: the agent spots the same pattern across several precedents, proposes one general policy that cites them, and a controller approves it.

For BandIt: approving one complicated claim keeps a precedent and teaches no rule. Hyphenate's next step, which BandIt does not have, is Claude proposing a policy once several precedents for the same gap agree, for the organizer to approve.

## Quotes

Slide 3, the product: "You don't teach it. You don't write rules. It learns your business from the records you already produce, and gets smarter every day it runs."

Slide 9, what the system of work holds: "Work items · decisions and reasons · questions and approvals · learned policies · the log".

Slide 12, "Learn the job from the company's history": the agent queries 12 months of payments, then `propose_policy` "pol-001: wire ≤ $50 short → book gap to 6850", "evidence: 214 precedents · approver: human_controller", "needs_approval".

Slide 13, "Every correction becomes precedent.": an accountant corrects one match by hand, the agent runs `search_precedents`, finds "3 alike", thinks "Not Acme-specific: make it general", and proposes "pol-014: split a wire across every invoice number in its memo when the amounts add up", "evidence: prec-311, prec-318, prec-322", "needs_approval · human_controller".

Slide 16, roles: `ai_agent` may `propose` a policy, only `human_controller` may `approve` a policy, and "if action == "approve" and res.proposed_by == actor.id: return False # separation of duties".

Slide 19, weak submissions: "Memory that ends with the context window; "trust me"".

Track doc: "Time. Finance runs for months, not minutes. What happened in March should change what the system does in June." and "every call should trace back to the data, rule or person behind it".

## Proposal Viktor asked for (2026-10-25 03:20 UTC): a view of rule suggestions

1. Every organizer decision is kept as a precedent, on simple claims too.
2. When 3 approved precedents share a shape (incident kind and cover), Claude proposes a rule, for example "pay slips under medical cover up to $180, from claims 2, 4 and 7". The ceiling comes from those claims and never exceeds the policy's limit.
3. The organizer portal gets a "Proposed rules" view with Approve and Reject. Claude never approves its own proposal (separation of duties).
4. An approved proposal becomes the existing versioned `settlement_rule`, with its precedents as evidence. The "learn" checkbox and the "teach a rule" buttons go away.
5. Complicated claims stay one by one and get no proposals: a gap leaves no policy term to set a ceiling from.

The moment: after three similar approvals Claude proposes the rule, the organizer approves it, and the fourth claim pays itself.
