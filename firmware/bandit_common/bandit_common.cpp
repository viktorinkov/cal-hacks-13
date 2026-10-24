// Shared radio, serial and colour helpers for the BandIt firmware. See bandit_common.h for the protocol.
#include "bandit_common.h"
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <stdarg.h>
#include <stdlib.h>
#include <string.h>

const uint32_t EXIT_COLOURS[N_EXIT + 1] = {0, 0x0000FF, 0xFF00FF, 0x00FFFF, 0xFFFFFF, 0xFF6000, 0x8000FF};
const uint32_t PAIR_COLOURS[N_PAIR]     = {0xFF1A8C, 0x7FFF00, 0xFFC800, 0x00FFA0, 0xB000FF, 0xFF4020};

uint32_t dimColour(uint32_t c, uint8_t b) {
  const uint32_t r = ((c >> 16) & 0xFF) * b / 255, g = ((c >> 8) & 0xFF) * b / 255, bl = (c & 0xFF) * b / 255;
  return (r << 16) | (g << 8) | bl;
}

// ------------------------------------------------------------------ radio
static const uint8_t BCAST[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
static QueueHandle_t rxQueue = nullptr;
static volatile uint32_t rxDropped = 0;
static uint8_t ownMac[6];

static void onRecv(const esp_now_recv_info_t* info, const uint8_t* data, int len) {
  if (len < 4 || len > (int)sizeof(RxFrame::data) || data[0] != BANDIT_MAGIC) return;
  RxFrame f;
  f.t = millis();
  f.rssi = info->rx_ctrl ? (int8_t)info->rx_ctrl->rssi : -100;
  f.len = (uint8_t)len;
  memcpy(f.mac, info->src_addr, 6);
  memcpy(f.data, data, len);
  if (xQueueSend(rxQueue, &f, 0) != pdTRUE) rxDropped = rxDropped + 1;
}

bool radioBegin(uint8_t txPower, uint16_t queueDepth) {
  if (!rxQueue) rxQueue = xQueueCreate(queueDepth, sizeof(RxFrame));
  if (!rxQueue) return false;
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  esp_wifi_set_ps(WIFI_PS_NONE);
  esp_wifi_set_channel(BANDIT_CHANNEL, WIFI_SECOND_CHAN_NONE);
  esp_wifi_set_max_tx_power(txPower);
  esp_wifi_get_mac(WIFI_IF_STA, ownMac);
  if (esp_now_init() != ESP_OK) return false;
  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, BCAST, 6);
  peer.channel = 0;
  peer.ifidx = WIFI_IF_STA;
  peer.encrypt = false;
  if (esp_now_add_peer(&peer) != ESP_OK) return false;
  return esp_now_register_recv_cb(onRecv) == ESP_OK;
}

bool radioPoll(RxFrame& out) { return rxQueue && xQueueReceive(rxQueue, &out, 0) == pdTRUE; }

bool radioSend(const void* data, size_t len) { return esp_now_send(BCAST, (const uint8_t*)data, len) == ESP_OK; }

uint32_t radioDropped() { return rxDropped; }

const uint8_t* selfMac() { return ownMac; }

void macToStr(const uint8_t* m, char out[18]) {
  snprintf(out, 18, "%02X:%02X:%02X:%02X:%02X:%02X", m[0], m[1], m[2], m[3], m[4], m[5]);
}

// ------------------------------------------------------------------ serial
void serialBegin(size_t txBuf, size_t rxBuf) {
#if ARDUINO_USB_MODE && ARDUINO_USB_CDC_ON_BOOT
  Serial.setTxBufferSize(txBuf);
  Serial.setRxBufferSize(rxBuf);
  Serial.begin(115200);
  Serial.setTxTimeoutMs(0);
#else
  (void)txBuf;
  (void)rxBuf;
  Serial.begin(115200);
#endif
}

bool emitLine(const char* s, size_t n) {
  if (Serial.availableForWrite() < (int)n) return false;
  return Serial.write((const uint8_t*)s, n) == n;
}

bool emitf(const char* fmt, ...) {
  char buf[512];
  va_list ap;
  va_start(ap, fmt);
  int n = vsnprintf(buf, sizeof(buf) - 1, fmt, ap);
  va_end(ap);
  if (n < 0) return false;
  if (n > (int)sizeof(buf) - 2) n = sizeof(buf) - 2;
  buf[n++] = '\n';
  return emitLine(buf, n);
}

void LineBuf::add(const char* fmt, ...) {
  if (n_ >= sizeof(b_) - 2) return;
  va_list ap;
  va_start(ap, fmt);
  int k = vsnprintf(b_ + n_, sizeof(b_) - 1 - n_, fmt, ap);
  va_end(ap);
  if (k > 0) n_ = n_ + (size_t)k < sizeof(b_) - 1 ? n_ + k : sizeof(b_) - 2;
}

bool LineBuf::emit() {
  b_[n_++] = '\n';
  bool ok = emitLine(b_, n_);
  n_ = 0;
  return ok;
}

char* LineReader::poll(Stream& s) {
  while (s.available() > 0) {
    int c = s.read();
    if (c < 0) break;
    if (c == '\n' || c == '\r') {
      if (skip_) { skip_ = false; n_ = 0; continue; }
      if (n_ == 0) continue;
      buf_[n_] = 0;
      n_ = 0;
      return buf_;
    }
    if (n_ < sizeof(buf_) - 1) buf_[n_++] = (char)c;
    else skip_ = true;
  }
  return nullptr;
}

int splitWords(char* s, char** out, int max) {
  int n = 0;
  char* save = nullptr;
  for (char* t = strtok_r(s, " \t", &save); t && n < max; t = strtok_r(nullptr, " \t", &save)) out[n++] = t;
  return n;
}

bool parseLong(const char* s, long& v) {
  char* e = nullptr;
  v = strtol(s, &e, 10);
  return e != s && *e == 0;
}

bool parseFloat(const char* s, float& v) {
  char* e = nullptr;
  v = strtof(s, &e);
  return e != s && *e == 0;
}
