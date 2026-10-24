// BandIt band: density, zone, light circle, SOS, fall, pay, find your friend. Usage at the top of bandit_band.ino.
#include <Arduino.h>
#include <driver/gpio.h>
#include <esp_sleep.h>
#include <math.h>
#include <string.h>
#include <bandit_common.h>
#include "band_config.h"
#include "band_haptics.h"
#include "band_mpu.h"
#include "band_ring.h"

namespace {

// ------------------------------------------------------------------ pins (XIAO silkscreen: GPIO)
// GPIO8 (D8) and GPIO9 (D9, BOOT) are strapping pins and are never touched.
constexpr uint8_t PIN_VBAT  = 2;    // D0 / A0, ADC1, optional 2 x 200k divider
constexpr uint8_t PIN_RING  = 3;    // D1, ring DIN through 330 R
constexpr uint8_t PIN_BTN   = 4;    // D2, switch to GND, deep sleep wake source
constexpr uint8_t PIN_SDA   = 6;    // D4
constexpr uint8_t PIN_SCL   = 7;    // D5
constexpr uint8_t PIN_MOTOR = 21;   // D6, 1k to the 2N2222 base

// ------------------------------------------------------------------ timing and tuning constants
constexpr uint8_t  RING_BRIGHT      = 64;     // of 255. 12 LEDs at full white is ~0.7 A: never above ~80 on battery
constexpr float    FAST_TAU_MS      = 500;    // per-peer RSSI smoothing for density, zone, light circle
constexpr float    SLOW_TAU_MS      = 2000;   // per-peer RSSI smoothing for find your friend
constexpr uint32_t DENSITY_MS       = 250;
constexpr float    DENSITY_KEEP     = 0.7f;   // EMA every 250 ms: ~1 s time constant
constexpr uint32_t PRESS_FLAG_MS    = 1000;
constexpr uint32_t PAY_MS           = 8000;
constexpr uint32_t PAID_MS          = 1500;
constexpr uint32_t NEAR_SOS_MS      = 1500;
constexpr uint32_t CONNECT_MS       = 2000;
constexpr uint32_t IDENT_MS         = 3000;
constexpr uint32_t DEBOUNCE_MS      = 25;
constexpr uint32_t HOLD_SOS_MS      = 3000;
constexpr uint32_t HOLD_SLEEP_MS    = 10000;
constexpr uint32_t FIND_TIMEOUT_MS  = 5UL * 60 * 1000;
constexpr uint32_t FIND_LOST_MS     = 3000;   // friend not heard this long: one dim LED, no Geiger
constexpr uint32_t SOUGHT_MS        = 2000;   // a seeker's beacon keeps me "being looked for" this long
constexpr float    FIND_FAR         = -85;    // fill meter: 1 LED at or below ...
constexpr float    FIND_NEAR        = -50;    // ... 12 LEDs at or above
constexpr float    GEIGER_SOLID     = -48;    // continuous buzz above this
constexpr uint32_t GEIGER_SLOW_MS   = 1500;
constexpr uint32_t GEIGER_FAST_MS   = 150;
constexpr float    FOUND_ME_RSSI    = -55;    // seeker this strong for FOUND_ME_DWELL_MS -> FOUND_ME
constexpr float    FOUND_ME_EXIT    = -60;
constexpr uint32_t FOUND_ME_DWELL_MS = 1000;
constexpr uint32_t RAISE_EVERY_MS   = 5000;
constexpr uint32_t GUIDE_PULSE_MS   = 2000;
constexpr uint32_t PING_FLASH_MS    = 250;
constexpr uint8_t  NO_FORCE         = 0xFF;

// ------------------------------------------------------------------ peers (other bands and stations I hear)
struct Peer {
  uint8_t  id = 0;
  int8_t   raw = 0;
  float    fast = -127, slow = -127;
  uint32_t last = 0;
  uint8_t  flags = 0, target = 0, arg = 0, state = 0;

