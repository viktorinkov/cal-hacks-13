/*
  BandIt band firmware, v0.1 skeleton (Cal Hacks 13.0)
  Board: Seeed XIAO ESP32C3   Core: "esp32 by Espressif" 3.x   Library: Adafruit NeoPixel

  NOT COMPILED HERE. Written against the arduino-esp32 3.x API (ledcAttach, esp_now_recv_info_t). Expect to fix a few
  compile nits, then it should run. Everything is non-blocking; loop() runs at a few kHz.

  What it does
    - beacons its id over ESP-NOW broadcast at 10 Hz and listens to everyone else
    - counts nearby bands (RSSI above a threshold, heard in the last 2 s), smooths it, drives GREEN / YELLOW / GUIDE
    - picks its zone = strongest station beacon
    - button: short press = confirm (F_PRESS for 1 s), hold 3 s = SOS latch (strobe + buzz), hold 3 s again = clear
    - joins the light circle (blue pulse) when a nearby band is in SOS
    - FULL_BAND: reads the MPU-6050 at 50 Hz, detects a fall (impact then stillness) and raises F_FALL + SOS
    - obeys gateway commands (state, exit colour, pay prompt, clear, buzz, live threshold tuning)

  Per band: set BAND_ID (1..9) and FULL_BAND, flash, label the case with the id.
*/
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <Wire.h>
#include <Adafruit_NeoPixel.h>
#include "bandit_common.h"

BandState currentState();   // forward declaration (the Arduino preprocessor sometimes misses enum-returning functions)
void startBuzz(const uint16_t* pat, uint8_t len, uint8_t reps);

// ------------------------------------------------------------------ per-band config
#define BAND_ID      1
#define FULL_BAND    0        // 1 on the three bands that carry the MPU-6050 and the motor
#define HAS_VBAT_DIV 0        // 1 if you fitted the 2 x 200k divider on A0

// ------------------------------------------------------------------ pins (XIAO silkscreen)
#define PIN_VBAT   A0    // D0  GPIO2   ADC1, optional battery divider
#define PIN_RING   D1    // GPIO3       WS2812B DIN through 330 R
#define PIN_BTN    D2    // GPIO4       tactile switch to GND
#define PIN_SDA    D4    // GPIO6       MPU-6050
#define PIN_SCL    D5    // GPIO7
#define PIN_MOTOR  D6    // GPIO21      1k -> 2N2222 base
// D8 (GPIO8) and D9 (GPIO9) are strapping pins: leave them unconnected.

// ------------------------------------------------------------------ tunables (CMD_THRESH / CMD_RSSI can change the first four live)
uint8_t  yellowAt = 3, redAt = 5;              // smoothed neighbour counts; hysteresis = 1 below each
int8_t   neighRssiMin = NEIGH_RSSI_MIN;
int8_t   circleRssiMin = CIRCLE_RSSI_MIN;
const uint8_t RING_BRIGHT = 64;                // 0..255. 12 LEDs at full white is ~0.7 A: keep this at or below 80 on battery
const uint8_t MOTOR_DUTY  = 180;               // of 255 (~70%): 3 V motor on up to 4.2 V
const uint8_t TX_POWER    = 32;                // 0.25 dBm units: 32 = 8 dBm. Lower shrinks range, the gateway must still hear you.

// ------------------------------------------------------------------ exit colours (index used by CMD_EXIT and by stations)
const uint32_t EXIT_COLOURS[] = { 0, 0x0000FF, 0xFF00FF, 0x00FFFF, 0xFFFFFF, 0xFF6000, 0x8000FF };  // 1 blue, 2 magenta, 3 cyan, 4 white, 5 orange, 6 violet
const uint8_t  N_EXIT = 6;

// ------------------------------------------------------------------ state
Adafruit_NeoPixel ring(12, PIN_RING, NEO_GRB + NEO_KHZ800);
struct Seen { uint8_t id; int8_t rssi; uint32_t last; uint8_t flags; };
Seen bands[32];  uint8_t nBands = 0;
Seen stations[8]; uint8_t nStations = 0;

