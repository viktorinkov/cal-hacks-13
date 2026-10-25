# devpost.md edits: hybrid search with rerank

Shipped on vik-e2e (2cd8723). The clause search and the recap ranking are now hybrid: a keyword match and a semantic match, fused with RRF, then reordered by the Jina reranker `.jina-reranker-v3`. Apply only these edits to the devpost.md on Viktor's Mac. Re-read the file first and match each sentence by its meaning, since other threads are restructuring it. Leave every other line alone.

## Elastic sponsor section, the clause search paragraph

Find: "The clause search runs a semantic query over the claim's two policies. A filter keeps only the sections that can decide the claim's kind of incident."

Replace with these two paragraphs:

"The clause search and the recap ranking are hybrid searches too. Each runs a keyword match and a semantic match side by side, and the `rrf` retriever fuses the two lists with reciprocal rank fusion. Then the Jina reranker `.jina-reranker-v3` reads the query next to each top hit and puts the hits in a better order.

The keyword half catches a policy's exact words, such as "employee" or "pre-existing", which a meaning search can rank low. A filter keeps only the claim's policies and the sections that can decide its kind of incident."

## Elastic sponsor section, the Jina paragraph

After "So Band1t searches the scraped companies, the policy clauses and the recap by meaning." add this sentence to the same paragraph:

"The Jina reranker `.jina-reranker-v3`, on the same service, puts the top hits of the clause search and the recap ranking in order."

## Elastic sponsor section, Claude's clause search

"For claims, Claude searches the policy clauses by meaning." becomes "For claims, Claude searches the policy clauses by meaning and by exact words."

## What it does: insurance

"It searches by meaning, not by exact words." becomes "It searches by meaning and by exact words, and a reranker puts the best clauses first."

## What it does: recap

"It compares interests by meaning, not by exact words." becomes "It compares interests by meaning and by shared words, and a reranker puts the best match first."

## How we built it: Evidence Engine

"Then a search by meaning finds the clauses that apply to the claim." becomes "Then a hybrid search, by meaning and by exact words, finds the clauses that apply to the claim."

"(text that Elastic ranks by meaning, not exact words)" becomes "(text that Elastic ranks by meaning, with a keyword copy for exact words)".

"so a search by meaning can find them." becomes "so a search finds them by meaning and by their exact words."

"Claude also searches the policy clauses by meaning with `search_policy`." becomes "Claude also searches the policy clauses with `search_policy`, by meaning and by exact words."

## Meta track: recap

"Elastic's semantic search ranks both lists" becomes "Elastic's hybrid search with a reranker ranks both lists".

"runs two semantic searches" (or "runs three semantic searches") becomes "runs two hybrid searches" (or "three"). After the sentence that names what each search covers, add: "Each search fuses a keyword match and a semantic match, and the Jina reranker puts the result in order."