  bool fresh(uint32_t now, uint32_t window) const { return id && now - last < window; }
  void hear(int8_t r, uint32_t t) {
    if (!last || t - last > NEIGH_WINDOW_MS) {
      fast = slow = r;
    } else {
      const float dt = (float)(t - last);
      fast += (r - fast) * dt / (FAST_TAU_MS + dt);
      slow += (r - slow) * dt / (SLOW_TAU_MS + dt);
    }
    raw = r;
    last = t;
  }
};
Peer peers[24];

Peer* peerFor(uint8_t id, bool create) {
  Peer* stalest = &peers[0];
  for (auto& p : peers) {
    if (p.id == id) return &p;
    if (p.last < stalest->last) stalest = &p;
  }
  if (!create) return nullptr;
  *stalest = Peer{};
  stalest->id = id;
  return stalest;
}

// ------------------------------------------------------------------ state
bool        hasMpu = false;
uint8_t     mpuWho = 0;
FallDetector fall;
LineReader  lines;

float     neighSmooth = 0;
uint8_t   neighCount = 0, zone = 0, exitIdx = 1, batPct = 255;
BandState densityState = S_IDLE;
uint8_t   forcedState = NO_FORCE;
uint32_t  forcedUntil = 0;
bool      overrideAuto = false, sos = false, fell = false;
uint32_t  pressUntil = 0, payUntil = 0, paidUntil = 0, connectUntil = 0, identUntil = 0, nearSosUntil = 0;
uint32_t  flashUntil = 0, flashColour = 0;

uint8_t   findId = 0, findColour = 0;            // I am looking for findId
uint32_t  findUntil = 0, lastTick = 0;
uint8_t   seekerId = 0, seekerColour = 0;        // seekerId is looking for me
uint32_t  soughtLast = 0, closeSince = 0, lastRaise = 0;
bool      foundMe = false, raisePending = false;
uint32_t  lastGuidePulse = 0;
bool      sleepPending = false;              // 10 s hold reached: ring dark, sleep on release

uint16_t  seq = 0;
CmdDedupe dedupe;
uint32_t  beaconSlot = 0, nextBeacon = 0, nextHeard = 0, nextDensity = 0;   // beacons: 100 ms grid + 0..30 ms jitter

inline bool before(uint32_t now, uint32_t until) { return (int32_t)(until - now) > 0; }

// ------------------------------------------------------------------ state priority
BandState currentState(uint32_t now) {
  if (before(now, identUntil)) return S_IDENT;
  if (sos || fell) return S_SOS;
  if (before(now, paidUntil)) return S_PAID;
  if (before(now, payUntil)) return S_PAY;
  if (foundMe) return S_FOUND_ME;
  if (findId) return S_FIND;
  if (before(now, connectUntil)) return S_CONNECT;
  if (before(now, nearSosUntil)) return S_NEAR_SOS;
  if (forcedState != NO_FORCE) {
    if (!forcedUntil || before(now, forcedUntil)) return (BandState)forcedState;
    forcedState = NO_FORCE;
  }
  if (overrideAuto) return S_IDLE;
  return densityState;
}

uint8_t flags(uint32_t now) {
  return (sos ? F_SOS : 0) | (fell ? F_FALL : 0) | (before(now, pressUntil) ? F_PRESS : 0) |
         (batPct != 255 && batPct < 15 ? F_LOWBAT : 0) | (hasMpu ? F_MPU : 0) | (cfg.hasMotor ? F_MOTOR : 0);
}

// ------------------------------------------------------------------ radio out
void sendBeacon(uint32_t now, int stateOverride = -1) {
  Pkt p = {};
  p.magic = BANDIT_MAGIC;
  p.type = T_BAND;
  p.id = cfg.id;
  p.flags = flags(now);
  p.neigh = neighCount;
  p.zone = zone;
  p.bat = batPct;
  p.state = stateOverride >= 0 ? (uint8_t)stateOverride : currentState(now);
  p.seq = seq++;
  p.target = findId;
  p.arg = findId ? findColour : 0;
  radioSend(&p, sizeof(p));
}

// every band and station heard in the last 2 s, strongest first
uint8_t collectHeard(HeardEntry* out, uint32_t now) {
  uint8_t n = 0;
  for (const auto& p : peers) {
    if (!p.fresh(now, NEIGH_WINDOW_MS) || n >= HEARD_MAX) continue;
    HeardEntry e{p.id, (int8_t)lroundf(p.fast)};
    uint8_t i = n++;
    while (i > 0 && out[i - 1].rssi < e.rssi) { out[i] = out[i - 1]; i--; }
    out[i] = e;
  }
  return n;
}

void sendHeard(uint32_t now) {
  HeardPkt h;
  h.magic = BANDIT_MAGIC;
  h.type = T_HEARD;
  h.id = cfg.id;
  h.n = collectHeard(h.e, now);
  radioSend(&h, heardLen(h.n));
}

// ------------------------------------------------------------------ find your friend
void startFind(uint8_t friendId, uint8_t colour, uint32_t now) {
  if (!friendId || friendId == cfg.id) return;
  findId = friendId;
  findColour = colour < N_PAIR ? colour : 0;
  findUntil = now + FIND_TIMEOUT_MS;
  lastTick = 0;
  emitf("{\"event\":\"find_start\",\"friend\":%u,\"colour\":%u}", findId, findColour);
}

void stopFind(const char* why) {
  if (findId) emitf("{\"event\":\"find_end\",\"friend\":%u,\"why\":\"%s\"}", findId, why);
  findId = 0;
  hapticHold(false);
}

void ping(uint8_t from) {
  emitf("{\"event\":\"ping\",\"from\":%u}", from);
  flashColour = PAIR_COLOURS[from == findId ? findColour : seekerColour];
  flashUntil = millis() + PING_FLASH_MS;
  hapticPlay(H_SHORT);
}

float mapClamp(float x, float x0, float x1, float y0, float y1) {
  if (x <= x0) return y0;
  if (x >= x1) return y1;
  return y0 + (x - x0) * (y1 - y0) / (x1 - x0);
}

void serviceFind(uint32_t now) {
  if (findId) {
    if (!before(now, findUntil)) {
      stopFind("timeout");
    } else {
      const Peer* fr = peerFor(findId, false);
      const bool heard = fr && fr->fresh(now, FIND_LOST_MS);
      if (heard && fr->slow >= GEIGER_SOLID) {
        hapticHold(true);
      } else {
        hapticHold(false);
        const uint32_t every = (uint32_t)mapClamp(heard ? fr->slow : FIND_FAR, FIND_FAR, FIND_NEAR, GEIGER_SLOW_MS, GEIGER_FAST_MS);
        if (heard && now - lastTick >= every) {
          hapticPlay(H_TICK);
          lastTick = now;
        }
      }
    }
  }

  if (seekerId && now - soughtLast >= SOUGHT_MS) {
    seekerId = 0;
    foundMe = false;
    closeSince = 0;
  }
  if (seekerId) {
    const Peer* s = peerFor(seekerId, false);
    const float r = s ? s->fast : -127;
    if (!foundMe) {
      if (r >= FOUND_ME_RSSI) {
        if (!closeSince) closeSince = now;
        else if (now - closeSince >= FOUND_ME_DWELL_MS) {
          foundMe = true;
          emitf("{\"event\":\"found_me\",\"by\":%u}", seekerId);
        }
      } else {
        closeSince = 0;
      }
      if (raisePending || now - lastRaise >= RAISE_EVERY_MS) {
        hapticPlay(H_RAISE);
        lastRaise = now;
        raisePending = false;
      }
    } else if (r < FOUND_ME_EXIT) {
      foundMe = false;
      closeSince = 0;
    }
  }
}

// ------------------------------------------------------------------ low visibility guidance
const Peer* exitStation(uint32_t now) {   // the strongest station showing my exit colour
  const Peer* best = nullptr;
  for (const auto& p : peers)
    if (p.id >= ID_STATION_MIN && p.state == exitIdx && p.fresh(now, ZONE_WINDOW_MS) && (!best || p.fast > best->fast))
      best = &p;
  return best;
}

uint16_t chaseMs(uint32_t now) {
  if (!cfg.lowVis) return 80;
  const Peer* st = exitStation(now);
  return st ? (uint16_t)mapClamp(st->fast, -85, -45, 160, 40) : 80;
}

void serviceGuide(uint32_t now, BandState s) {
  if (cfg.lowVis && s == S_GUIDE && now - lastGuidePulse >= GUIDE_PULSE_MS) {
    hapticPlay(H_GUIDE);
    lastGuidePulse = now;
  }
}

// ------------------------------------------------------------------ density and zone
void updateDensity(uint32_t now) {
  uint8_t n = 0;
  for (const auto& p : peers)
    if (p.id && p.id <= ID_BAND_MAX && p.fresh(now, NEIGH_WINDOW_MS) && p.fast >= cfg.neighRssi) n++;
  neighSmooth = DENSITY_KEEP * neighSmooth + (1 - DENSITY_KEEP) * n;
  neighCount = (uint8_t)lroundf(neighSmooth);
  const int c = neighCount;
  if (densityState == S_IDLE && c >= cfg.yellowAt) densityState = S_YELLOW;
  if (densityState == S_YELLOW && c >= cfg.redAt) densityState = S_GUIDE;
  if (densityState == S_GUIDE && c < (int)cfg.redAt - 1) densityState = S_YELLOW;
  if (densityState == S_YELLOW && c < (int)cfg.yellowAt - 1) densityState = S_IDLE;

  const Peer* best = nullptr;
  for (const auto& p : peers)
    if (p.id >= ID_STATION_MIN && p.fresh(now, ZONE_WINDOW_MS) && (!best || p.fast > best->fast)) best = &p;
  zone = best ? best->id : 0;
}

// ------------------------------------------------------------------ deep sleep
void goToSleep(uint8_t minutes) {
  const uint32_t now = millis();
  sos = fell = false;
  stopFind("sleep");
  foundMe = false;
  hapticsOff();
  ringOff();
  if (cfg.id)
    for (int i = 0; i < 3; i++) {   // tell the dashboard this band went dark on purpose
      sendBeacon(now, S_OFF);
      delay(40);
    }
  emitf("{\"sleep\":%u}", minutes);
  delay(50);
  pinMode(PIN_RING, OUTPUT);   // take the pin back from RMT and hold DIN low so the ring cannot latch noise
  digitalWrite(PIN_RING, LOW);
  gpio_hold_en((gpio_num_t)PIN_RING);
  gpio_hold_en((gpio_num_t)PIN_MOTOR);
#if SOC_GPIO_SUPPORT_HOLD_IO_IN_DSLP && !SOC_GPIO_SUPPORT_HOLD_SINGLE_IO_IN_DSLP
  gpio_deep_sleep_hold_en();
#endif
  gpio_pullup_en((gpio_num_t)PIN_BTN);
  gpio_pulldown_dis((gpio_num_t)PIN_BTN);
  esp_deep_sleep_enable_gpio_wakeup(1ULL << PIN_BTN, ESP_GPIO_WAKEUP_GPIO_LOW);
  if (minutes) esp_sleep_enable_timer_wakeup((uint64_t)minutes * 60ULL * 1000000ULL);
  esp_deep_sleep_start();
}

// ------------------------------------------------------------------ button: short press, 3 s hold, 10 s hold
void onShortPress(uint32_t now) {
  pressUntil = now + PRESS_FLAG_MS;   // approve during PAY, ping during FIND
  hapticPlay(H_SHORT);
}

void onHold3(uint32_t now) {
  (void)now;
  if (findId) {   // 3 s hold on the seeker ends find; the next 3 s hold raises SOS
    stopFind("hold");
    hapticPlay(H_LONG);
  } else if (sos || fell) {
    sos = fell = false;
    hapticPlay(H_LONG);
  } else {
    sos = true;
    hapticPlay(H_SOS);
  }
}

void serviceButton(uint32_t now) {
  static bool raw = false, stable = false, armed = false, fired3 = false;
  static uint32_t changedAt = 0, downAt = 0;
  const bool r = digitalRead(PIN_BTN) == LOW;
  if (r != raw) { raw = r; changedAt = now; }
  const bool settled = now - changedAt >= DEBOUNCE_MS;
  if (settled && r != stable) {       // debounced edge
    stable = r;
    if (armed) {
      if (stable) { downAt = now; fired3 = false; sleepPending = false; }
      else if (sleepPending) goToSleep(0);
      else if (!fired3) onShortPress(now);
    }
  }
  if (settled && !stable) armed = true;   // a button held at boot or at wake does nothing until released once
  if (!armed || !stable) return;
  if (!fired3 && now - downAt >= HOLD_SOS_MS) { fired3 = true; onHold3(now); }
  if (!sleepPending && now - downAt >= HOLD_SLEEP_MS) { sleepPending = true; hapticsOff(); ringOff(); }   // dark: release to sleep
}

// ------------------------------------------------------------------ battery
uint8_t lipoPercent(uint32_t mv) {
  static const uint16_t MV[]  = {3300, 3500, 3600, 3700, 3750, 3800, 3900, 4000, 4100, 4200};
  static const uint8_t  PCT[] = {0, 5, 12, 25, 35, 45, 60, 75, 88, 100};
  if (mv <= MV[0]) return 0;
  for (int i = 1; i < 10; i++)
    if (mv < MV[i]) return PCT[i - 1] + (PCT[i] - PCT[i - 1]) * (mv - MV[i - 1]) / (MV[i] - MV[i - 1]);
  return 100;
}

void serviceBattery(uint32_t now) {
  static uint32_t last = 0;
  if (!cfg.vbatDiv) { batPct = 255; return; }
  if (batPct != 255 && now - last < 5000) return;
  last = now;
  uint32_t mv = 0;
  for (int i = 0; i < 16; i++) mv += analogReadMilliVolts(PIN_VBAT);
  batPct = lipoPercent(mv / 16 * 2);
}

// ------------------------------------------------------------------ gateway commands
void handleCmd(const Pkt& p, uint32_t now) {
  if (!cfg.id || (p.target != ID_ALL_BANDS && p.target != cfg.id)) return;
  if (dedupe.seen(p.id, p.seq, now)) return;   // 3 repeats, act once
  emitf("{\"event\":\"cmd\",\"cmd\":%u,\"arg\":%u,\"arg2\":%u}", p.cmd, p.arg, p.arg2);
  const uint32_t hold = p.arg2 * 100UL;
  switch (p.cmd) {
    case CMD_STATE:
      if (p.arg == S_CONNECT) connectUntil = now + (hold ? hold : CONNECT_MS);
      else if (p.arg == S_IDENT) identUntil = now + (hold ? hold : IDENT_MS);
      else if (p.arg < S_COUNT) { forcedState = p.arg; forcedUntil = hold ? now + hold : 0; }
      break;
    case CMD_EXIT:
      if (p.arg >= 1 && p.arg <= N_EXIT) exitIdx = p.arg;
      break;
    case CMD_CLEAR:
      sos = fell = false;
      forcedState = NO_FORCE;
      nearSosUntil = 0;
      break;
    case CMD_BUZZ:
      hapticPlay(p.arg >= H_SHORT && p.arg <= H_LONG ? p.arg : H_SHORT);
      break;
    case CMD_HAPTIC:
      if (p.arg <= H_PUBLIC_MAX) hapticPlay(p.arg);
      break;
    case CMD_PAY:
      payUntil = now + PAY_MS;
      hapticPlay(H_DOUBLE);
      break;
    case CMD_PAID:
      payUntil = 0;
      paidUntil = now + PAID_MS;
      hapticPlay(H_SHORT);
      break;
    case CMD_THRESH:
      if (p.arg >= 1 && p.arg2 >= p.arg) {
        cfg.yellowAt = p.arg;
        cfg.redAt = p.arg2;
        configSaveTuning();
      }
      break;
    case CMD_RSSI:
      if (p.arg >= 20 && p.arg <= 100 && p.arg2 >= 20 && p.arg2 <= 100) {
        cfg.neighRssi = -(int)p.arg;
        cfg.circleRssi = -(int)p.arg2;
        configSaveTuning();
      }
      break;
    case CMD_OVERRIDE:
      overrideAuto = p.arg != 0;
      break;
    case CMD_FIND:
      if (p.arg) startFind(p.arg, p.arg2, now);
      else stopFind("cmd");
      break;
    case CMD_SLEEP:
      goToSleep(p.arg);
      break;
    case CMD_LOWVIS:
      if (cfg.lowVis != (p.arg != 0)) {
        cfg.lowVis = p.arg != 0;
        configSaveTuning();
      }
      break;
  }
}

// ------------------------------------------------------------------ radio in
void onFrame(const RxFrame& f) {
  const uint8_t type = f.data[1];
  if (type == T_HEARD || f.len < sizeof(Pkt)) return;
  Pkt p;
  memcpy(&p, f.data, sizeof(p));
  if (type == T_CMD) {
    handleCmd(p, f.t);
  } else if (type == T_STATION && p.id >= ID_STATION_MIN) {
    Peer* e = peerFor(p.id, true);
    e->hear(f.rssi, f.t);
    e->state = p.state;
  } else if (type == T_BAND && p.id && p.id <= ID_BAND_MAX && p.id != cfg.id) {
    Peer* e = peerFor(p.id, true);
    const uint8_t prevFlags = e->fresh(f.t, NEIGH_WINDOW_MS) ? e->flags : 0;
    e->hear(f.rssi, f.t);
    e->flags = p.flags;
    e->target = p.target;
    e->arg = p.arg;
    e->state = p.state;
    if ((p.flags & (F_SOS | F_FALL)) && e->fast >= cfg.circleRssi) nearSosUntil = f.t + NEAR_SOS_MS;   // light circle
    if (cfg.id && p.target == cfg.id) {   // someone is looking for me
      if (seekerId != p.id) {
        seekerId = p.id;
        foundMe = false;
        closeSince = 0;
        raisePending = true;
        emitf("{\"event\":\"sought\",\"by\":%u}", p.id);
      }
      seekerColour = p.arg < N_PAIR ? p.arg : 0;
      soughtLast = f.t;
    }
    const bool partner = (findId && p.id == findId) || (seekerId && p.id == seekerId);
    if (partner && (p.flags & F_PRESS) && !(prevFlags & F_PRESS)) ping(p.id);   // two-way ping
  }
}

// ------------------------------------------------------------------ serial: config and bench commands
void printInfo() {
  char mac[18];
  macToStr(selfMac(), mac);
  emitf("{\"info\":\"band\",\"id\":%u,\"mac\":\"%s\",\"hasMpu\":%d,\"mpuWho\":%u,\"hasMotor\":%d,\"yellow\":%u,\"red\":%u,"
        "\"neighRssi\":%d,\"circleRssi\":%d,\"fallG\":%.2f,\"fallTol\":%.2f,\"fallStillMs\":%u,\"fallWinMs\":%u,"
        "\"duty\":%u,\"lowvis\":%d,\"vbat\":%d,\"saved\":%d,\"fw\":\"%s\"}",
        cfg.id, mac, hasMpu, mpuWho, cfg.hasMotor, cfg.yellowAt, cfg.redAt, cfg.neighRssi, cfg.circleRssi, cfg.fallG,
        cfg.fallTolG, cfg.fallStillMs, cfg.fallWindowMs, cfg.dutyPct, cfg.lowVis, cfg.vbatDiv, !cfgDirty, BANDIT_FW);
}

void handleSerial(char* line, uint32_t now) {
  char* w[6];
  const int n = splitWords(line, w, 6);
  if (!n) return;
  const char* c = w[0];
  long a = 0, b = 0;
  float fa = 0, fb = 0;
  const bool n1 = n >= 2 && parseLong(w[1], a);
  const bool n2 = n1 && n >= 3 && parseLong(w[2], b);
  auto is = [&](const char* s) { return strcmp(c, s) == 0; };
  auto changed = [&]() { cfgDirty = true; printInfo(); };
  auto ok = [&]() { emitf("{\"ok\":\"%s\"}", c); };

  if (is("info")) printInfo();
  else if (is("save")) { configSave(); printInfo(); }
  else if (is("reset")) { emitf("{\"ok\":\"reset\"}"); delay(50); ESP.restart(); }
  else if (is("defaults")) { configDefaults(true); hapticsBegin(PIN_MOTOR, cfg.hasMotor, cfg.dutyPct); changed(); }
  else if (is("id") && n1 && a >= 0 && a <= ID_BAND_MAX) { cfg.id = a; changed(); }
  else if (is("motor") && n1 && (a == 0 || a == 1)) { cfg.hasMotor = a; hapticsBegin(PIN_MOTOR, cfg.hasMotor, cfg.dutyPct); changed(); }
  else if (is("thresh") && n2 && a >= 1 && b >= a && b <= 50) { cfg.yellowAt = a; cfg.redAt = b; changed(); }
  else if (is("rssi") && n2 && labs(a) >= 20 && labs(a) <= 100 && labs(b) >= 20 && labs(b) <= 100) {
    cfg.neighRssi = -labs(a); cfg.circleRssi = -labs(b); changed();
  }
  else if (is("fall") && n == 5 && parseFloat(w[1], fa) && parseFloat(w[2], fb) && parseLong(w[3], a) && parseLong(w[4], b) &&
           fa > 1.2f && fa < 8 && fb > 0 && fb < 1 && a >= 100 && a <= 10000 && b >= a && b <= 20000) {
    cfg.fallG = fa; cfg.fallTolG = fb; cfg.fallStillMs = a; cfg.fallWindowMs = b; changed();
  }
  else if (is("duty") && n1 && a >= 10 && a <= 100) { cfg.dutyPct = a; hapticsBegin(PIN_MOTOR, cfg.hasMotor, cfg.dutyPct); changed(); }
  else if (is("lowvis") && n1 && (a == 0 || a == 1)) { cfg.lowVis = a; changed(); }
  else if (is("vbat") && n1 && (a == 0 || a == 1)) { cfg.vbatDiv = a; batPct = 255; changed(); }
  // bench commands
  else if (is("sos")) { sos = !sos; if (!sos) fell = false; if (sos) hapticPlay(H_SOS); ok(); }
  else if (is("clear")) { sos = fell = false; forcedState = NO_FORCE; nearSosUntil = 0; ok(); }
  else if (is("pay")) { payUntil = now + PAY_MS; hapticPlay(H_DOUBLE); ok(); }
  else if (is("paid")) { payUntil = 0; paidUntil = now + PAID_MS; hapticPlay(H_SHORT); ok(); }
  else if (is("press")) { onShortPress(now); ok(); }
  else if (is("buzz")) { hapticPlay(H_DOUBLE); ok(); }
  else if (is("haptic") && n1 && a >= 0 && a <= H_TICK) { hapticPlay(a); ok(); }
  else if (is("state") && n1 && a >= 0 && a < S_COUNT) { forcedState = a; forcedUntil = 0; ok(); }
  else if (is("auto")) { forcedState = NO_FORCE; overrideAuto = false; ok(); }
  else if (is("exit") && n1 && a >= 1 && a <= N_EXIT) { exitIdx = a; ok(); }
  else if (is("find") && n1 && a >= 0 && a <= ID_BAND_MAX) { if (a) startFind(a, n2 ? b : 0, now); else stopFind("serial"); ok(); }
  else if (is("ident")) { identUntil = now + IDENT_MS; ok(); }
  else if (is("sleep")) { goToSleep(n1 && a > 0 && a < 256 ? a : 0); }
  else emitf("{\"err\":\"bad command\",\"cmd\":\"%s\"}", c);
}

void printStatus(uint32_t now, BandState s) {
  static uint32_t last = 0;
  if (now - last < 1000) return;
  last = now;
  HeardEntry h[HEARD_MAX];
  const uint8_t n = collectHeard(h, now);
  const Peer* fr = findId ? peerFor(findId, false) : nullptr;
  LineBuf l;
  l.add("{\"status\":\"band\",\"t\":%lu,\"id\":%u,\"state\":%u,\"neigh\":%u,\"smooth\":%.2f,\"zone\":%u,\"flags\":%u,"
        "\"bat\":%u,\"find\":%u,\"friend\":%d,\"sought\":%u,\"g\":%.2f,\"heard\":[",
        (unsigned long)now, cfg.id, s, neighCount, neighSmooth, zone, flags(now), batPct, findId,
        fr && fr->fresh(now, FIND_LOST_MS) ? (int)lroundf(fr->slow) : 0, seekerId, hasMpu ? fall.takePeak() : 0.0f);
  for (uint8_t i = 0; i < n; i++) l.add("%s[%u,%d]", i ? "," : "", h[i].id, h[i].rssi);
  l.add("]}");
  l.emit();
}

void render(uint32_t now, BandState s) {
  if (sleepPending) return;
  RingView v{};
  v.state = s;
  v.unassigned = cfg.id == 0;
  v.exitColour = EXIT_COLOURS[exitIdx];
  v.pairColour = PAIR_COLOURS[s == S_FOUND_ME ? seekerColour : findColour];
  const Peer* fr = findId ? peerFor(findId, false) : nullptr;
  v.fill = fr && fr->fresh(now, FIND_LOST_MS) ? (int8_t)lroundf(mapClamp(fr->slow, FIND_FAR, FIND_NEAR, 1, 12)) : -1;
  v.chaseMs = chaseMs(now);
  v.flash = before(now, flashUntil) && s != S_IDENT && s != S_SOS && s != S_PAID && s != S_PAY;
  v.flashColour = flashColour;
  ringRender(v, now);
}

const char* wakeReason() {
  switch (esp_sleep_get_wakeup_cause()) {
    case ESP_SLEEP_WAKEUP_GPIO: return "button";
    case ESP_SLEEP_WAKEUP_TIMER: return "timer";
    default: return "power";
  }
}

}  // namespace

