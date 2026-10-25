# Diagram versions

The generator and committed boards are versioned in Git. `generator/share.py` also saves the exact editable scene, embedded image assets, content hash and successful public URL under `.builds/diagram-history/` for each publication. These are saved checkpoints, not a record of every browser edit.

| Version | Board |
|---|---|
| Original supplied hardware source, preserved unchanged | [Imported source](hardware-source.excalidraw) · [original public board](https://excalidraw.com/#json=SV8r2zpCNd0WMnaBi5Y17,BXzlynJTGvIPFxko8A9lag) |
| 22-frame board before compact rewrites | [Saved public board](https://excalidraw.com/#json=2e-lY4kti3drtPmT-cTcW,0q-h0XTqPpwc2bE7Tzj7Gg) |
| 23-frame compact board before colored fills, 25 October 2026 | [Saved public board](https://excalidraw.com/#json=AbC-cJG5rpz1Io_GrVUkp,57gFegA3_CN4Qa_hbYAH1w) |
| 23-frame board with colored fills and organizer import, 25 October 2026 | [Saved public board](https://excalidraw.com/#json=2UPhABYeEuaa5ysmPjgfy,P5I77Yu-EF6HqJmtdU43pA) |
| 23-frame board with final Maincloud colors and portal routes, 25 October 2026 | [Current public board](https://excalidraw.com/#json=RVs5MKFQ6Nqkq3atzgMFl,5aolZTUddATQge1NYA23Zw) |
| Initial Live views excerpt, before colored fills | [Saved audience diagram](https://excalidraw.com/#json=43sXyVMbAkvjKOrABjlmj,iyo8fFEMLpWkGM_vjV8HWQ) · [full view inventory](views.md) |

The compact version keeps each frame focused, separates queue coordination from model execution, makes Elastic ownership explicit, preserves the approval learning loop, and includes the three hardware additions plus Live views. All frames use the [same guide](../handoff/research/devpost/TERMS.md#diagrams).

The current board uses soft colored fills with dark text and large original artwork. Its final review corrected Maincloud colors and distinguished the production organizer controls from the full plain attendee recap on the development host. Architecture and Event data show the approved organizer-triggered server import separately from venue setup; that import is being implemented and is not yet verified as deployed. Its published scene contains 1,603 elements and 47 image assets, all checked against the saved source.