float    neighSmooth = 0;
uint8_t  neighCount = 0;
uint8_t  zone = 0;
uint8_t  exitColour = 1;
BandState densityState = S_IDLE;      // what the density logic wants
BandState forcedState = S_OFF;        // what the gateway forced (S_OFF = nothing forced)
uint32_t forcedUntil = 0;
bool     overrideAuto = false;
bool     sos = false, fell = false;
uint32_t pressFlagUntil = 0, payPromptUntil = 0, paidUntil = 0, connectUntil = 0, identUntil = 0, nearSosUntil = 0;
uint16_t seq = 0;
uint8_t  batPct = 255;

// motor pattern: array of on/off ms, repeated `reps` times
struct Buzz { const uint16_t* pat; uint8_t len; uint8_t reps; uint8_t i; uint8_t rep; uint32_t next; bool on; bool active; } buzz = {};
const uint16_t PAT_SHORT[] = {120, 0};
const uint16_t PAT_DOUBLE[] = {100, 100, 100, 0};
const uint16_t PAT_SOS[]   = {150, 150, 150, 150, 150, 400, 500, 200, 500, 200, 500, 400};
const uint16_t PAT_LONG[]  = {600, 0};

// ------------------------------------------------------------------ helpers
uint32_t dim(uint32_t c, uint8_t b) {     // scale a 0xRRGGBB colour by b/255
  return ((((c >> 16) & 0xFF) * b / 255) << 16) | ((((c >> 8) & 0xFF) * b / 255) << 8) | (((c & 0xFF) * b / 255));
}
void fill(uint32_t c) { for (int i = 0; i < 12; i++) ring.setPixelColor(i, c); }

void startBuzz(const uint16_t* pat, uint8_t len, uint8_t reps) {
#if FULL_BAND
  buzz = { pat, len, reps, 0, 0, (uint32_t)millis(), false, true };
#endif
}
void serviceBuzz() {
#if FULL_BAND
  if (!buzz.active) return;
  uint32_t now = millis();
  if ((int32_t)(now - buzz.next) < 0) return;
  if (buzz.i >= buzz.len) {
    buzz.i = 0; buzz.rep++;
    if (buzz.rep >= buzz.reps) { buzz.active = false; ledcWrite(PIN_MOTOR, 0); return; }
  }
  bool on = (buzz.i % 2) == 0;
  ledcWrite(PIN_MOTOR, on ? MOTOR_DUTY : 0);
  buzz.next = now + buzz.pat[buzz.i];
  buzz.i++;
#endif
}

// ------------------------------------------------------------------ radio
void sendBeacon() {
  Pkt p = {};
  p.magic = BANDIT_MAGIC; p.type = T_BAND; p.id = BAND_ID;
  p.flags = (sos ? F_SOS : 0) | (fell ? F_FALL : 0) | (millis() < pressFlagUntil ? F_PRESS : 0)
          | (batPct != 255 && batPct < 15 ? F_LOWBAT : 0) | (FULL_BAND ? F_FULLBAND : 0);
  p.neigh = neighCount; p.zone = zone; p.bat = batPct; p.state = currentState(); p.seq = seq++;
  esp_now_send(BCAST_ADDR, (const uint8_t*)&p, sizeof(p));
}

void noteSeen(Seen* tbl, uint8_t& n, uint8_t cap, uint8_t id, int8_t rssi, uint8_t flags) {
  for (uint8_t i = 0; i < n; i++) if (tbl[i].id == id) { tbl[i].rssi = rssi; tbl[i].last = millis(); tbl[i].flags = flags; return; }
  if (n < cap) { tbl[n++] = { id, rssi, (uint32_t)millis(), flags }; }
}

