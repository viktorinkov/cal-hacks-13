# How past projects drew their Elastic part

Research for the Evidence Engine frame of the system design board (Oct 25).

## Examples

1. OpsMemory AI (Elasticsearch Agent Builder Hackathon gallery): https://devpost.com/software/opsmemory-ai and https://github.com/atharvaawatade/OpsMemoryAI. The README draws one agent box with four tool boxes, each naming its query type and index (`policy_search (Index Search -> ops-decisions)`, `incident_memory_search (ELSER Semantic -> ops-incidents)`, `cascading_pattern_detector (ES|QL -> ops-incidents)`, `create_review_ticket (Elastic Workflow)`), then three verdict boxes (APPROVE / DENY / NEEDS_REVIEW), an index | purpose | query type table, and a learning loop where a postmortem is ingested back into the index.
2. paper-scout, the Elastic Cal Hacks workshop repo: https://github.com/jdarmada/calhacks-paper-scout. arXiv API -> ingest.py -> "Elasticsearch Serverless (index: papers)" with "semantic_text <- Jina v5 embeddings", then three consumers: search (keyword, semantic, hybrid + rerank), an Agent Builder agent (index_search, 2 ES|QL tools, a workflow), and a workflow.
3. AgentOverflow, 1st place Elastic prize at Cal Hacks 12: https://devpost.com/software/agentoverflow. A pipeline diagram ending in "Elasticsearch + Elastic Agent Builder", with the index names (`posts_ai`, `user_post_map`, `post_edges`) and the agent name.
4. Gauntlet and PHAROS (Agent Builder Hackathon winners): indices listed by role, every tool with what it reads, and the ES|QL commands named (STATS, EVAL, WHERE, BUCKET) with real thresholds.
5. CampaignPilot and EID/VL Duplicate Detection (winners): counts of indices and tools; EID/VL keeps "the detection agent surfaces candidates, it doesn't judge" apart from the scoring agent.
6. Elastic's own reference architectures (Search Labs): ingest pipeline -> named index with a semantic_text field -> named search tool -> MCP endpoint -> client.

## Patterns that make the Elastic part legible

- Each box names the feature and the index: tool (query type -> index).
- Index and pipeline names are on the diagram.
- Arrows say what goes in and what comes out.
- Finding evidence and deciding are separate steps.
- A write-back arrow shows decisions becoming future evidence.
- Real counts and thresholds are on the diagram.

Pages not opened: no Elastic winners turned up for TreeHacks, HackMIT, PennApps, LA Hacks or Cal Hacks 11; elastic.co images were blocked by the proxy (article text only); Gauntlet's architecture image was unreadable.
