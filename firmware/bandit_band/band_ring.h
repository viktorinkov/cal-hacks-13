#pragma once
#include <Arduino.h>

struct RingView {
  uint8_t  state;
  bool     unassigned;
  uint32_t exitColour;
  uint32_t pairColour;
  int8_t   fill;
  uint16_t chaseMs;
  bool     flash;
  uint32_t flashColour;
};

void ringBegin(uint8_t pin, uint8_t brightness);
void ringRender(const RingView& v, uint32_t now);
void ringOff();
