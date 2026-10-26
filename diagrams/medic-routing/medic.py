"""Build the medic excerpt from the canonical board generator.

The excerpt contains Respond to an incident and Routes and clear space.
The floor route drawing remains a standalone algorithm illustration.

Refresh their source data from this directory when floor geometry changes:
    for t in "Table 51" "Table 121" "Table 201"; do node path.mts "$t"; done > paths.jsonl
    python3 render.py paths.jsonl floor-paths.png -92 -12 -50 2 18
    python3 medic.py medic-routing.excalidraw

path.mts calls web/src/floor-path.ts, the same route calculation as the Live tab.
"""
import pathlib
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
GEN = HERE.parent / "generator" / "gen.py"
output = sys.argv[1] if len(sys.argv) > 1 else str(HERE / "medic-routing.excalidraw")
subprocess.run([sys.executable, str(GEN), output, "medic"], check=True)
