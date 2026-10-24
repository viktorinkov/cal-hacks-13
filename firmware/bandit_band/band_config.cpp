#include "band_config.h"
#include <Preferences.h>
#include <bandit_common.h>

BandConfig cfg;
bool cfgDirty = false;

static const char* NS = "bandit";

void configDefaults(bool keepIdentity) {
  const uint8_t id = cfg.id;
  const bool motor = cfg.hasMotor;
  cfg = BandConfig{0, false, 3, 5, NEIGH_RSSI_MIN, CIRCLE_RSSI_MIN, 2.8f, 0.2f, 1500, 3500, 70, false, false};
  if (keepIdentity) {
    cfg.id = id;
    cfg.hasMotor = motor;
  }
}

void configLoad() {
  configDefaults(false);
  Preferences p;
  if (!p.begin(NS, true)) return;  // fails on a fresh board: the namespace does not exist yet
  cfg.id = p.getUChar("id", cfg.id);
  cfg.hasMotor = p.getBool("motor", cfg.hasMotor);
  cfg.yellowAt = p.getUChar("yellow", cfg.yellowAt);
  cfg.redAt = p.getUChar("red", cfg.redAt);
  cfg.neighRssi = p.getChar("nrssi", cfg.neighRssi);
  cfg.circleRssi = p.getChar("crssi", cfg.circleRssi);
  cfg.fallG = p.getFloat("fallg", cfg.fallG);
  cfg.fallTolG = p.getFloat("falltol", cfg.fallTolG);
  cfg.fallStillMs = p.getUShort("fallstill", cfg.fallStillMs);
  cfg.fallWindowMs = p.getUShort("fallwin", cfg.fallWindowMs);
  cfg.dutyPct = p.getUChar("duty", cfg.dutyPct);
  cfg.lowVis = p.getBool("lowvis", cfg.lowVis);
  cfg.vbatDiv = p.getBool("vbat", cfg.vbatDiv);
  p.end();
}

void configSave() {
  Preferences p;
  if (!p.begin(NS, false)) return;
  p.putUChar("id", cfg.id);
  p.putBool("motor", cfg.hasMotor);
  p.putUChar("yellow", cfg.yellowAt);
  p.putUChar("red", cfg.redAt);
  p.putChar("nrssi", cfg.neighRssi);
  p.putChar("crssi", cfg.circleRssi);
  p.putFloat("fallg", cfg.fallG);
  p.putFloat("falltol", cfg.fallTolG);
  p.putUShort("fallstill", cfg.fallStillMs);
  p.putUShort("fallwin", cfg.fallWindowMs);
  p.putUChar("duty", cfg.dutyPct);
  p.putBool("lowvis", cfg.lowVis);
  p.putBool("vbat", cfg.vbatDiv);
  p.end();
  cfgDirty = false;
}

void configSaveTuning() {
  Preferences p;
  if (!p.begin(NS, false)) return;
  p.putUChar("yellow", cfg.yellowAt);
  p.putUChar("red", cfg.redAt);
  p.putChar("nrssi", cfg.neighRssi);
  p.putChar("crssi", cfg.circleRssi);
  p.putBool("lowvis", cfg.lowVis);
  p.end();
}
