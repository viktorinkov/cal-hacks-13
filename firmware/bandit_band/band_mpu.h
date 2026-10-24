#pragma once
#include <Arduino.h>

bool mpuBegin(uint8_t sda, uint8_t scl, uint8_t* whoami);
bool mpuReadG(float& g);

class FallDetector {
 public:
  bool  service(uint32_t now, float impactG, float tolG, uint16_t stillMs, uint16_t windowMs);
  float lastG() const { return g_; }
  float takePeak() { float p = peak_; peak_ = 0; return p; }

 private:
  uint32_t lastRead_ = 0, impactAt_ = 0, stillSince_ = 0;
  float    g_ = 1.0f, peak_ = 0.0f;
};
