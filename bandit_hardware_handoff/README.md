# BandIt hardware handoff (Cal Hacks 13.0, Oct 23 to 25, 2026)

Start with `00_HANDOFF_PROMPT.md`: paste it into Claude, attach this folder, and it has the whole design.

```
00_HANDOFF_PROMPT.md        the handoff itself: project, fleet, parts, case, wiring, assembly, firmware, test plan
renders/
  bandit_wiring.png         full schematic of one band (lite + full-band extras)
  bandit_v2_assembly.png    exploded view in assembly order + plan of the base with every part placed
  bandit_v2_section.png     cross section with the stack heights
  bandit_v2_preview.png     3D render of base and lid
  bandit_v2_parts_as_printed.png   print orientation
  bandit_v2_beds.png        the two packed print beds that were run (15 bases + buttons, 15 lids)
cad/
  bandit_v2.py              parametric source (pure numpy, run it to regenerate the STLs; needs bandit_case.py)
  bandit_v2.scad            same geometry in OpenSCAD
  bandit_v2.fs              same geometry as an Onshape FeatureScript custom feature
  bandit_v2_base.stl        case body, prints upright, 64 x 42 x 13.6 mm
  bandit_v2_lid.stl / bandit_v2_lid_facedown.stl   lid as modelled / flipped for printing
  bandit_v2_button_facedown.stl   optional button cap for the switch plunger
  bandit_v2_bed_black.stl / bandit_v2_bed_clear.stl   the packed beds
  validate_v2.py / validation_v2.json   component envelopes, clearances, fit checks (all PASS)
  README_v2_pill.md         case design sheet and assembly order
  PRINT_SETTINGS.txt        slicer settings used at RIT (PLA, 0.2 mm, 3 perimeters, 15%, no supports)
firmware/
  bandit_common.h           packet format, thresholds, state and command enums (copied into each sketch folder)
  bandit_band/              band sketch (XIAO ESP32C3): beacons, neighbour counting, button, SOS, light circle, MPU fall, motor
  bandit_gateway/           USB serial bridge (XIAO ESP32C3): JSON out, text commands in
  bandit_station/           exit marker (ESP32-C3 SuperMini + spare ring)
  tools/gateway_monitor.py  live fleet table + command prompt + jsonl logging (pip install pyserial)
docs/
  02_PARTS_INVENTORY.csv    every part, where it is, per-unit allocation, with a column to write the real count
  06_GATEWAY_PROTOCOL.md    serial protocol for the dashboard / backend teammate
```

Firmware is a skeleton written for arduino-esp32 core 3.x and has not been compiled; expect small fixes.
