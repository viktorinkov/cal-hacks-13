/*
  BandIt radio protocol, shared by the band, gateway and station firmware.
  This folder is a local Arduino library: build.sh passes it with --library, so there is one copy of this file.

  PROTOCOL v2, FROZEN Fri Oct 23 2026. After the freeze only additive changes, and only after telling the
  dashboard owner. Every change here means reflashing nine bands.

  Transport
    ESP-NOW broadcast to FF:FF:FF:FF:FF:FF on Wi-Fi channel 1. Nobody joins a network. Wi-Fi power save off.
    Bands transmit at 8 dBm (esp_wifi_set_max_tx_power(32)); stations and the gateway at maximum.
    Bands beacon at 10 Hz plus 0..30 ms jitter and send a heard list at 1 Hz. Stations beacon at 5 Hz.
    The gateway sends each command 3 times, 40 ms apart, with the same seq. Receivers act on a (sender, seq) once.
    RSSI is taken from esp_now_recv_info_t->rx_ctrl->rssi. Never convert it to metres: bodies absorb 2.4 GHz.

  Ids
    bands 1..10 (10 = dev rig), 0 = unassigned (a band with id 0 blinks white and does not transmit)
    stations 101..105, gateway 200
    command target: 0 = every band, 1..99 = that band, 100 = every station, 101..105 = that station

  Pkt: 14 bytes, packed, little endian. Used by types 1, 2 and 3.
    magic 0xB1 | type | id | flags | neigh | zone | bat | state | seq (u16) | target | cmd | arg | arg2

    type 1  band beacon
      flags   bit0 SOS (1), bit1 fall (2), bit2 button pressed in the last 1 s (4), bit3 low battery (8),
              bit4 has an MPU / fall detection (16), bit5 has a motor (32)
      neigh   smoothed neighbour count: the density number
      zone    id of the strongest station heard in the last 3 s, 0 = none
      bat     battery percent, 255 = no divider fitted
      state   BandState below
      seq     per sender counter
      target  the band this band is looking for (find your friend), 0 = nobody
      arg     pair colour index while looking for a friend (PAIR_COLOURS, 0 = pink)
      cmd, arg2  0
    type 2  station beacon: state = exit colour index 1..6, seq counts, everything else 0
    type 3  command from the gateway (id 200): target, cmd, arg, arg2 as in Cmd below

  HeardPkt: type 4, 4 + 2n bytes, n <= 16, 1 Hz from every band
    magic 0xB1 | 4 | id | n | n x (id, rssi as int8 dBm)
    every band and station the sender heard in the last 2 s, with the smoothed RSSI it uses for its own
    decisions, strongest first. Calibration and the dashboard's light-circle view use it.

  BandState
    0 idle (green breathing)   1 yellow (amber)   2 guide (red + chase in the exit colour)   3 SOS (red strobe)
    4 near SOS (blue pulse, light circle)   5 pay prompt (yellow spinner)   6 paid (green)   7 connect (pink sparkle)
    8 identify (white blink)   9 off   10 find (fill meter toward my friend)   11 found me (my seeker is close: strobe)
    Ring priority, highest first: identify, SOS/fall, paid, pay, found me, find, connect, near SOS,
    state forced by the gateway, density state.

  StationMode (station CMD_STATE): 0 breathe (open exit), 1 chase (come this way), 2 strobe (emergency, low
    visibility), 9 off. Stations only obey targets 100 and their own id, so "cmd 0 ..." never changes a station.

  Cmd (type 3)
    1  STATE    arg = BandState, arg2 = hold time in 0.1 s (0 = until clear). States 7 (connect) and 8 (identify)
                are timed overlays instead: arg2 0 means 2 s and 3 s. Stations: arg = StationMode.
    2  EXIT     arg = exit colour 1..6: 1 blue, 2 magenta, 3 cyan, 4 white, 5 orange, 6 violet. Stations save it.
    3  CLEAR    clear SOS and fall latches, the forced state and the light circle. Stations go back to breathe.
    4  BUZZ     arg = haptic pattern 1..3 (same numbers as HAPTIC)
    5  PAY      pay prompt for 8 s. The wearer approves with a short press (flag bit2 for 1 s).
    6  PAID     payment confirmed: green for 1.5 s
    7  THRESH   arg = yellow neighbour count, arg2 = red neighbour count. The band saves them.
    8  RSSI     arg = -(neighbour RSSI threshold dBm), arg2 = -(light circle threshold dBm). The band saves them.
    9  OVERRIDE arg 1 = density state machine off (bands stay idle unless forced), 0 = back to auto
    10 FIND     target = the seeker band, arg = the friend's id (0 = stop), arg2 = pair colour index (0 = pink)
    11 SLEEP    deep sleep, wake on a button press. arg = minutes until an extra timed wake (0 = button only)
    12 HAPTIC   arg = Haptic pattern below
    13 LOWVIS   arg 1 = low visibility guidance on (haptic pulse in guide, chase speed follows the exit station's
                RSSI), 0 = off. The band saves it.

  Haptic patterns: 0 stop, 1 short (confirm), 2 double (pay prompt), 3 long, 4 SOS (three short, three long),
    5 raise your hand (three medium), 6 guide pulse. Bands without a motor ignore them.
*/
#pragma once
#include <Arduino.h>

