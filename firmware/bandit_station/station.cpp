// BandIt station marker. Usage at the top of bandit_station.ino.
#include <Arduino.h>
#include <Adafruit_NeoPixel.h>
#include <Preferences.h>
#include <bandit_common.h>
#include <math.h>
#include <string.h>

namespace {

constexpr uint8_t PIN_RING = 10;
constexpr uint8_t LEDS = 12;

Adafruit_NeoPixel ring(LEDS, PIN_RING, NEO_GRB + NEO_KHZ800);
LineReader lines;

uint8_t  stationId = 0, colourIdx = 1, mode = M_BREATHE, bright = 120;
bool     dirty = false;
uint16_t seq = 0;
uint8_t  lastCmdFrom = 0;
uint16_t lastCmdSeq = 0;
uint32_t lastCmdAt = 0;

uint8_t defaultColour(uint8_t id) {
  return (id >= ID_STATION_MIN && id <= ID_STATION_MIN + N_EXIT - 1) ? id - 100 : 1;
}

void load() {
  Preferences p;
  if (p.begin("station", true)) {
    stationId = p.getUChar("id", 0);
    colourIdx = p.getUChar("exit", defaultColour(stationId));
    bright = p.getUChar("bright", 120);
    p.end();
  }
  if (colourIdx < 1 || colourIdx > N_EXIT) colourIdx = defaultColour(stationId);
}

void save() {
  Preferences p;
  if (!p.begin("station", false)) return;
  p.putUChar("id", stationId);
  p.putUChar("exit", colourIdx);
  p.putUChar("bright", bright);
  p.end();
  dirty = false;
}

void printInfo() {
  char mac[18];
  macToStr(selfMac(), mac);
  emitf("{\"info\":\"station\",\"id\":%u,\"mac\":\"%s\",\"exit\":%u,\"mode\":%u,\"bright\":%u,\"saved\":%d,\"fw\":\"%s\"}",
        stationId, mac, colourIdx, mode, bright, !dirty, BANDIT_FW);
}

bool validMode(long m) { return m == M_BREATHE || m == M_CHASE || m == M_STROBE || m == M_OFF; }

void handleCmd(const Pkt& p, uint32_t now) {
  if (!stationId || (p.target != stationId && p.target != ID_ALL_STATIONS)) return;
  if (p.id == lastCmdFrom && p.seq == lastCmdSeq && now - lastCmdAt < 1000) return;
  lastCmdFrom = p.id;
  lastCmdSeq = p.seq;
  lastCmdAt = now;
  switch (p.cmd) {
    case CMD_EXIT:
      if (p.arg >= 1 && p.arg <= N_EXIT && p.arg != colourIdx) {
        colourIdx = p.arg;
        Preferences prefs;
        if (prefs.begin("station", false)) { prefs.putUChar("exit", colourIdx); prefs.end(); }
      }
      break;
    case CMD_STATE:
      if (validMode(p.arg)) mode = p.arg;
      break;
    case CMD_CLEAR:
      mode = M_BREATHE;
      break;
  }
}

void handleSerial(char* line) {
  char* w[4];
  const int n = splitWords(line, w, 4);
  if (!n) return;
  long v = 0;
  const bool hasNum = n >= 2 && parseLong(w[1], v);
  if (!strcmp(w[0], "info")) printInfo();
  else if (!strcmp(w[0], "save")) { save(); printInfo(); }
  else if (!strcmp(w[0], "reset")) { emitf("{\"ok\":\"reset\"}"); delay(50); ESP.restart(); }
  else if (!strcmp(w[0], "id") && hasNum && v >= ID_STATION_MIN && v <= ID_STATION_MAX) {
    stationId = v; colourIdx = defaultColour(stationId); dirty = true; printInfo();
  }
  else if (!strcmp(w[0], "exit") && hasNum && v >= 1 && v <= N_EXIT) { colourIdx = v; dirty = true; printInfo(); }
  else if (!strcmp(w[0], "mode") && hasNum && validMode(v)) { mode = v; printInfo(); }
  else if (!strcmp(w[0], "bright") && hasNum && v >= 10 && v <= 255) {
    bright = v; ring.setBrightness(bright); dirty = true; printInfo();
  }
  else emitf("{\"err\":\"bad command\",\"cmd\":\"%s\"}", w[0]);
}

void render(uint32_t now) {
  static uint32_t nextFrame = 0;
  if ((int32_t)(now - nextFrame) < 0) return;
  nextFrame = now + 30;
  const uint32_t c = EXIT_COLOURS[colourIdx];
  for (uint8_t i = 0; i < LEDS; i++) {
    uint32_t px = 0;
    if (!stationId) {
      px = (now / 500) % 2 ? dimColour(0xFFFFFF, 60) : 0;
    } else if (mode == M_CHASE) {
      const int d = (i - (int)((now / 70) % LEDS) + LEDS) % LEDS;
      px = d < 4 ? dimColour(c, 255 - d * 60) : dimColour(c, 15);
    } else if (mode == M_STROBE) {
      px = (now / 100) % 2 ? c : 0;
    } else if (mode == M_BREATHE) {
      const float t = (now % 3000) / 3000.0f;
      px = dimColour(c, 90 + (uint8_t)(160 * (0.5f + 0.5f * sinf(t * 6.2831853f))));
    }
    ring.setPixelColor(i, px);
  }
  ring.show();
}

}  // namespace

void setup() {
  serialBegin(1024, 256);
  load();
  ring.begin();
  ring.setBrightness(bright);
  ring.clear();
  ring.show();
  if (!radioBegin(MAX_TX_POWER, 8)) {
    emitf("{\"err\":\"esp_now_init\"}");
    delay(1000);
    ESP.restart();
  }
  char mac[18];
  macToStr(selfMac(), mac);
  emitf("{\"boot\":\"station\",\"id\":%u,\"mac\":\"%s\",\"exit\":%u,\"fw\":\"%s\"}", stationId, mac, colourIdx, BANDIT_FW);
}

void loop() {
  static uint32_t nextBeacon = 0;
  const uint32_t now = millis();
  RxFrame f;
  while (radioPoll(f)) {
    if (f.data[1] != T_CMD || f.len < sizeof(Pkt)) continue;
    Pkt p;
    memcpy(&p, f.data, sizeof(p));
    handleCmd(p, f.t);
  }
  if (stationId && (int32_t)(now - nextBeacon) >= 0) {
    Pkt p = {};
    p.magic = BANDIT_MAGIC;
    p.type = T_STATION;
    p.id = stationId;
    p.state = colourIdx;
    p.seq = seq++;
    radioSend(&p, sizeof(p));
    nextBeacon = now + STATION_BEACON_MS;
  }
  render(now);
  if (char* l = lines.poll(Serial)) handleSerial(l);
  vTaskDelay(1);
}
