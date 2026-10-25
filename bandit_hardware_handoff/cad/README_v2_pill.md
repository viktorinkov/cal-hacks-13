# BandIt v2 "pill": print and assembly sheet

64 x 42 mm, 13.6 mm tall on the wrist (v1 was 45 x 43 x 19.3). Two printed parts, no supports.

| Part | File | Size (mm) | PLA | Prints |
|---|---|---|---|---|
| Base | `bandit_v2_base.stl` | 64 x 42 x 13.6 | 12 g | upright as modeled (two rails on the bed) |
| Lid | `bandit_v2_lid_facedown.stl` | 62 x 40 x 1.2 | 3.5 g | already flipped, prints face down |

Settings as v1: PLA, 0.2 mm, 3 perimeters, 15% infill, supports off, brim off (Prusa Core One profile at the SHED). Lid in **translucent PETG** if available (MK4 profile): in v2 the lid covers the whole LED ring, so it has to glow through. White PLA at 1.2 mm also works. About $0.50 a set.

## How it is laid out (see `bandit_v2_section.png`)

- **Head (right, around the ring):** battery on the floor, LED ring 1 mm above it resting on two crescents of body at the sides, the 6x6 SOS switch standing on the battery in the exact centre of the ring, its plunger reached through a 6.5 mm hole in the lid (the plunger top sits 0.8 mm below the lid surface; a 6x6x6 switch instead of 6x6x5 brings it 0.2 mm proud if you want it flush). "Hold the light for three seconds" is the SOS gesture.
- **Tail (left):** MPU and coin motor side by side on the floor, the XIAO on top of them port-down, its USB-C flush with the inside of the end wall. The end wall has a 10.6 x 4.2 window inside a 0.7 mm recess so a normal cable plug reaches. Two posts between head and tail stop the battery sliding; the XIAO's end sits in the gap between them.
- **Strap:** threads under the floor, NATO style, through a 17.5 x 1.3 channel that runs the full length. The puck slides on and off the ribbon.
- The FPC antenna sticks to the inside of the tail's long wall, 20 mm from the battery.

## Validation (all in `validation_v2.json`)

16 component envelopes clear the case with zero hits; no two components overlap; every part drops straight in from the top (battery, MPU, motor, switch, ring, XIAO); the only bridges are the 17.5 mm channel roof and the 10.6 mm window top; the STL agrees with the independent analytic model on 99.8% of 1,989 random points (the misses are inside overlapping shells, where the ray test miscounts). Tightest clearances: ring in pocket 0.4 radial, XIAO between the divider posts 0.3 per side, MPU to its post 0.2, XIAO can above the MPU 0.3 (that is the foam pad).

## Assembly order

1. Solder everything on the bench first: battery leads to the XIAO BAT pads (cut the JST plug), ring wires (BAT+, GND, data via 330 ohm), MPU (4 wires), motor driver, switch (2 wires). Keep the switch wires 60 mm long.
2. MPU into the tail, flat on the floor, long edge across the wrist, toward the far side wall. Foam tape.
3. Motor beside it (sticky pad down), near the far corner.
4. Antenna FPC on the inside of the tail's long wall, cable to the XIAO's U.FL.
5. Battery into the head pocket, leads through the gap between the posts into the tail.
6. XIAO into the tail, port down, straight down onto the MPU and motor with a square of foam tape between. Push it toward the end wall so the USB-C sits in the window. Its other end lands between the two posts.
7. Switch onto the centre of the battery (foam tape), wires routed under where the ring will sit.
8. Ring: drop it into the round pocket with its solder pads toward the tail side. It should sit flat with a little side play.
9. Lid: set it into the rebate with the hole centred over the switch plunger. Hot glue dots at both ends.

Power check before gluing the lid: USB in at the tail end, charge LED on; hold the centre button 3 s, ring lights.

## Before printing nine

Print one, then measure: ring drops in with slight play (pocket is 38.3 for a 37.5 ring); battery drops in (37 x 32 for 35 x 30); the XIAO's end passes between the posts (18.4 gap for a 17.8 board). Each is one number in `bandit_v2.py` or `bandit_v2.scad`. The two assumptions I could not measure from here: the XIAO's underside parts clear the MPU by the 0.3 mm pad (use 0.5 mm foam if anything touches), and your USB cable's plug nose fits the 14 x 5.6 recess (most do; a slim cable is safest).