// Firmware version. build.sh writes bandit_version.h (build date + git hash); a plain IDE build uses the date.
#if __has_include("bandit_version.h")
#include "bandit_version.h"
#endif
#ifndef BANDIT_FW
#define BANDIT_FW __DATE__ " " __TIME__
#endif

constexpr uint8_t  BANDIT_MAGIC      = 0xB1;
constexpr uint8_t  BANDIT_CHANNEL    = 1;
constexpr uint32_t BAND_BEACON_MS    = 100;
constexpr uint32_t BAND_JITTER_MS    = 30;
constexpr uint32_t HEARD_MS          = 1000;
constexpr uint32_t STATION_BEACON_MS = 200;
constexpr uint32_t NEIGH_WINDOW_MS   = 2000;   // a band counts as a neighbour if heard in the last 2 s ...
constexpr int8_t   NEIGH_RSSI_MIN    = -62;    // ... at or above this smoothed RSSI. Calibrated at the venue.
constexpr int8_t   CIRCLE_RSSI_MIN   = -58;    // light circle threshold. Calibrated at the venue.
constexpr uint32_t ZONE_WINDOW_MS    = 3000;
constexpr uint8_t  CMD_REPEATS       = 3;
constexpr uint32_t CMD_REPEAT_MS     = 40;
constexpr uint8_t  BAND_TX_POWER     = 32;     // 0.25 dBm units: 8 dBm
constexpr uint8_t  MAX_TX_POWER      = 84;     // clamped by the chip to its maximum

constexpr uint8_t ID_NONE         = 0;
constexpr uint8_t ID_ALL_BANDS    = 0;
constexpr uint8_t ID_BAND_MAX     = 99;
constexpr uint8_t ID_ALL_STATIONS = 100;
constexpr uint8_t ID_STATION_MIN  = 101;
constexpr uint8_t ID_STATION_MAX  = 105;
constexpr uint8_t ID_GATEWAY      = 200;

enum PktType : uint8_t { T_BAND = 1, T_STATION = 2, T_CMD = 3, T_HEARD = 4 };

enum : uint8_t {
  F_SOS = 1 << 0, F_FALL = 1 << 1, F_PRESS = 1 << 2, F_LOWBAT = 1 << 3, F_MPU = 1 << 4, F_MOTOR = 1 << 5
};

enum BandState : uint8_t {
  S_IDLE = 0, S_YELLOW = 1, S_GUIDE = 2, S_SOS = 3, S_NEAR_SOS = 4, S_PAY = 5, S_PAID = 6,
  S_CONNECT = 7, S_IDENT = 8, S_OFF = 9, S_FIND = 10, S_FOUND_ME = 11, S_COUNT = 12
};