// ------------------------------------------------------------------ arduino
void setup() {
  gpio_hold_dis((gpio_num_t)PIN_RING);
  gpio_hold_dis((gpio_num_t)PIN_MOTOR);
  gpio_hold_dis((gpio_num_t)PIN_BTN);
#if SOC_GPIO_SUPPORT_HOLD_IO_IN_DSLP && !SOC_GPIO_SUPPORT_HOLD_SINGLE_IO_IN_DSLP
  gpio_deep_sleep_hold_dis();
#endif
  pinMode(PIN_MOTOR, OUTPUT);   // first: the bootloader leaves this pin (U0TXD) idling high, which runs the motor
  digitalWrite(PIN_MOTOR, LOW);
  pinMode(PIN_BTN, INPUT_PULLUP);
  serialBegin(2048, 256);
  configLoad();
  ringBegin(PIN_RING, RING_BRIGHT);
  hapticsBegin(PIN_MOTOR, cfg.hasMotor, cfg.dutyPct);
  hasMpu = mpuBegin(PIN_SDA, PIN_SCL, &mpuWho);
  analogReadResolution(12);
  if (!radioBegin(BAND_TX_POWER, 32)) {
    emitf("{\"err\":\"esp_now_init\"}");
    delay(1000);
    ESP.restart();
  }
  char mac[18];
  macToStr(selfMac(), mac);
  emitf("{\"boot\":\"band\",\"id\":%u,\"mac\":\"%s\",\"hasMpu\":%d,\"hasMotor\":%d,\"wake\":\"%s\",\"fw\":\"%s\"}", cfg.id,
        mac, hasMpu, cfg.hasMotor, wakeReason(), BANDIT_FW);
  identUntil = millis() + 1500;   // white blink on boot so a reset is visible
}