void handleCmd(const Pkt& p) {
  if (p.target != 0 && p.target != BAND_ID) return;
  uint32_t now = millis();
  switch (p.cmd) {
    case CMD_STATE:   forcedState = (BandState)p.arg; forcedUntil = p.arg2 ? now + p.arg2 * 100UL : 0; break;
    case CMD_EXIT:    if (p.arg >= 1 && p.arg <= N_EXIT) exitColour = p.arg; break;
    case CMD_CLEAR:   sos = false; fell = false; forcedState = S_OFF; nearSosUntil = 0; break;
    case CMD_BUZZ:    if (p.arg == 2) startBuzz(PAT_DOUBLE, 4, 2); else if (p.arg == 3) startBuzz(PAT_LONG, 2, 1); else startBuzz(PAT_SHORT, 2, 1); break;
    case CMD_PAY:     payPromptUntil = now + 8000; startBuzz(PAT_DOUBLE, 4, 1); break;
    case CMD_PAID:    payPromptUntil = 0; paidUntil = now + 1500; startBuzz(PAT_SHORT, 2, 1); break;
    case CMD_THRESH:  yellowAt = p.arg; redAt = p.arg2; break;
    case CMD_RSSI:    neighRssiMin = -(int8_t)p.arg; circleRssiMin = -(int8_t)p.arg2; break;
    case CMD_OVERRIDE: overrideAuto = p.arg != 0; break;
  }
}

void onRecv(const esp_now_recv_info_t* info, const uint8_t* data, int len) {
  if (len < (int)sizeof(Pkt)) return;
  const Pkt* p = (const Pkt*)data;
  if (p->magic != BANDIT_MAGIC) return;
  int8_t rssi = info->rx_ctrl ? info->rx_ctrl->rssi : -100;
  if (p->type == T_BAND && p->id != BAND_ID) {
    noteSeen(bands, nBands, 32, p->id, rssi, p->flags);
    if ((p->flags & (F_SOS | F_FALL)) && rssi >= circleRssiMin) nearSosUntil = millis() + 1500;   // light circle
  } else if (p->type == T_STATION) {
    noteSeen(stations, nStations, 8, p->id, rssi, p->flags);
  } else if (p->type == T_CMD) {
    handleCmd(*p);
  }
}

void radioBegin() {
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  esp_wifi_set_ps(WIFI_PS_NONE);
  esp_wifi_set_channel(BANDIT_CHANNEL, WIFI_SECOND_CHAN_NONE);
  esp_wifi_set_max_tx_power(TX_POWER);
  if (esp_now_init() != ESP_OK) { Serial.println("esp_now_init failed"); ESP.restart(); }
  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, BCAST_ADDR, 6);
  peer.channel = 0; peer.encrypt = false; peer.ifidx = WIFI_IF_STA;
  esp_now_add_peer(&peer);
  esp_now_register_recv_cb(onRecv);
}

// ------------------------------------------------------------------ density + zone
void updateNeighbours() {
  uint32_t now = millis();
  uint8_t n = 0;
  for (uint8_t i = 0; i < nBands; i++)
    if (now - bands[i].last < NEIGH_WINDOW_MS && bands[i].rssi >= neighRssiMin) n++;
  neighSmooth = 0.7f * neighSmooth + 0.3f * n;        // called every 250 ms -> ~1 s time constant
  neighCount = (uint8_t)(neighSmooth + 0.5f);
  // hysteresis
  if (densityState == S_IDLE   && neighCount >= yellowAt) densityState = S_YELLOW;
  if (densityState == S_YELLOW && neighCount >= redAt)    densityState = S_GUIDE;
  if (densityState == S_GUIDE  && neighCount <  redAt - 1)    densityState = S_YELLOW;
  if (densityState == S_YELLOW && neighCount <  yellowAt - 1) densityState = S_IDLE;
  // zone = strongest fresh station
  int8_t best = -127; uint8_t bz = 0;
  for (uint8_t i = 0; i < nStations; i++)
    if (now - stations[i].last < ZONE_WINDOW_MS && stations[i].rssi > best) { best = stations[i].rssi; bz = stations[i].id; }
  zone = bz;
}

BandState currentState() {
  uint32_t now = millis();
  if (now < identUntil) return S_IDENT;
  if (sos || fell) return S_SOS;
  if (now < paidUntil) return S_PAID;
  if (now < payPromptUntil) return S_PAY;
  if (now < connectUntil) return S_CONNECT;
  if (now < nearSosUntil) return S_NEAR_SOS;
  if (forcedState != S_OFF && (forcedUntil == 0 || now < forcedUntil)) return forcedState;
  if (overrideAuto) return S_IDLE;
  return densityState;
}

