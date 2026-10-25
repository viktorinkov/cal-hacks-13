# Diagram versions

The generator and committed boards are versioned in Git. `generator/share.py` also saves the exact editable scene, embedded image assets, content hash and successful public URL under `.builds/diagram-history/` for each publication. These are saved checkpoints, not a record of every browser edit.

| Version | Board |
|---|---|
| Original supplied hardware source, preserved unchanged | [Imported source](hardware-source.excalidraw) · [original public board](https://excalidraw.com/#json=SV8r2zpCNd0WMnaBi5Y17,BXzlynJTGvIPFxko8A9lag) |
| 22-frame board before compact rewrites | [Saved public board](https://excalidraw.com/#json=2e-lY4kti3drtPmT-cTcW,0q-h0XTqPpwc2bE7Tzj7Gg) |
| 23-frame compact board before colored fills, 25 October 2026 | [Saved public board](https://excalidraw.com/#json=AbC-cJG5rpz1Io_GrVUkp,57gFegA3_CN4Qa_hbYAH1w) |
| 23-frame board with colored fills and organizer import, 25 October 2026 | [Saved public board](https://excalidraw.com/#json=2UPhABYeEuaa5ysmPjgfy,P5I77Yu-EF6HqJmtdU43pA) |
| 23-frame board with final Maincloud colors and portal routes, 25 October 2026 | [Saved public board](https://excalidraw.com/#json=RVs5MKFQ6Nqkq3atzgMFl,5aolZTUddATQge1NYA23Zw) |
| Current 21-frame Plus revision, 25 October 2026 | [Main shared board](https://app.excalidraw.com/s/8CxNdcrvsHz/65Xc8JRcGo5) |
| Saved 21-frame generator snapshot | [Verified editable checkpoint](https://excalidraw.com/#json=PIWdtEXRGfKzdy5HzX407,XSCCTxDLfUE4u1RGSecLqQ) |
| Earlier 24-frame interim public checkpoint | [Saved verified snapshot](https://excalidraw.com/#json=lJxOTI-7mfSQ0o_OeBBvK,c6_iNnKwAAqgaNlp8EpksQ) |
| Prior grouped 24-frame public checkpoint | [Verified snapshot](https://excalidraw.com/#json=p0Gilq4ytTdJY3VKU_r-r,Xq8vDszi13_7kLdKju8n0Q) |
| Reviewed claims revision, frames 12–14 | [Plus checkpoint](https://app.excalidraw.com/s/8CxNdcrvsHz/9cDPmI8128P) · [public checkpoint](https://excalidraw.com/#json=oxCugkrFGmofQRp-7b2Ck,8CYJ3avKkixRF4pbqo40VA) |
| Initial Live views excerpt, before colored fills | [Saved audience diagram](https://excalidraw.com/#json=43sXyVMbAkvjKOrABjlmj,iyo8fFEMLpWkGM_vjV8HWQ) · [full view inventory](views.md) |

The 21-frame reduction is online and verified on the main Plus board. It separates dedicated API integration diagrams from feature journeys. One architecture frame includes hosting; feature frames refer to the Evidence Engine and wallet without repeating their internals. Separate frames explain settlement amounts, reusable rules, typed friend search, live camera evidence and venue reconstruction. Interest suggestions, Buy a memory and Exit guidance now use existing Devpost prose; their feature facts remain in force. All hardware details remain on the main board.

The style guide keeps each main actor/component visible, with small filled property rectangles nested inside its card. Actual workflow and calculation stages can stand alone with arrows; related formula inputs and conditions stay within their calculation group. Original logos, illustrations and floor drawings remain editable assets; there are no app screenshots. Excerpts use the same generator and canonical numbers as the board.

Before the restructure, the exact editable 23-frame source, its generators and hashes were saved under `.builds/diagram-history/20261025T101317Z-before-sponsor-feature-restructure/`. The original hardware source remains byte-for-byte unchanged. The separate claims Plus scene is a reviewed checkpoint; the main shared Plus URL is the working board. Plus native version history is not available, so recovery relies on these explicit checkpoints and Git. They do not capture every browser edit.

The current reduced Plus revision is based on `.builds/diagram-style/restructure-21.excalidraw`: 1,550 active elements, 21 frames, 208 image instances and 40 referenced assets, SHA-256 `a11eaca309beb9f0a6a794a1df8aa633728c2a34d86539c4ea74e4bd834a448f`. Readback verified the full active element set with zero orphans, retired all prior 1,695 active elements, and preserved the user's station x-position adjustment of +1.171875. The matching generated public snapshot was downloaded and verified: all 1,550 elements and 40 assets match the frozen source. The canonical Plus link above remains the shared working board.

The grouped 24-frame revision is preserved in commit `daf0d74`, the verified public checkpoint above, and `.builds/diagram-history/20261025T105423Z-before-21-frame-reduction/`. The earlier 1,760-element draft was never applied to the canonical Plus board; its public upload was not approved or readback-verified. The 1,616-element public checkpoint remains historical too.

All 21 current canonical SVG exports match the reduced render. Sixteen legacy filenames are byte-identical aliases for compatibility. Six retired SVGs remain unchanged as historical compatibility files: `interest-suggestions.svg`, `interests.svg`, `buy-a-memory.svg`, `merch.svg`, `exit-guidance.svg` and `exits.svg`. Neither aliases nor historical files are additional active diagrams.

The rule drawing removes historical repair detail and a repeated individual-decision lane; code approval guards are unchanged and the audit retains the repair record. Photos and Memories keeps encounters, visits and their minutes inside the relevant parent cards. Station exit colors are represented by checked swatches.