enum StationMode : uint8_t { M_BREATHE = 0, M_CHASE = 1, M_STROBE = 2, M_OFF = 9 };

enum Cmd : uint8_t {
  CMD_STATE = 1, CMD_EXIT = 2, CMD_CLEAR = 3, CMD_BUZZ = 4, CMD_PAY = 5, CMD_PAID = 6, CMD_THRESH = 7,
  CMD_RSSI = 8, CMD_OVERRIDE = 9, CMD_FIND = 10, CMD_SLEEP = 11, CMD_HAPTIC = 12, CMD_LOWVIS = 13
};

enum Haptic : uint8_t {
  H_STOP = 0, H_SHORT = 1, H_DOUBLE = 2, H_LONG = 3, H_SOS = 4, H_RAISE = 5, H_GUIDE = 6, H_PUBLIC_MAX = 6
};

struct __attribute__((packed)) Pkt {
  uint8_t  magic;
  uint8_t  type;
  uint8_t  id;
  uint8_t  flags;
  uint8_t  neigh;
  uint8_t  zone;
  uint8_t  bat;
  uint8_t  state;
  uint16_t seq;
  uint8_t  target;
  uint8_t  cmd;
  uint8_t  arg;
  uint8_t  arg2;
};
static_assert(sizeof(Pkt) == 14, "Pkt must stay 14 bytes");

constexpr uint8_t HEARD_MAX = 16;
struct __attribute__((packed)) HeardEntry { uint8_t id; int8_t rssi; };
struct __attribute__((packed)) HeardPkt {
  uint8_t    magic;
  uint8_t    type;
  uint8_t    id;
  uint8_t    n;
  HeardEntry e[HEARD_MAX];
};
inline size_t heardLen(uint8_t n) { return 4 + 2 * (size_t)n; }

// ------------------------------------------------------------------ colours (0xRRGGBB)
constexpr uint8_t N_EXIT = 6;
constexpr uint8_t N_PAIR = 6;
extern const uint32_t EXIT_COLOURS[N_EXIT + 1];   // index 1..6
extern const uint32_t PAIR_COLOURS[N_PAIR];       // index 0..5, 0 = pink
uint32_t dimColour(uint32_t c, uint8_t b);         // scale by b / 255

// ------------------------------------------------------------------ radio
// The receive callback runs in the Wi-Fi task and only copies frames into a FreeRTOS queue; loop() drains it.
struct RxFrame {
  uint32_t t;       // millis() at reception
  int8_t   rssi;
  uint8_t  len;
  uint8_t  mac[6];
  uint8_t  data[sizeof(HeardPkt)];
};
bool     radioBegin(uint8_t txPower, uint16_t queueDepth);
bool     radioPoll(RxFrame& out);
bool     radioSend(const void* data, size_t len);
uint32_t radioDropped();
const uint8_t* selfMac();
void     macToStr(const uint8_t* mac, char out[18]);

// ------------------------------------------------------------------ serial
// USB CDC never blocks: TX timeout 0, and a line is written whole or not at all (no half JSON lines when the host
// is slow, absent, or attached without reading).
void serialBegin(size_t txBuf, size_t rxBuf);
bool emitLine(const char* s, size_t n);
bool emitf(const char* fmt, ...) __attribute__((format(printf, 1, 2)));

class LineBuf {
 public:
  void add(const char* fmt, ...) __attribute__((format(printf, 2, 3)));
  bool emit();            // appends '\n' and writes the whole line
  void clear() { n_ = 0; }
 private:
  char   b_[720];
  size_t n_ = 0;
};

// Non-blocking line reader: returns a completed line (no '\r' / '\n') or nullptr. Over-long lines are dropped.
class LineReader {
 public:
  char* poll(Stream& s);
 private:
  char   buf_[128];
  size_t n_ = 0;
  bool   skip_ = false;
};

int  splitWords(char* s, char** out, int max);
bool parseLong(const char* s, long& v);
bool parseFloat(const char* s, float& v);
