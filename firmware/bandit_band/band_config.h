#pragma once
#include <Arduino.h>

struct BandConfig {
  uint8_t  id;
  bool     hasMotor;
  uint8_t  yellowAt;
  uint8_t  redAt;
  int8_t   neighRssi;
  int8_t   circleRssi;
  float    fallG;
  float    fallTolG;
  uint16_t fallStillMs;
  uint16_t fallWindowMs;
  uint8_t  dutyPct;
  bool     lowVis;
  bool     vbatDiv;
};

extern BandConfig cfg;
extern bool cfgDirty;

void configDefaults(bool keepIdentity);
void configLoad();
void configSave();
void configSaveTuning();
