// MPU-6050 (GY-521) on I2C at 0x68, raw Wire calls, accelerometer only. Detected at boot.
#pragma once
#include <Arduino.h>

bool mpuBegin(uint8_t sda, uint8_t scl, uint8_t* whoami);   // false when nothing answers at 0x68
bool mpuReadG(float& g);                                     // |a| in g, +/- 8 g range

// Fall = impact above impactG, then |a| within tolG of 1 g for stillMs, complete within windowMs of the impact.
class FallDetector {
 public:
  bool  service(uint32_t now, float impactG, float tolG, uint16_t stillMs, uint16_t windowMs);   // true once per fall
  float lastG() const { return g_; }
  float takePeak() { float p = peak_; peak_ = 0; return p; }   // highest |a| since the last call (for tuning)

 private:
  uint32_t lastRead_ = 0, impactAt_ = 0, stillSince_ = 0;
  float    g_ = 1.0f, peak_ = 0.0f;
};