void loop() {
  RxFrame f;
  for (int i = 0; i < 16 && radioPoll(f); i++) onFrame(f);
  const uint32_t now = millis();
  if (cfg.id && (int32_t)(now - nextBeacon) >= 0) {
    sendBeacon(now);
    beaconSlot += BAND_BEACON_MS;   // the jitter does not accumulate: exactly 10 Hz on average
    if ((int32_t)(now - beaconSlot) >= (int32_t)BAND_BEACON_MS) beaconSlot = now;   // after a stall, restart the grid
    nextBeacon = beaconSlot + random(0, BAND_JITTER_MS + 1);
  }
  if (cfg.id && (int32_t)(now - nextHeard) >= 0) {
    sendHeard(now);
    nextHeard = now + HEARD_MS + random(0, 50);
  }
  if ((int32_t)(now - nextDensity) >= 0) {
    updateDensity(now);
    nextDensity = now + DENSITY_MS;
  }
  serviceButton(now);
  if (hasMpu && fall.service(now, cfg.fallG, cfg.fallTolG, cfg.fallStillMs, cfg.fallWindowMs)) {
    fell = true;
    hapticPlay(H_SOS);
    emitf("{\"event\":\"fall\",\"g\":%.2f}", fall.lastG());
  }
  serviceFind(now);
  const BandState s = currentState(now);
  serviceGuide(now, s);
  hapticsService(now);
  serviceBattery(now);
  render(now, s);
  if (char* l = lines.poll(Serial)) handleSerial(l, now);
  printStatus(now, s);
  vTaskDelay(1);   // one tick so the idle task can halt the core between passes; all timing is millis() driven
}
