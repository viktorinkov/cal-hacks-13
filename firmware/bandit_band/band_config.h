// Band configuration stored in NVS (Preferences namespace "bandit"), so one binary flashes every band.
#pragma once
#include <Arduino.h>

struct BandConfig {
  uint8_t  id;            // 0 = unassigned: ring blinks white, no beacons
  bool     hasMotor;
  uint8_t  yellowAt;      // smoothed neighbour count for yellow; back to idle below yellowAt - 1
  uint8_t  redAt;         // count for guide (red); back to yellow below redAt - 1
  int8_t   neighRssi;     // dBm, smoothed RSSI at or above this makes a band a neighbour
  int8_t   circleRssi;    // dBm, an SOS band this strong puts me in its light circle
  float    fallG;         // impact threshold in g
  float    fallTolG;      // stillness: |a| within this of 1 g
  uint16_t fallStillMs;   // stillness must last this long ...
  uint16_t fallWindowMs;  // ... and be complete within this time after the impact
  uint8_t  dutyPct;       // motor PWM duty in percent (3 V motor on a 4.2 V cell: 70)
  bool     lowVis;        // low visibility guidance (haptic pulse in guide, chase follows the exit station)
  bool     vbatDiv;       // 2 x 200k divider fitted on A0
};

extern BandConfig cfg;
extern bool cfgDirty;    // changed over serial and not saved yet

void configDefaults(bool keepIdentity);   // keepIdentity keeps id and hasMotor
void configLoad();
void configSave();
void configSaveTuning();                  // only the values the gateway pushes (thresholds, RSSI, lowvis)