// ------------------------------------------------------------------ button
void serviceButton() {
  static bool was = false; static uint32_t downAt = 0; static bool longFired = false;
  bool down = digitalRead(PIN_BTN) == LOW;
  uint32_t now = millis();
  if (down && !was) { downAt = now; longFired = false; }
  if (down && !longFired && now - downAt >= 3000) {          // 3 s hold: toggle SOS
    longFired = true;
    sos = !sos; if (!sos) fell = false;
    startBuzz(PAT_SOS, 12, 1);
  }
  if (!down && was && !longFired && now - downAt > 30) {     // short press: confirm
    pressFlagUntil = now + 1000;
    if (now < payPromptUntil) { /* gateway sees F_PRESS and will send CMD_PAID */ }
    startBuzz(PAT_SHORT, 2, 1);
  }
  was = down;
}

// ------------------------------------------------------------------ MPU-6050 (FULL_BAND): raw I2C, no library
#if FULL_BAND
const uint8_t MPU = 0x68;
bool mpuOk = false;
void mpuWrite(uint8_t reg, uint8_t val) { Wire.beginTransmission(MPU); Wire.write(reg); Wire.write(val); Wire.endTransmission(); }
bool mpuBegin() {
  Wire.begin(PIN_SDA, PIN_SCL, 400000);
  Wire.beginTransmission(MPU); if (Wire.endTransmission() != 0) return false;
  mpuWrite(0x6B, 0x00);        // wake
  mpuWrite(0x1C, 0x10);        // accel +/- 8 g (4096 LSB/g)
  mpuWrite(0x1A, 0x03);        // DLPF ~44 Hz
  return true;
}
float mpuAccelG() {            // |a| in g
  Wire.beginTransmission(MPU); Wire.write(0x3B); Wire.endTransmission(false);
  if (Wire.requestFrom((int)MPU, 6) != 6) return 1.0f;
  int16_t ax = (Wire.read() << 8) | Wire.read(); int16_t ay = (Wire.read() << 8) | Wire.read(); int16_t az = (Wire.read() << 8) | Wire.read();
  float x = ax / 4096.0f, y = ay / 4096.0f, z = az / 4096.0f;
  return sqrtf(x * x + y * y + z * z);
}
// Fall = impact (> 2.8 g) followed within 2 s by stillness (|a| within 0.2 g of 1 g for 1.5 s). Tune on a mat.
void serviceFall() {
  static uint32_t impactAt = 0, stillSince = 0; static uint32_t lastRead = 0;
  uint32_t now = millis(); if (now - lastRead < 20) return; lastRead = now;
  float a = mpuAccelG();
  if (a > 2.8f) { impactAt = now; stillSince = 0; }
  if (impactAt && now - impactAt < 3500) {
    bool still = fabsf(a - 1.0f) < 0.2f;
    if (still) { if (!stillSince) stillSince = now; else if (now - stillSince > 1500) { fell = true; impactAt = 0; startBuzz(PAT_SOS, 12, 1); } }
    else stillSince = 0;
  }
}
#endif

// ------------------------------------------------------------------ battery
void serviceBattery() {
#if HAS_VBAT_DIV
  static uint32_t last = 0; if (millis() - last < 5000) return; last = millis();
  uint32_t mv = 0; for (int i = 0; i < 16; i++) mv += analogReadMilliVolts(PIN_VBAT); mv = mv / 16 * 2;
  int pct = (int)((mv - 3300) * 100 / (4200 - 3300)); batPct = constrain(pct, 0, 100);
#endif
}

