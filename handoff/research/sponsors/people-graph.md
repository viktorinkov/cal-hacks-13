# Where the people graph lives

**Decision: a hybrid split by the kind of question, the same split as the rest of the design.** SpacetimeDB holds the graph itself: the people, booths and companies, and the links between them that the bands actually measured. Elastic adds the meaning: which people are into the same things, and lighting up the graph by a phrase. The browser draws both in one picture. Solid lines are facts from SpacetimeDB, live. Dashed lines are meaning from Elastic.

So the answer to "semantic or relational?" is both, for different parts. The nodes and links are exact facts that change live and are private, which is relational work. "These two people care about the same things" is semantic work.

## Options weighed

| Option | Verdict | Why |
|---|---|---|
| SpacetimeDB tables and views | **Yes: the graph itself** | Every link is an exact fact: met for 40 min, visited a booth, works at a company. A new encounter or visit becomes a link in the same transaction that writes it, and every screen redraws from its subscription right away. Consent (`findable`) is enforced in the views, not in the app. It is a relational database, so a person's neighbours come from indexed lookups. What it can't do: rank by meaning, because it has no vector search. |
| Elastic semantic and vector search | **Yes: the meaning layer** | Only Elastic can tell that two people who visited different booths care about the same things, from the embeddings of the booth texts. It can also rank the graph by a phrase. It should not hold the links: it is a one-way copy that runs slightly behind, it does not push changes, and it cannot show each viewer only what they may see. It also has no clustering algorithm (data frame analytics offers outlier detection, regression and classification only). |
| Kibana Graph (the HackMIT approach) | **No** | Elastic's docs mark Graph `serverless: unavailable`, so it would need a second, Hosted deployment. It also solves a different problem: it finds links hidden in documents by counting how often terms appear together (by default at least 3 documents per link, from a subset). That fits supply chains, where links are implicit in shipment records. Here the bands measure the links directly, so there is nothing to discover, and a crowd of a few dozen real attendees is too small for its significance test. |
| Graph database (for example Neo4j) | **No** | A third store to keep in sync, with no live push to browsers and no consent checks. At event size (hundreds to a few thousand nodes) we only need one or two hops. |
| Separate Postgres | **No** | SpacetimeDB is already the relational store. Postgres would only be a copy without live push. |
| Browser | **Draws and clusters** | Sigma.js with graphology: a ForceAtlas2 layout and Louvain communities run in a web worker at this size. |

## What each part does

**SpacetimeDB (Social.md)**

- A new derived table, `people_link`, is written by the social step of `memory_tick`, following the "raw in, derived out" rule. Link kinds:
  - `met`: from an encounter, weighted by minutes, with the evidence.
  - `visited`: attendee to booth, weighted by minutes.
  - `works_at`: attendee to company.
  - `exhibits`: booth to company, from the import.
- Shared booth visits and same company are not stored as pairs of people. They are two people linked to the same booth or company node, and that shared node is what pulls them into one cluster in the layout.
- Only `findable` attendees get links.
- Two views:
  - `my_graph` (per caller): your own neighbourhood, with every person by display name.
  - `event_graph` (computed once for all viewers): the whole event for the ops big screen, with every person by display name.
- The judging moment: the graph grows live. Once someone has stayed at a booth for 2 minutes, or two people have been together for 10, the link appears on the big screen in the same transaction that records it. Both thresholds are starting values, so the scripted run can shorten them.

**Elastic (Elastic.md)**

- A new index, `bandit-people`, holds one document per findable attendee. Its `interests` field (`semantic_text`) is built by `bandit-indexer` from the booths where that person spent the most time: their names, descriptions and tags. Turning `findable` off deletes the document.
- A new route, `GET /graph/similar` in `bandit-api`, returns attendee ids ranked by meaning. These are drawn as dashed "into the same things" links:
  - On the ops screen: the top 3 for each attendee, by name.
  - On an attendee's screen: only between people already in their own graph ("you and the person you met in Zone B are both into robotics"). Strangers are never suggested.
- Semantic lens: typing "wearable robotics" on the graph screen sends the phrase to the existing `/search/booths` route, which ranks booths by meaning. The graph then highlights those booths and everyone linked to them.
- Same company: at import, the organizer already resolves people on event pages to companies, and a claimed profile carries that company. That is the only source of `works_at`; there is no company field at onboarding.
- Kibana dashboard "Interest map", for the Elastic judges: anonymous totals over `bandit-memories` and `bandit-people`, such as minutes per category and the top booths per interest cluster. An optional Vega network panel is the closest thing to the HackMIT graph on Serverless: Vega is GA there and can read ES|QL.

**Browser (attendee app and ops dashboard)**

- Solid links come from the SpacetimeDB subscription, live. Dashed links come from `/graph/similar`, refreshed every 30 s.
- A toggle sets the clusters: by memories (Louvain over `met` and `visited`), by company (`works_at`), or by interest (Louvain over Elastic's dashed links). Each cluster is labelled with the top booth tags of its members.

Nothing flows back from Elastic into SpacetimeDB. Elastic's similar links reach the browser as ids through `bandit-api`, as the other search routes do.

## Test crowd (decided)

Test bands get fully made-up owners, so the big-screen graph shows a real-looking crowd instead of at most 9 people. Each test band gets a fake attendee with `findable` on, a made-up name and Meta handles, and it creates visits and encounters through the same social step as a real band (a Test-Bands.md and Social.md change). The handles are hand-picked, not scraped: famous people's public Instagram accounts plus Viktor's own (`viktorinkovski`), which is Viktor's call. They appear only on test attendees, whose bands are already flagged as test bands. Socials are Meta only (Viktor's call; it's the sponsor track), which is a Social.md change for the design thread.

## Sources

- Kibana Graph is marked `serverless: unavailable`: [docs source](https://github.com/elastic/docs-content/blob/main/explore-analyze/visualize/graph.md), [page](https://www.elastic.co/docs/explore-analyze/visualize/graph)
- Graph explore API, co-occurrence and sampling defaults: [API reference](https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-graph-explore)
- Vega is GA on Serverless and reads ES|QL: [docs source](https://github.com/elastic/docs-content/blob/main/explore-analyze/visualize/custom-visualizations-with-vega.md)
- Data frame analytics types (no clustering): [docs source](https://github.com/elastic/docs-content/blob/main/explore-analyze/machine-learning/data-frame-analytics/ml-dfa-overview.md)
- SpacetimeDB views (indexed lookups only, anonymous views shared by all subscribers, query-builder views evaluated incrementally): [Views](https://spacetimedb.com/docs/functions/views)
- SpacetimeDB subscription SQL (at most two-table joins, on indexed columns): [SQL reference](https://spacetimedb.com/docs/reference/sql)
- SpacetimeDB has no vector or full-text search in its docs index: [llms.txt](https://spacetimedb.com/docs/llms.txt)
