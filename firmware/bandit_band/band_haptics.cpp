#include "band_haptics.h"
#include <bandit_common.h>

namespace {

// on / off durations in ms, starting with on
const uint16_t P_SHORT[]  = {120};
const uint16_t P_DOUBLE[] = {100, 100, 100};
const uint16_t P_LONG[]   = {600};
const uint16_t P_SOS[]    = {150, 150, 150, 150, 150, 400, 500, 200, 500, 200, 500};
const uint16_t P_RAISE[]  = {300, 200, 300, 200, 300};
const uint16_t P_GUIDE[]  = {200};
const uint16_t P_TICK[]   = {35};

struct Pattern {
  const uint16_t* steps;
  uint8_t         n;
  uint8_t         prio;
};

#define PAT(a, prio) {a, sizeof(a) / sizeof(a[0]), prio}
const Pattern PATTERNS[] = {
    {nullptr, 0, 0},  PAT(P_SHORT, 2), PAT(P_DOUBLE, 2), PAT(P_LONG, 2),
    PAT(P_SOS, 3),    PAT(P_RAISE, 2), PAT(P_GUIDE, 1),  PAT(P_TICK, 1),
};
#undef PAT
constexpr uint8_t N_PATTERNS = sizeof(PATTERNS) / sizeof(PATTERNS[0]);

uint8_t        pin = 0xFF;
bool           enabled = false, attached = false, hold = false, level = false;
uint8_t        duty = 178;
const Pattern* cur = nullptr;
uint8_t        idx = 0;
uint32_t       nextAt = 0;

void drive(bool on) {
  if (on == level) return;
  level = on;
  if (attached) ledcWrite(pin, on ? duty : 0);
}

}  // namespace

void hapticsBegin(uint8_t p, bool en, uint8_t dutyPct) {
  pin = p;
  duty = (uint8_t)((uint16_t)(dutyPct > 100 ? 100 : dutyPct) * 255 / 100);
  if (en && !attached) attached = ledcAttach(pin, 20000, 8);
  if (!en && attached) {
    ledcDetach(pin);
    attached = false;
  }
  enabled = en && attached;
  if (!attached) {
    pinMode(pin, OUTPUT);
    digitalWrite(pin, LOW);
  } else {
    ledcWrite(pin, 0);
  }
  level = false;
  cur = nullptr;
}

void hapticPlay(uint8_t pattern) {
  if (!enabled || pattern >= N_PATTERNS) return;
  if (pattern == H_STOP) {
    hapticStop();
    return;
  }
  const Pattern* p = &PATTERNS[pattern];
  if (cur && cur->prio > p->prio) return;
  cur = p;
  idx = 0;
  nextAt = millis();
}

void hapticStop() {
  cur = nullptr;
  hold = false;
  drive(false);
}

void hapticHold(bool on) { hold = on && enabled; }

void hapticsService(uint32_t now) {
  if (!enabled) return;
  if (cur) {
    if ((int32_t)(now - nextAt) < 0) return;
    if (idx >= cur->n) {
      cur = nullptr;
    } else {
      drive(idx % 2 == 0);
      nextAt = now + cur->steps[idx];
      idx++;
      return;
    }
  }
  drive(hold);
}

void hapticsOff() {
  cur = nullptr;
  hold = false;
  if (attached) {
    ledcWrite(pin, 0);
    ledcDetach(pin);
    attached = false;
  }
  enabled = false;
  level = false;
  if (pin != 0xFF) {
    pinMode(pin, OUTPUT);
    digitalWrite(pin, LOW);
  }
}
