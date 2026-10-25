/*
  BandIt station marker, v0.1 skeleton. ESP32-C3 SuperMini + a spare 12-LED ring, USB powered.
  Board: "ESP32C3 Dev Module" (Tools: USB CDC On Boot = Enabled, Flash Mode = DIO)   Core: esp32 3.x   Library: Adafruit NeoPixel

  Each station beacons its id at full power so bands can work out which zone they are in (strongest station wins),
  and glows its exit colour so "follow the blue light" means something in the room.
  Wiring (SuperMini): ring VCC <- 5V pin THROUGH a 1N4001 (drops to ~4.3 V so 3.3 V data is in spec), ring GND <- GND,
  ring DIN <- GPIO10 through 330 R. GPIO8 is the onboard blue LED and GPIO9 is BOOT: leave both alone.
*/
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <Adafruit_NeoPixel.h>
#include "bandit_common.h"

#define STATION_ID   101      // 101..105. Exit colour index = STATION_ID - 100 unless the gateway says otherwise.
#define PIN_RING     10

const uint32_t EXIT_COLOURS[] = { 0, 0x0000FF, 0xFF00FF, 0x00FFFF, 0xFFFFFF, 0xFF6000, 0x8000FF };
Adafruit_NeoPixel ring(12, PIN_RING, NEO_GRB + NEO_KHZ800);
uint8_t colourIdx = STATION_ID - 100;
uint8_t mode = 0;          // 0 breathe (open exit), 1 chase (come this way), 9 off (closed exit)

void onRecv(const esp_now_recv_info_t* info, const uint8_t* data, int len) {
  if (len < (int)sizeof(Pkt)) return;
  const Pkt* p = (const Pkt*)data;
  if (p->magic != BANDIT_MAGIC || p->type != T_CMD) return;
  if (p->target != 0 && p->target != STATION_ID) return;
  if (p->cmd == CMD_EXIT && p->arg >= 1 && p->arg <= 6) colourIdx = p->arg;
  if (p->cmd == CMD_STATE) mode = p->arg;         // reuse: 0 breathe, 1 chase, 9 off
}

uint32_t dim(uint32_t c, uint8_t b) {
  return ((((c >> 16) & 0xFF) * b / 255) << 16) | ((((c >> 8) & 0xFF) * b / 255) << 8) | (((c & 0xFF) * b / 255));
}

void setup() {
  Serial.begin(115200);
  ring.begin(); ring.setBrightness(120); ring.show();
  WiFi.mode(WIFI_STA); WiFi.disconnect();
  esp_wifi_set_ps(WIFI_PS_NONE);
  esp_wifi_set_channel(BANDIT_CHANNEL, WIFI_SECOND_CHAN_NONE);
  esp_wifi_set_max_tx_power(84);
  if (esp_now_init() != ESP_OK) ESP.restart();
  esp_now_peer_info_t peer = {}; memcpy(peer.peer_addr, BCAST_ADDR, 6); peer.channel = 0; peer.encrypt = false; peer.ifidx = WIFI_IF_STA;
  esp_now_add_peer(&peer);
  esp_now_register_recv_cb(onRecv);
  Serial.printf("station %u up, mac=%s\n", STATION_ID, WiFi.macAddress().c_str());
}

void loop() {
  static uint32_t nextBeacon = 0, nextFrame = 0; static uint16_t seq = 0;
  uint32_t now = millis();
  if ((int32_t)(now - nextBeacon) >= 0) {
    Pkt p = {}; p.magic = BANDIT_MAGIC; p.type = T_STATION; p.id = STATION_ID; p.state = colourIdx; p.seq = seq++;
    esp_now_send(BCAST_ADDR, (const uint8_t*)&p, sizeof(p));
    nextBeacon = now + STATION_BEACON_MS;
  }
  if ((int32_t)(now - nextFrame) >= 0) {
    nextFrame = now + 30;
    uint32_t c = EXIT_COLOURS[colourIdx];
    if (mode == 9) { for (int i = 0; i < 12; i++) ring.setPixelColor(i, 0); }
    else if (mode == 1) { int head = (now / 70) % 12; for (int i = 0; i < 12; i++) { int d = (i - head + 12) % 12; ring.setPixelColor(i, d < 4 ? dim(c, 255 - d * 60) : dim(c, 15)); } }
    else { float t = (now % 3000) / 3000.0f; uint8_t b = 90 + (uint8_t)(160 * (0.5f + 0.5f * sinf(t * 6.2832f))); for (int i = 0; i < 12; i++) ring.setPixelColor(i, dim(c, b)); }
    ring.show();
  }
}
