#pragma once
#include <Arduino.h>

constexpr uint8_t H_TICK = 7;

void hapticsBegin(uint8_t pin, bool enabled, uint8_t dutyPct);
void hapticPlay(uint8_t pattern);
void hapticStop();
void hapticHold(bool on);
void hapticsService(uint32_t now);
void hapticsOff();
