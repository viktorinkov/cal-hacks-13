// Coin motor through a 2N2222, PWM at 20 kHz. Every call is a no-op on a band without a motor.
#pragma once
#include <Arduino.h>

constexpr uint8_t H_TICK = 7;   // Geiger tick, internal only (public patterns 0..6 are in bandit_common.h)

void hapticsBegin(uint8_t pin, bool enabled, uint8_t dutyPct);   // safe to call again when the config changes
void hapticPlay(uint8_t pattern);   // a pattern only interrupts one of equal or lower priority
void hapticStop();
void hapticHold(bool on);           // continuous buzz while no pattern plays (Geiger "very close")
void hapticsService(uint32_t now);
void hapticsOff();                  // motor off, pin driven low (before deep sleep)
