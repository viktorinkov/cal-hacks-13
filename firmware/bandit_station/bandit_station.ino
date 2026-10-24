/*
  BandIt station marker: ESP32-C3 SuperMini plus a 12-LED ring, USB powered. The code is in station.cpp.
  Build and flash:  ./build.sh station /dev/cu.usbmodemXXXX 101      (fqbn esp32:esp32:esp32c3:CDCOnBoot=cdc)

  Beacons its id at 5 Hz at full power so bands know their zone (strongest station wins) and glows its exit
  colour. Default colour index = id - 100: 101 blue, 102 magenta, 103 cyan, 104 white, 105 orange.
  Obeys commands addressed to its own id or to 100 (every station), never "cmd 0 ...":
    cmd 102 exit 2      cmd 100 state 2 (strobe)      cmd 101 state 0|1|2|9 (breathe, chase, strobe, off)
    cmd 100 clear (back to breathe)

  Wiring: ring DIN on GPIO10 through 330 R; ring VCC from 5V through a 1N4001 (or from 3V3 with "bright 80" or
  less); GND. GPIO8 (onboard LED) and GPIO9 (BOOT) are strapping pins and are left alone.

  Serial at 115200, one command per line:
    id <101..105>   exit <1..6>   mode <0|1|2|9>   bright <10..255>   info   save   reset (reboot)
  A fresh board has id 0: the ring blinks white and it does not beacon until "id <n>" and "save".
*/
