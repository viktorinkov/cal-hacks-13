# Native Elastic screenshots

Captured on 25 October 2026, approximately 11:58–12:00 UTC, with the official Chrome browser runtime. The existing Elastic session was signed in. These are native JPEG captures. No page text, data, dashboard definition, workflow, or image content was changed. Detail versions use the browser screenshot crop option. Full captures remain beside them.

These images belong in the article's How it works section. Do not place them inside Excalidraw diagrams.

## Recommended article images

### Event import in Kibana

File: `event-import-dashboard.jpg`

Source: <https://bandit-c79b82.kb.us-east4.gcp.elastic.cloud/app/dashboards#/view/bandit-pipeline-calhacks-13>

Placement: after the import-result paragraph in the Bright Data section, near the event preparation diagram. Replace or reconcile its older 245-record example with this identified run if using the new screenshot.

Caption: “Kibana shows 237 source records combined into 62 organizations. Exact matches handled 52 organizations, while Agent Builder resolved 10. The run flagged 25 gaps for review.”

The displayed run is `calhacks-13-import-1`. This is a stored import result, not a live crowd feed. The screenshot's all-time panels are queries for that named run. The lower dashboard includes individual merge reasons, but those rows are not visible in this capture. Do not claim the image shows those reasons.

### A completed Elastic investigation

Files: `investigation-workflow-execution.jpg` and `investigation-workflow-execution-full.jpg`

Source: <https://bandit-c79b82.kb.us-east4.gcp.elastic.cloud/app/workflows/bandit-investigate-claim?executionId=087c9284-f2d1-4bf1-958a-4c30f01c8218&lastViewedExecutionId=087c9284-f2d1-4bf1-958a-4c30f01c8218&tab=executions&view=graph>

Placement: after the current paragraph about visible workflow execution and failed judgment calls in Elastic turns documents into usable evidence. Keep the existing architecture diagram.

Caption: “This saved Elastic workflow completed its schema and investigation steps in nine seconds. The worker uses the result to continue the claim review.”

The screenshot proves this bounded workflow turn completed. It does not prove an entire claim settled in nine seconds. The interface calls its API-invoked trigger “Manual.” This does not mean that the organizer runs a laptop script. The investigator deliberately has no saved general-purpose Agent Builder tools. The worker supplies and executes allowed claim-scoped requests.

The detail image is a native crop at x=48, y=48, width=1672, height=455 from the 1728×963 viewport. It retains the workflow name, graph, completed status and duration while excluding unused canvas space.

### Elastic checks the proposed precedents

Files: `precedent-esql-run.jpg` and `precedent-esql-run-full.jpg`

Source: <https://bandit-c79b82.kb.us-east4.gcp.elastic.cloud/app/agent_builder/agents/bandit-rule-proposer/conversations/6e6629c7-6335-40b2-8b8e-e864befc79bb>

Placement: after the rule-proposal paragraph in Financial decisions stay within approved limits, following its rule diagram.

Caption: “The rule proposer ran this ES|QL query on approved claims 54, 58 and 62 before suggesting a payment limit. The query counts distinct claims and their payout bounds.”

The native tool dialog shows completed parameters and result, its exact ES|QL query and one result group. The stored response proposes a $2,400 ceiling. This is an existing proposal, not a new approval or a bank transfer. No new agent request was submitted to make this screenshot.

The detail image is a native crop at x=910, y=47, width=810, height=590 from the 1728×963 viewport. It preserves the tool title, parameters, query and result count. Use the full image if conversation context is more useful than query readability. The crop was recaptured at approximately 12:03 UTC after independent review.

These selected claims (54, 58 and 62) differ from the article's earlier claim-screen examples. Describe this as a separate Agent Builder run, not the execution behind claim 53.

## Supporting capture, not recommended for the article

File: `claims-evidence-dashboard.jpg`

Source: <https://bandit-c79b82.kb.us-east4.gcp.elastic.cloud/app/dashboards#/view/bandit-claims>

The dashboard rendered 71 distinct claims, 10 claims with a named person, zero invalid evidence packs and an approved settlement amount of $45,599. Its amount-panel title correctly says “Approved settlement amount (USD),” but the inner metric alias still says “paid.” Do not describe the number as confirmed transfers. The event-import dashboard is the clearer article proof, so omit this capture from the main article unless that alias is separately corrected and the image recaptured.

## Coverage review

Current code and sponsor coverage review: `.builds/diagram-style/devpost-revisions/elastic-coverage-additions.md`.

One useful prose replacement names the Jina embeddings already used in policy, people and booth mappings. Other major Elastic capabilities already appear in the article. Extra inventory paragraphs would repeat them.

The native interface now lists both `bandit-image-reader` and `bandit-read-image`. Earlier audit notes about their lazy installation and 404 responses are historical, not a current setup failure. This review opened existing records only. It did not create dashboards, upload data, invoke models, approve claims or execute payments.

Independent image review approved the import dashboard, workflow crop and precedent tool crop. It found no visible secrets. The reviewer recommended the tighter native ES|QL crop and omitting the claims dashboard. Both recommendations were applied to the delivery set. The task-created browser tab was closed, and existing user tabs were left open.
