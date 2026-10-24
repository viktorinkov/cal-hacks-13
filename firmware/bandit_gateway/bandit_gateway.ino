/*
  BandIt gateway: a XIAO ESP32C3 with its antenna on a USB cable to the laptop. The code is in gateway.cpp.
  Build and flash:  ./build.sh gateway /dev/cu.usbmodemXXXX      (fqbn esp32:esp32:XIAO_ESP32C3)
  Live view:        python3 tools/gateway_monitor.py /dev/cu.usbmodemXXXX

  Serial at 115200, one JSON object per line, '\n' terminated. If the laptop stops reading, lines are dropped
  whole, never half written. The radio protocol itself is described at the top of bandit_common.h.

  Radio -> laptop
    band beacon (type 1, ~10 Hz per band):
      {"t":12345,"type":1,"id":3,"rssi":-61,"flags":1,"neigh":4,"zone":101,"bat":87,"state":2,"seq":882,"find":0}
    station beacon (type 2, 5 Hz per station; state = exit colour index):
      {"t":12345,"type":2,"id":101,"rssi":-48,"flags":0,"neigh":0,"zone":0,"bat":0,"state":1,"seq":77}
    command heard from another gateway (type 3): same fields as a station line
    heard list (type 4, 1 Hz per band; [id, smoothed rssi] the band itself measures, strongest first):
      {"t":12345,"type":4,"id":3,"rssi":-61,"heard":[[5,-48],[101,-60]]}
    t = gateway uptime in ms, rssi = signal at the gateway, find = the band this band is looking for (0 = nobody).
    flags: 1 SOS, 2 fall, 4 button pressed in the last second, 8 low battery, 16 has MPU, 32 has motor.
    state: 0 idle, 1 yellow, 2 guide, 3 SOS, 4 near SOS, 5 pay, 6 paid, 7 connect, 8 identify, 9 off,
           10 find, 11 found me.

  Other lines
    boot:            {"gateway":"up","mac":"AC:27:6E:FA:E4:C8","channel":1,"fw":"ede7124"}
    "info" typed in: {"info":"gateway","mac":"AC:27:6E:FA:E4:C8","channel":1,"fw":"ede7124"}
    fw = the git hash of the build, plus "+MMDD.HHMM" when it was built from uncommitted changes
    per command:     {"ack":"cmd","target":3,"cmd":5,"arg":0,"arg2":0}
    errors:          {"err":"usage: cmd <target> <name> [arg] [arg2]"}  {"err":"unknown cmd"}  {"err":"bad args"}
                     {"err":"busy"}  {"err":"rx queue full","dropped":12}  {"err":"send failed","target":3,"cmd":5}
                     {"err":"dup id","id":3,"mac":"AA:..","other":"BB:.."}  (two boards configured with one id)

  Laptop -> radio: one command per line, broadcast 3 times 40 ms apart
    cmd <target> <name> [arg] [arg2]
      target: 0 every band, 1..99 one band, 100 every station, 101..105 one station
      state <0..11> [tenths]   force a band state (0 = until clear). 7 connect / 8 identify are timed overlays.
                               stations: 0 breathe, 1 chase, 2 strobe, 9 off
      exit <1..6>              exit colour: 1 blue 2 magenta 3 cyan 4 white 5 orange 6 violet
      clear                    release SOS / fall / forced state (stations: back to breathe)
      buzz [1..3]              haptic 1 short, 2 double, 3 long
      haptic <0..6>            0 stop 1 short 2 double 3 long 4 SOS 5 raise your hand 6 guide pulse
      pay | paid               pay prompt (8 s, approve = flag 4 from that band) | confirmed (green 1.5 s)
      thresh <yellow> <red>    neighbour counts, saved on the bands
      rssi <neighAbs> <circleAbs>   e.g. "rssi 62 58" = -62 / -58 dBm, saved on the bands
      override <0|1>           1 = density state machine off (Plan B: drive states with "cmd 0 state")
      find <friend> [colour]   on the seeker band; friend 0 = stop; colour 0..5 (0 pink)
      sleep [minutes]          deep sleep, wake on button (plus a timed wake if minutes > 0)
      lowvis <0|1>             low visibility guidance, saved on the bands
    examples: cmd 0 exit 2   cmd 3 pay   cmd 3 paid   cmd 0 thresh 3 5   cmd 4 find 7   cmd 102 state 2
*/
