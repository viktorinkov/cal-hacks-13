#include "band_mpu.h"
#include <Wire.h>
#include <math.h>

namespace {

constexpr uint8_t MPU_ADDR = 0x68;

bool writeReg(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);
  Wire.write(val);
  return Wire.endTransmission() == 0;
}

bool readRegs(uint8_t reg, uint8_t* out, uint8_t n) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(MPU_ADDR, n) != n) return false;
  for (uint8_t i = 0; i < n; i++) out[i] = (uint8_t)Wire.read();
  return true;
}

}

bool mpuBegin(uint8_t sda, uint8_t scl, uint8_t* whoami) {
  if (!Wire.begin(sda, scl, 400000)) return false;
  Wire.setTimeOut(10);
  Wire.beginTransmission(MPU_ADDR);
  if (Wire.endTransmission() != 0) {
    Wire.end();
    return false;
  }
  uint8_t who = 0;
  readRegs(0x75, &who, 1);
  if (whoami) *whoami = who;
  writeReg(0x6B, 0x80);
  delay(50);
  writeReg(0x6B, 0x00);
  writeReg(0x6C, 0x07);
  writeReg(0x1C, 0x10);
  writeReg(0x1A, 0x03);
  return true;
}

bool mpuReadG(float& g) {
  uint8_t b[6];
  if (!readRegs(0x3B, b, 6)) return false;
  const float x = (int16_t)(b[0] << 8 | b[1]) / 4096.0f;
  const float y = (int16_t)(b[2] << 8 | b[3]) / 4096.0f;
  const float z = (int16_t)(b[4] << 8 | b[5]) / 4096.0f;
  g = sqrtf(x * x + y * y + z * z);
  return true;
}

bool FallDetector::service(uint32_t now, float impactG, float tolG, uint16_t stillMs, uint16_t windowMs) {
  if (now - lastRead_ < 20) return false;
  lastRead_ = now;
  float a;
  if (!mpuReadG(a)) return false;
  g_ = a;
  if (a > peak_) peak_ = a;
  if (a > impactG) {
    impactAt_ = now;
    stillSince_ = 0;
    return false;
  }
  if (!impactAt_) return false;
  if (now - impactAt_ > windowMs) {
    impactAt_ = 0;
    stillSince_ = 0;
    return false;
  }
  if (fabsf(a - 1.0f) < tolG) {
    if (!stillSince_) stillSince_ = now;
    else if (now - stillSince_ >= stillMs) {
      impactAt_ = 0;
      stillSince_ = 0;
      return true;
    }
  } else {
    stillSince_ = 0;
  }
  return false;
}
