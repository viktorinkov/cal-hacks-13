# Diagram versions

The generator and committed boards are versioned in Git. `generator/share.py` also saves the exact editable scene, embedded image assets, content hash and successful public URL under `.builds/diagram-history/` for each publication. These are saved checkpoints, not a record of every browser edit.

| Version | Board |
|---|---|
| Original supplied hardware source, preserved unchanged | [Imported source](hardware-source.excalidraw) · [original public board](https://excalidraw.com/#json=SV8r2zpCNd0WMnaBi5Y17,BXzlynJTGvIPFxko8A9lag) |
| 22-frame board before compact rewrites | [Saved public board](https://excalidraw.com/#json=2e-lY4kti3drtPmT-cTcW,0q-h0XTqPpwc2bE7Tzj7Gg) |
| 23-frame compact board before colored fills, 25 October 2026 | [Saved public board](https://excalidraw.com/#json=AbC-cJG5rpz1Io_GrVUkp,57gFegA3_CN4Qa_hbYAH1w) |
| 23-frame board with colored fills and organizer import, 25 October 2026 | [Saved public board](https://excalidraw.com/#json=2UPhABYeEuaa5ysmPjgfy,P5I77Yu-EF6HqJmtdU43pA) |
| 23-frame board with final Maincloud colors and portal routes, 25 October 2026 | [Saved public board](https://excalidraw.com/#json=RVs5MKFQ6Nqkq3atzgMFl,5aolZTUddATQge1NYA23Zw) |
| Current 24-frame Plus revision, 25 October 2026 | [Main shared board](https://app.excalidraw.com/s/8CxNdcrvsHz/65Xc8JRcGo5) |
| Earlier 24-frame interim public checkpoint | [Saved verified snapshot](https://excalidraw.com/#json=lJxOTI-7mfSQ0o_OeBBvK,c6_iNnKwAAqgaNlp8EpksQ) |
| Current grouped 24-frame public checkpoint | [Verified snapshot](https://excalidraw.com/#json=p0Gilq4ytTdJY3VKU_r-r,Xq8vDszi13_7kLdKju8n0Q) |
| Reviewed claims revision, frames 12–14 | [Plus checkpoint](https://app.excalidraw.com/s/8CxNdcrvsHz/9cDPmI8128P) · [public checkpoint](https://excalidraw.com/#json=oxCugkrFGmofQRp-7b2Ck,8CYJ3avKkixRF4pbqo40VA) |
| Initial Live views excerpt, before colored fills | [Saved audience diagram](https://excalidraw.com/#json=43sXyVMbAkvjKOrABjlmj,iyo8fFEMLpWkGM_vjV8HWQ) · [full view inventory](views.md) |

The 24-frame restructure is online and verified on the main Plus board. It separates dedicated API integration diagrams from feature journeys. One architecture frame includes hosting; feature frames refer to the Evidence Engine and wallet without repeating their internals. Separate frames explain settlement amounts, reusable rules, typed friend search, automatic suggestions, live camera evidence and venue reconstruction. All hardware details remain on the main board.

The style guide keeps each main actor/component visible, with small filled property rectangles nested inside its card. Actual workflow and calculation stages can stand alone with arrows; related formula inputs and conditions stay within their calculation group. Original logos, illustrations and floor drawings remain editable assets; there are no app screenshots. Excerpts use the same generator and canonical numbers as the board.

Before the restructure, the exact editable 23-frame source, its generators and hashes were saved under `.builds/diagram-history/20261025T101317Z-before-sponsor-feature-restructure/`. The original hardware source remains byte-for-byte unchanged. The separate claims Plus scene is a reviewed checkpoint; the main shared Plus URL is the working board. Plus native version history is not available, so recovery relies on these explicit checkpoints and Git. They do not capture every browser edit.

The current grouped Plus revision is based on `.builds/diagram-style/restructure-24-grouped.excalidraw`: 1,695 active elements, 24 frames, 238 image instances and 42 referenced source assets, SHA-256 `cf3c2042cb40e737ec5d9dd9c02f9a39ec03fb96ebf56ba3d389c15cc842817a`. Readback preserved the user's station x-position adjustment of +1.171875 while verifying the current element set. The matching public checkpoint was downloaded and verified against the source: all 1,695 elements and 42 assets match.

The earlier 1,760-element draft was not applied to the canonical Plus board. Its public upload completed but was not approved or readback-verified; it is not a current link. The earlier 1,616-element public checkpoint remains in the history above.

All 24 canonical SVG exports match the grouped render. Nineteen legacy filenames are byte-identical aliases for compatibility; they are not additional diagrams.
