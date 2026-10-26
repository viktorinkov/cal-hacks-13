/*
  BandIt gateway, v0.1 skeleton. A XIAO ESP32C3 on a USB cable to the laptop.
  Board: Seeed XIAO ESP32C3   Core: esp32 3.x   No extra libraries.

  Radio -> laptop: every packet heard becomes one JSON line on Serial (115200):
    {"t":12345,"type":1,"id":3,"rssi":-61,"flags":1,"neigh":4,"zone":101,"bat":87,"state":2,"seq":882}
  Laptop -> radio: one command per line, broadcast 3 times 40 ms apart:
    cmd <target> <name> [arg] [arg2]
      target: band id 1..9, or 0 for everyone
      name:   state <0..9> [tenths of s]  | exit <1..6> | clear | buzz [1..3] | pay | paid
              thresh <yellow> <red>      | rssi <neighAbs> <circleAbs>  (e.g. "rssi 62 58")
              override <0|1>
    examples:  cmd 0 exit 2      cmd 3 pay      cmd 3 paid      cmd 0 clear      cmd 0 thresh 3 5
  The dashboard side (SpacetimeDB / web) reads the JSON lines and writes commands. See docs/06_GATEWAY_PROTOCOL.md.
*/
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include "bandit_common.h"

#define GATEWAY_ID 200

void onRecv(const esp_now_recv_info_t* info, const uint8_t* data, int len) {
  if (len < (int)sizeof(Pkt)) return;
  const Pkt* p = (const Pkt*)data;
  if (p->magic != BANDIT_MAGIC) return;
  int rssi = info->rx_ctrl ? info->rx_ctrl->rssi : -100;
  Serial.printf("{\"t\":%lu,\"type\":%u,\"id\":%u,\"rssi\":%d,\"flags\":%u,\"neigh\":%u,\"zone\":%u,\"bat\":%u,\"state\":%u,\"seq\":%u}\n",
                (unsigned long)millis(), p->type, p->id, rssi, p->flags, p->neigh, p->zone, p->bat, p->state, p->seq);
}

void sendCmd(uint8_t target, uint8_t cmd, uint8_t arg, uint8_t arg2) {
  Pkt p = {}; p.magic = BANDIT_MAGIC; p.type = T_CMD; p.id = GATEWAY_ID; p.target = target; p.cmd = cmd; p.arg = arg; p.arg2 = arg2;
  static uint16_t seq = 0; p.seq = seq++;
  for (int i = 0; i < 3; i++) { esp_now_send(BCAST_ADDR, (const uint8_t*)&p, sizeof(p)); delay(40); }
  Serial.printf("{\"ack\":\"cmd\",\"target\":%u,\"cmd\":%u,\"arg\":%u,\"arg2\":%u}\n", target, cmd, arg, arg2);
}

void handleLine(String line) {
  line.trim(); if (!line.startsWith("cmd")) return;
  char name[16] = {0}; int target = 0, a = 0, b = 0;
  int n = sscanf(line.c_str(), "cmd %d %15s %d %d", &target, name, &a, &b);
  if (n < 2) { Serial.println("{\"err\":\"usage: cmd <target> <name> [arg] [arg2]\"}"); return; }
  String s(name);
  if      (s == "state")    sendCmd(target, CMD_STATE, a, b);
  else if (s == "exit")     sendCmd(target, CMD_EXIT, a, 0);
  else if (s == "clear")    sendCmd(target, CMD_CLEAR, 0, 0);
  else if (s == "buzz")     sendCmd(target, CMD_BUZZ, a ? a : 1, 0);
  else if (s == "pay")      sendCmd(target, CMD_PAY, 0, 0);
  else if (s == "paid")     sendCmd(target, CMD_PAID, 0, 0);
  else if (s == "thresh")   sendCmd(target, CMD_THRESH, a, b);
  else if (s == "rssi")     sendCmd(target, CMD_RSSI, a, b);
  else if (s == "override") sendCmd(target, CMD_OVERRIDE, a, 0);
  else Serial.println("{\"err\":\"unknown cmd\"}");
}

void setup() {
  Serial.begin(115200);
  WiFi.mode(WIFI_STA); WiFi.disconnect();
  esp_wifi_set_ps(WIFI_PS_NONE);
  esp_wifi_set_channel(BANDIT_CHANNEL, WIFI_SECOND_CHAN_NONE);
  esp_wifi_set_max_tx_power(84);                       // full power: the gateway must reach every band
  if (esp_now_init() != ESP_OK) { Serial.println("{\"err\":\"esp_now_init\"}"); ESP.restart(); }
  esp_now_peer_info_t peer = {}; memcpy(peer.peer_addr, BCAST_ADDR, 6); peer.channel = 0; peer.encrypt = false; peer.ifidx = WIFI_IF_STA;
  esp_now_add_peer(&peer);
  esp_now_register_recv_cb(onRecv);
  Serial.printf("{\"gateway\":\"up\",\"mac\":\"%s\",\"channel\":%d}\n", WiFi.macAddress().c_str(), BANDIT_CHANNEL);
}

void loop() {
  static String buf;
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n') { handleLine(buf); buf = ""; } else if (c != '\r') buf += c;
  }
}
