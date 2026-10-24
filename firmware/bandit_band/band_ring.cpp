#include "band_ring.h"
#include <Adafruit_NeoPixel.h>
#include <bandit_common.h>
#include <math.h>
#include <string.h>

namespace {

constexpr uint8_t  LEDS = 12;
constexpr uint32_t FRAME_MS = 25;
constexpr uint32_t GREEN = 0x00FF20, AMBER = 0xFFA000, RED = 0xFF0000, BLUE = 0x2040FF, GOLD = 0xFFD000,
                   PINK = 0xFF2080, WHITE = 0xFFFFFF;

Adafruit_NeoPixel strip(LEDS, 3, NEO_GRB + NEO_KHZ800);
uint32_t shown[LEDS];
bool     valid = false;
uint32_t lastFrame = 0;
float    chasePhase = 0;

float wave(uint32_t now, uint32_t period) {   // 0..1 sine
  return 0.5f + 0.5f * sinf((now % period) * 6.2831853f / period);
}

void push(const uint32_t* c) {
  if (valid && memcmp(c, shown, sizeof(shown)) == 0) return;
  for (uint8_t i = 0; i < LEDS; i++) strip.setPixelColor(i, c[i]);
  strip.show();
  memcpy(shown, c, sizeof(shown));
  valid = true;
}

}  // namespace

void ringBegin(uint8_t pin, uint8_t brightness) {
  strip.setPin(pin);
  strip.begin();
  strip.setBrightness(brightness);
  ringOff();
}

void ringOff() {
  uint32_t c[LEDS] = {0};
  valid = false;
  push(c);
}

void ringRender(const RingView& v, uint32_t now) {
  if (now - lastFrame < FRAME_MS) return;
  const uint32_t dt = now - lastFrame;
  lastFrame = now;
  uint32_t c[LEDS] = {0};
  auto fill = [&](uint32_t col) { for (auto& x : c) x = col; };
  const int head = (now / 80) % LEDS;

  if (v.unassigned) {
    fill((now / 500) % 2 ? dimColour(WHITE, 80) : 0);
  } else {
    switch (v.state) {
      case S_IDLE:
        fill(dimColour(GREEN, 40 + (uint8_t)(60 * wave(now, 2000))));
        break;
      case S_YELLOW:
        fill(AMBER);
        break;
      case S_GUIDE: {
        chasePhase += (float)dt / (v.chaseMs ? v.chaseMs : 80);
        chasePhase = fmodf(chasePhase, (float)LEDS);
        const int h = (int)chasePhase;
        for (int i = 0; i < LEDS; i++) {
          const int d = (i - h + LEDS) % LEDS;
          c[i] = d < 4 ? dimColour(v.exitColour, 255 - d * 60) : dimColour(RED, 50);
        }
        break;
      }
      case S_SOS:
        fill((now / 125) % 2 ? RED : 0);   // 4 Hz
        break;
      case S_NEAR_SOS:
        fill(dimColour(BLUE, 60 + (uint8_t)(195 * wave(now, 1000))));
        break;
      case S_PAY:
        for (int i = 0; i < LEDS; i++) c[i] = ((i - head + LEDS) % LEDS) < 3 ? GOLD : dimColour(GOLD, 25);
        break;
      case S_PAID:
        fill(0x00FF00);
        break;
      case S_CONNECT:
        for (auto& x : c) x = random(100) < 30 ? PINK : 0;
        break;
      case S_IDENT:
        fill((now / 200) % 2 ? WHITE : 0);
        break;
      case S_FIND:
        if (v.fill < 0) c[0] = dimColour(v.pairColour, 50);
        else for (int i = 0; i < v.fill && i < LEDS; i++) c[i] = v.pairColour;
        break;
      case S_FOUND_ME:
        fill((now / 100) % 2 ? v.pairColour : 0);   // 5 Hz strobe reads through haze
        break;
      default:
        break;
    }
    if (v.flash) fill(v.flashColour);
  }
  push(c);
}
