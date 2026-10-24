// 12-LED WS2812B ring. Renders one RingView at up to 40 fps and only pushes frames that changed.
#pragma once
#include <Arduino.h>

struct RingView {
  uint8_t  state;         // BandState
  bool     unassigned;    // id 0: slow white blink
  uint32_t exitColour;    // GUIDE chase colour
  uint32_t pairColour;    // FIND fill / FOUND_ME strobe colour
  int8_t   fill;          // FIND: 1..12 LEDs lit, -1 = friend not heard (one dim LED)
  uint16_t chaseMs;       // GUIDE: ms per chase step
  bool     flash;         // ping from my find partner: one flash in flashColour
  uint32_t flashColour;
};

void ringBegin(uint8_t pin, uint8_t brightness);
void ringRender(const RingView& v, uint32_t now);
void ringOff();
