# BandIt gateway serial protocol (for the dashboard / backend teammate)

The gateway is a XIAO ESP32C3 on a USB cable. It is a transparent bridge between the ESP-NOW radio and the laptop. Open the port at **115200 baud**, read lines, write lines. Nothing is buffered on the gateway: if the laptop is not reading, packets are dropped, not queued.

## Radio to laptop: one JSON object per line

Every packet the gateway hears, about 10 per second per band and 5 per station:

```json
{"t":12345,"type":1,"id":3,"rssi":-61,"flags":1,"neigh":4,"zone":101,"bat":87,"state":2,"seq":882}
```

| Field | Meaning |
|---|---|
| `t` | gateway uptime in ms (use the laptop clock for real time) |
| `type` | 1 band beacon, 2 station beacon, 3 command echo from another gateway |
| `id` | band 1..9, station 101..105, gateway 200 |
| `rssi` | signal strength at the gateway in dBm (that is distance to the gateway, not density) |
| `flags` | bit 0 SOS (1), bit 1 fall (2), bit 2 button press in the last second (4), bit 3 low battery (8), bit 4 full band (16) |
| `neigh` | the band's own smoothed neighbour count: the density number |
| `zone` | id of the station the band hears loudest, 0 if none |
| `bat` | battery percent, 255 if the band has no divider fitted (most of them) |
| `state` | 0 idle green, 1 yellow, 2 guide (red + exit colour), 3 SOS, 4 near SOS (light circle), 5 pay prompt, 6 paid, 7 connect, 8 identify, 9 off |
| `seq` | per sender packet counter, for loss estimates |

Station beacons carry their colour index in `state` and zeros elsewhere.

Other lines you will see: `{"gateway":"up","mac":"...","channel":1}` on boot, `{"ack":"cmd",...}` after each command, `{"err":"..."}` on a bad command.

A band is "alive" if you heard it in the last 2 s. If `neigh` from a band is stale for 5 s, show it grey.

## Laptop to radio: text commands

One command per line, terminated with `\n`. The gateway broadcasts each one three times, 40 ms apart.

```
cmd <target> <name> [arg] [arg2]
```

`target` is a band id 1..9 (stations 101..105 for `exit` and `state`), or `0` for everyone.

| Command | Effect on the band |
|---|---|
| `cmd 3 pay` | ring spins yellow for 8 s and the band buzzes; when the wearer presses, the band's beacons carry flag 4 (press) for one second. Treat a press flag from that band while the prompt is open as "approved", create the Nessie purchase, then send `paid`. |
| `cmd 3 paid` | green flash for 1.5 s and a short buzz |
| `cmd 0 exit 2` | sets the exit colour every band shows in GUIDE state (1 blue, 2 magenta, 3 cyan, 4 white, 5 orange, 6 violet). Send per zone if you want different exits per zone, by sending to the band ids in that zone. |
| `cmd 102 exit 2` | sets station 102's colour |
| `cmd 0 state 2` | force a state on everyone (manual override for the demo). `cmd 0 state 2 50` holds it for 5 s (arg2 is tenths of a second). `cmd 0 state 9` turns rings off. Stations: `state 0` breathe, `1` chase, `9` off. |
| `cmd 0 clear` | releases SOS / fall latches and any forced state; back to density-driven behaviour |
| `cmd 4 buzz 2` | buzz pattern 1 short, 2 double, 3 long (full bands only) |
| `cmd 0 thresh 3 5` | live calibration: yellow at 3 neighbours, red at 5 |
| `cmd 0 rssi 62 58` | live calibration: neighbour RSSI threshold -62 dBm, light circle threshold -58 dBm (pass positive numbers) |
| `cmd 0 override 1` | stop the density state machine (bands stay green unless forced); `override 0` restores it |

Calibration values pushed this way are lost on a band reset; bake the final ones into `firmware/bandit_common.h`.

## Suggested dashboard logic

- Density per zone = mean `neigh` of the live bands whose `zone` is that station; colour it with the same 3 / 5 thresholds (or map to people per square metre using the calibration table you record on Saturday).
- SOS: any band with flag 1 or 2. Show its zone, its id, and the ids of the bands currently reporting state 4 (they are the light circle, so they are physically around the person).
- Payment flow: POST from the merchant page starts a pending payment for band N, send `cmd N pay`, wait up to 8 s for a beacon from N with flag 4, create the purchase in Nessie, send `cmd N paid`, mark the merchant page paid. On timeout, send nothing (the band times out on its own) and show "declined".
- Manual override button in the UI maps to `cmd 0 state 2` / `cmd 0 clear`. If you use it in front of judges, say so.

`firmware/tools/gateway_monitor.py` shows all of this live in a terminal and logs every line to a `.jsonl` file.