// ------------------------------------------------------------------ ring animation
void serviceRing() {
  static uint32_t last = 0; uint32_t now = millis(); if (now - last < 25) return; last = now;   // 40 fps
  BandState s = currentState();
  float t = (now % 2000) / 2000.0f;                     // 0..1 every 2 s
  uint8_t breathe = 40 + (uint8_t)(60 * (0.5f + 0.5f * sinf(t * 6.2832f)));
  int head = (now / 80) % 12;
  switch (s) {
    case S_IDLE:     fill(dim(0x00FF20, breathe)); break;
    case S_YELLOW:   fill(0xFFA000); break;
    case S_GUIDE: {  uint32_t ex = EXIT_COLOURS[exitColour];
                     for (int i = 0; i < 12; i++) { int d = (i - head + 12) % 12; ring.setPixelColor(i, d < 4 ? dim(ex, 255 - d * 60) : dim(0xFF0000, 50)); } break; }
    case S_SOS:      fill((now / 125) % 2 ? 0xFF0000 : 0x000000); break;
    case S_NEAR_SOS: fill(dim(0x2040FF, breathe + 80)); break;
    case S_PAY:      for (int i = 0; i < 12; i++) { int d = (i - head + 12) % 12; ring.setPixelColor(i, d < 3 ? 0xFFD000 : dim(0xFFD000, 25)); } break;
    case S_PAID:     fill(0x00FF00); break;
    case S_CONNECT:  for (int i = 0; i < 12; i++) ring.setPixelColor(i, random(100) < 30 ? 0xFF2080 : 0x000000); break;
    case S_IDENT:    fill((now / 200) % 2 ? 0xFFFFFF : 0x000000); break;
    default:         fill(0); break;
  }
  ring.show();
}

// ------------------------------------------------------------------ serial (bench debugging over USB)
void serviceSerial() {
  if (!Serial.available()) return;
  String line = Serial.readStringUntil('\n'); line.trim();
  if (line == "sos") { sos = !sos; }
  else if (line == "clear") { sos = false; fell = false; forcedState = S_OFF; }
  else if (line == "pay") { payPromptUntil = millis() + 8000; }
  else if (line == "buzz") { startBuzz(PAT_DOUBLE, 4, 2); }
  else if (line.startsWith("state ")) { forcedState = (BandState)line.substring(6).toInt(); forcedUntil = 0; }
  else if (line.startsWith("exit ")) { exitColour = line.substring(5).toInt(); }
  else if (line == "auto") { forcedState = S_OFF; }
}

void printStatus() {
  static uint32_t last = 0; if (millis() - last < 1000) return; last = millis();
  Serial.printf("{\"id\":%u,\"state\":%u,\"neigh\":%u,\"smooth\":%.2f,\"zone\":%u,\"sos\":%d,\"fall\":%d,\"bat\":%u,\"heard\":[",
                BAND_ID, currentState(), neighCount, neighSmooth, zone, sos, fell, batPct);
  bool first = true;
  for (uint8_t i = 0; i < nBands; i++) if (millis() - bands[i].last < NEIGH_WINDOW_MS) {
    Serial.printf("%s[%u,%d]", first ? "" : ",", bands[i].id, bands[i].rssi); first = false; }
  Serial.println("]}");
}

// ------------------------------------------------------------------ arduino
void setup() {
  Serial.begin(115200);
  pinMode(PIN_BTN, INPUT_PULLUP);
  ring.begin(); ring.setBrightness(RING_BRIGHT); fill(0); ring.show();
#if FULL_BAND
  ledcAttach(PIN_MOTOR, 20000, 8); ledcWrite(PIN_MOTOR, 0);
  mpuOk = mpuBegin();
#endif
#if HAS_VBAT_DIV
  analogReadResolution(12);
#endif
  radioBegin();
  Serial.printf("BandIt band %u up, full=%d, mac=%s\n", BAND_ID, FULL_BAND, WiFi.macAddress().c_str());
  identUntil = millis() + 1500;   // white blink on boot so you can see it reset
}

void loop() {
  static uint32_t nextBeacon = 0, nextNeigh = 0;
  uint32_t now = millis();
  if ((int32_t)(now - nextBeacon) >= 0) { sendBeacon(); nextBeacon = now + BAND_BEACON_MS + random(0, 30); }
  if ((int32_t)(now - nextNeigh) >= 0)  { updateNeighbours(); nextNeigh = now + 250; }
  serviceButton();
#if FULL_BAND
  if (mpuOk) serviceFall();
#endif
  serviceBuzz();
  serviceBattery();
  serviceRing();
  serviceSerial();
  printStatus();
}
