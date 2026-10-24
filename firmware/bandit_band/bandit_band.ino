/*
  BandIt band firmware. One binary for every band; identity and tuning live in NVS.
  Board: Seeed XIAO ESP32C3 (fqbn esp32:esp32:XIAO_ESP32C3), core esp32 3.x, library Adafruit NeoPixel.
  Code: band.cpp (logic), band_config (NVS), band_ring (LEDs), band_haptics (motor), band_mpu (fall detection).

  Build and flash:   ./build.sh band /dev/cu.usbmodemXXXX 3      (uploads, then sets id 3 and saves it)
  Every band:        ./build.sh all-bands                         (same binary, ids are kept in NVS)

  First boot (empty NVS): id 0, the ring blinks white and the band does not transmit until it has an id.

  Serial at 115200, one command per line. Config changes apply at once; "save" writes them to NVS.
    id <1..99>                  motor <0|1>                  thresh <yellow> <red>      rssi <neighAbs> <circleAbs>
    fall <impactG> <tolG> <stillMs> <windowMs>   e.g. fall 2.8 0.2 1500 3500
    duty <10..100>  motor PWM %  lowvis <0|1>                vbat <0|1>  (battery divider fitted on A0)
    info   save   reset (reboot)   defaults (everything except id and motor; then save)
  Bench: sos  clear  pay  paid  press  buzz  haptic <0..7>  state <0..11>  auto  exit <1..6>  find <id> [colour]
         ident  sleep [minutes]
  Output: one JSON line per answer ({"info":"band",...}, {"ok":...}, {"err":...}), a {"boot":"band",...} line,
  {"event":...} lines (cmd, ping, sought, found_me, find_start, find_end, fall), and
  a {"status":"band",...} line every second with the neighbour list ("heard": [[id, rssi], ...]) and peak g.

  Thresholds pushed by the gateway ("cmd 0 thresh", "cmd 0 rssi", "cmd 0 lowvis") are saved to NVS on receipt.

  Button (D2 to GND): short press = F_PRESS for 1 s + short buzz (approve during pay, ping during find).
    hold 3 s = SOS on / off (during find on the seeker: ends find). hold 10 s = ring goes dark, release = deep sleep.
    A sleeping band wakes on a press. A band in deep sleep still draws ~12 mA through the dark WS2812Bs.

  Haptics need "motor 1". Patterns: 1 short, 2 double, 3 long, 4 SOS, 5 raise your hand, 6 guide pulse.
  The MPU-6050 is detected at boot (I2C 0x68 on D4/D5); "hasMpu" in info shows it.
*/
