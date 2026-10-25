// BandIt shared radio definitions. Copy this file next to each .ino (Arduino builds every file in the sketch folder).
// One ESP-NOW broadcast packet type for everything: band beacons, station beacons and gateway commands.
#pragma once
#include <stdint.h>

#define BANDIT_MAGIC    0xB1
#define BANDIT_CHANNEL  1          // every node sits on Wi-Fi channel 1, nobody joins a network
#define BAND_BEACON_MS  100        // bands beacon at 10 Hz (plus 0..30 ms jitter)
#define STATION_BEACON_MS 200      // stations at 5 Hz
#define NEIGH_WINDOW_MS 2000       // a band counts as a neighbour if heard in the last 2 s ...
#define NEIGH_RSSI_MIN  (-62)      // ... stronger than this (dBm). CALIBRATE AT THE VENUE.
#define CIRCLE_RSSI_MIN (-58)      // how close an SOS band must be before I join its light circle. CALIBRATE.
#define ZONE_WINDOW_MS  3000       // station beacons older than this are ignored for zone selection

enum PktType : uint8_t { T_BAND = 1, T_STATION = 2, T_CMD = 3 };

// flags (band beacons)
enum : uint8_t { F_SOS = 1 << 0, F_FALL = 1 << 1, F_PRESS = 1 << 2, F_LOWBAT = 1 << 3, F_FULLBAND = 1 << 4 };

// light / behaviour states (band). The gateway can force any of these with CMD_STATE.
enum BandState : uint8_t {
  S_IDLE = 0,      // dim green breathing: density fine
  S_YELLOW = 1,    // amber: getting dense
  S_GUIDE = 2,     // red background, chase in the exit colour: move out, follow the colour
  S_SOS = 3,       // red strobe + buzz: I called for help (or I fell)
  S_NEAR_SOS = 4,  // blue pulse: someone next to me needs help (light circle)
  S_PAY = 5,       // yellow spinner: press to approve the payment
  S_PAID = 6,      // green flash, then back to idle
  S_CONNECT = 7,   // pink sparkle: Bandshake accepted
  S_IDENT = 8,     // white blink: find this band on the bench
  S_OFF = 9        // ring off (charging / bench)
};

// gateway -> bands commands (type T_CMD). target 0 = every band.
enum Cmd : uint8_t {
  CMD_STATE = 1,   // arg = BandState, held for arg2*100 ms (0 = until further notice)
  CMD_EXIT = 2,    // arg = exit colour index 1..6 (see colours in bandit_band.ino)
  CMD_CLEAR = 3,   // clear SOS / fall latch and return to density-driven states
  CMD_BUZZ = 4,    // arg = pattern 1..3
  CMD_PAY = 5,     // start a payment prompt (band answers with F_PRESS when the wearer presses)
  CMD_PAID = 6,    // payment confirmed
  CMD_THRESH = 7,  // arg = yellow neighbour count, arg2 = red neighbour count (live tuning from the laptop)
  CMD_RSSI = 8,    // arg = -(neighbour RSSI threshold), arg2 = -(circle RSSI threshold)
  CMD_OVERRIDE = 9 // arg = 1 force density state machine off (manual mode), 0 back to auto
};

struct __attribute__((packed)) Pkt {
  uint8_t  magic;   // BANDIT_MAGIC
  uint8_t  type;    // PktType
  uint8_t  id;      // bands 1..9, stations 101..105, gateway 200
  uint8_t  flags;   // F_*
  uint8_t  neigh;   // smoothed neighbour count (bands)
  uint8_t  zone;    // id of the strongest station heard, 0 = none
  uint8_t  bat;     // battery percent, 255 = unknown
  uint8_t  state;   // BandState
  uint16_t seq;
  // command fields, only meaningful when type == T_CMD
  uint8_t  target;  // band id or 0 = all
  uint8_t  cmd;     // Cmd
  uint8_t  arg;
  uint8_t  arg2;
};

static const uint8_t BCAST_ADDR[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
