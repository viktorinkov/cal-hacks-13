// BandIt gateway: ESP-NOW <-> USB serial bridge. Usage and line formats are at the top of bandit_gateway.ino.
#include <Arduino.h>
#include <bandit_common.h>
#include <string.h>

namespace {

constexpr uint16_t RX_DEPTH = 128;
constexpr uint8_t  OUT_SLOTS = 16;
constexpr uint32_t DUP_WARN_MS = 10000;
constexpr uint32_t OWNER_STALE_MS = 5000;

struct Outgoing {
  Pkt      p;
  uint8_t  left;
  uint32_t next;
};

struct Owner {
  uint8_t  mac[6];
  uint32_t lastSeen;
  uint32_t warnedAt;
  bool     set;
};

struct CmdDef {
  const char* name;
  uint8_t     cmd;
  uint8_t     minArgs;
  uint8_t     maxArgs;
  uint8_t     def1;
};

const CmdDef CMDS[] = {
    {"state", CMD_STATE, 1, 2, 0},   {"exit", CMD_EXIT, 1, 1, 0},         {"clear", CMD_CLEAR, 0, 0, 0},
    {"buzz", CMD_BUZZ, 0, 1, H_SHORT}, {"pay", CMD_PAY, 0, 0, 0},         {"paid", CMD_PAID, 0, 0, 0},
    {"thresh", CMD_THRESH, 2, 2, 0}, {"rssi", CMD_RSSI, 2, 2, 0},         {"override", CMD_OVERRIDE, 1, 1, 0},
    {"find", CMD_FIND, 1, 2, 0},     {"sleep", CMD_SLEEP, 0, 1, 0},       {"haptic", CMD_HAPTIC, 1, 1, 0},
    {"lowvis", CMD_LOWVIS, 1, 1, 0},
};

Outgoing   outq[OUT_SLOTS];
Owner      owners[256];
uint16_t   cmdSeq = 0;
LineReader lines;
uint32_t   droppedReported = 0, lastDropReport = 0;

void checkOwner(uint8_t id, const uint8_t* mac, uint32_t now) {
  Owner& o = owners[id];
  if (!o.set || now - o.lastSeen > OWNER_STALE_MS) {
    memcpy(o.mac, mac, 6);
    o.set = true;
    o.lastSeen = now;
    return;
  }
  if (memcmp(o.mac, mac, 6) == 0) {
    o.lastSeen = now;
    return;
  }
  if (now - o.warnedAt < DUP_WARN_MS && o.warnedAt) return;
  o.warnedAt = now;
  char a[18], b[18];
  macToStr(o.mac, a);
  macToStr(mac, b);
  emitf("{\"err\":\"dup id\",\"id\":%u,\"mac\":\"%s\",\"other\":\"%s\"}", id, a, b);
}

void printFrame(const RxFrame& f) {
  const uint8_t type = f.data[1];
  if (type == T_HEARD) {
    const uint8_t n = f.data[3];
    if (n > HEARD_MAX || f.len < heardLen(n)) return;
    LineBuf l;
    l.add("{\"t\":%lu,\"type\":4,\"id\":%u,\"rssi\":%d,\"heard\":[", (unsigned long)f.t, f.data[2], f.rssi);
    for (uint8_t i = 0; i < n; i++)
      l.add("%s[%u,%d]", i ? "," : "", f.data[4 + 2 * i], (int8_t)f.data[5 + 2 * i]);
    l.add("]}");
    l.emit();
    return;
  }
  if (type < T_BAND || type > T_CMD || f.len < sizeof(Pkt)) return;
  Pkt p;
  memcpy(&p, f.data, sizeof(p));
  if (type != T_CMD) checkOwner(p.id, f.mac, f.t);
  if (type == T_BAND)
    emitf("{\"t\":%lu,\"type\":1,\"id\":%u,\"rssi\":%d,\"flags\":%u,\"neigh\":%u,\"zone\":%u,\"bat\":%u,\"state\":%u,"
          "\"seq\":%u,\"find\":%u}",
          (unsigned long)f.t, p.id, f.rssi, p.flags, p.neigh, p.zone, p.bat, p.state, p.seq, p.target);
  else
    emitf("{\"t\":%lu,\"type\":%u,\"id\":%u,\"rssi\":%d,\"flags\":%u,\"neigh\":%u,\"zone\":%u,\"bat\":%u,\"state\":%u,"
          "\"seq\":%u}",
          (unsigned long)f.t, type, p.id, f.rssi, p.flags, p.neigh, p.zone, p.bat, p.state, p.seq);
}

bool queueCmd(uint8_t target, uint8_t cmd, uint8_t arg, uint8_t arg2) {
  for (auto& o : outq) {
    if (o.left) continue;
    o.p = Pkt{};
    o.p.magic = BANDIT_MAGIC;
    o.p.type = T_CMD;
    o.p.id = ID_GATEWAY;
    o.p.seq = cmdSeq++;
    o.p.target = target;
    o.p.cmd = cmd;
    o.p.arg = arg;
    o.p.arg2 = arg2;
    o.left = CMD_REPEATS;
    o.next = millis();
    return true;
  }
  return false;
}

void serviceOut(uint32_t now) {
  for (auto& o : outq) {
    if (!o.left || (int32_t)(now - o.next) < 0) continue;
    if (!radioSend(&o.p, sizeof(o.p)))
      emitf("{\"err\":\"send failed\",\"target\":%u,\"cmd\":%u}", o.p.target, o.p.cmd);
    o.left--;
    o.next = now + CMD_REPEAT_MS;
  }
}

void printIdentity(const char* key, const char* value) {
  char mac[18];
  macToStr(selfMac(), mac);
  emitf("{\"%s\":\"%s\",\"mac\":\"%s\",\"channel\":%u,\"fw\":\"%s\"}", key, value, mac, BANDIT_CHANNEL, BANDIT_FW);
}

void handleLine(char* line) {
  char* w[8];
  const int n = splitWords(line, w, 8);
  if (n == 0) return;
  if (n == 1 && strcmp(w[0], "info") == 0) {
    printIdentity("info", "gateway");
    return;
  }
  long target = 0;
  if (n < 3 || strcmp(w[0], "cmd") != 0 || !parseLong(w[1], target) || target < 0 || target > 255) {
    emitf("{\"err\":\"usage: cmd <target> <name> [arg] [arg2]\"}");
    return;
  }
  const CmdDef* d = nullptr;
  for (const auto& c : CMDS)
    if (strcmp(w[2], c.name) == 0) d = &c;
  if (!d) {
    emitf("{\"err\":\"unknown cmd\"}");
    return;
  }
  const int nargs = n - 3;
  long a[2] = {d->def1, 0};
  bool ok = nargs >= d->minArgs && nargs <= d->maxArgs;
  for (int i = 0; ok && i < nargs; i++) {
    ok = parseLong(w[3 + i], a[i]);
    if (d->cmd == CMD_RSSI && a[i] < 0) a[i] = -a[i];
    ok = ok && a[i] >= 0 && a[i] <= 255;
  }
  if (!ok) {
    emitf("{\"err\":\"bad args\"}");
    return;
  }
  if (!queueCmd((uint8_t)target, d->cmd, (uint8_t)a[0], (uint8_t)a[1])) {
    emitf("{\"err\":\"busy\"}");
    return;
  }
  emitf("{\"ack\":\"cmd\",\"target\":%ld,\"cmd\":%u,\"arg\":%ld,\"arg2\":%ld}", target, d->cmd, a[0], a[1]);
}

}  // namespace

void setup() {
  serialBegin(8192, 1024);
  if (!radioBegin(MAX_TX_POWER, RX_DEPTH)) {
    emitf("{\"err\":\"esp_now_init\"}");
    delay(1000);
    ESP.restart();
  }
  printIdentity("gateway", "up");
}

void loop() {
  const uint32_t now = millis();
  RxFrame f;
  for (int i = 0; i < 32 && radioPoll(f); i++) printFrame(f);
  serviceOut(now);
  if (char* l = lines.poll(Serial)) handleLine(l);
  const uint32_t d = radioDropped();
  if (d != droppedReported && now - lastDropReport >= 1000) {
    emitf("{\"err\":\"rx queue full\",\"dropped\":%lu}", (unsigned long)(d - droppedReported));
    droppedReported = d;
    lastDropReport = now;
  }
  vTaskDelay(1);  // one tick so the idle task can halt the core; everything above is millis() driven
}
