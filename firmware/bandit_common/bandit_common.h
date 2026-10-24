#pragma once
#include <Arduino.h>

#if __has_include("bandit_version.h")
#include "bandit_version.h"
#endif
#ifndef BANDIT_FW
#define BANDIT_FW __DATE__ " " __TIME__
#endif

constexpr uint8_t  BANDIT_MAGIC      = 0xB1;
constexpr uint8_t  BANDIT_CHANNEL    = 1;
constexpr uint32_t BAND_BEACON_MS    = 100;
constexpr uint32_t BAND_JITTER_MS    = 30;
constexpr uint32_t HEARD_MS          = 1000;
constexpr uint32_t STATION_BEACON_MS = 200;
constexpr uint32_t NEIGH_WINDOW_MS   = 2000;
constexpr int8_t   NEIGH_RSSI_MIN    = -62;
constexpr int8_t   CIRCLE_RSSI_MIN   = -58;
constexpr uint32_t ZONE_WINDOW_MS    = 3000;
constexpr uint8_t  CMD_REPEATS       = 3;
constexpr uint32_t CMD_REPEAT_MS     = 40;
constexpr uint8_t  BAND_TX_POWER     = 32;
constexpr uint8_t  MAX_TX_POWER      = 84;

constexpr uint8_t ID_NONE         = 0;
constexpr uint8_t ID_ALL_BANDS    = 0;
constexpr uint8_t ID_BAND_MAX     = 99;
constexpr uint8_t ID_ALL_STATIONS = 100;
constexpr uint8_t ID_STATION_MIN  = 101;
constexpr uint8_t ID_STATION_MAX  = 105;
constexpr uint8_t ID_GATEWAY      = 200;

enum PktType : uint8_t { T_BAND = 1, T_STATION = 2, T_CMD = 3, T_HEARD = 4 };

enum : uint8_t {
  F_SOS = 1 << 0, F_FALL = 1 << 1, F_PRESS = 1 << 2, F_LOWBAT = 1 << 3, F_MPU = 1 << 4, F_MOTOR = 1 << 5
};

enum BandState : uint8_t {
  S_IDLE = 0, S_YELLOW = 1, S_GUIDE = 2, S_SOS = 3, S_NEAR_SOS = 4, S_PAY = 5, S_PAID = 6,
  S_CONNECT = 7, S_IDENT = 8, S_OFF = 9, S_FIND = 10, S_FOUND_ME = 11, S_COUNT = 12
};

enum StationMode : uint8_t { M_BREATHE = 0, M_CHASE = 1, M_STROBE = 2, M_OFF = 9 };

enum Cmd : uint8_t {
  CMD_STATE = 1, CMD_EXIT = 2, CMD_CLEAR = 3, CMD_BUZZ = 4, CMD_PAY = 5, CMD_PAID = 6, CMD_THRESH = 7,
  CMD_RSSI = 8, CMD_OVERRIDE = 9, CMD_FIND = 10, CMD_SLEEP = 11, CMD_HAPTIC = 12, CMD_LOWVIS = 13
};

enum Haptic : uint8_t {
  H_STOP = 0, H_SHORT = 1, H_DOUBLE = 2, H_LONG = 3, H_SOS = 4, H_RAISE = 5, H_GUIDE = 6, H_PUBLIC_MAX = 6
};

struct __attribute__((packed)) Pkt {
  uint8_t  magic;
  uint8_t  type;
  uint8_t  id;
  uint8_t  flags;
  uint8_t  neigh;
  uint8_t  zone;
  uint8_t  bat;
  uint8_t  state;
  uint16_t seq;
  uint8_t  target;
  uint8_t  cmd;
  uint8_t  arg;
  uint8_t  arg2;
};
static_assert(sizeof(Pkt) == 14, "Pkt must stay 14 bytes");

constexpr uint8_t HEARD_MAX = 16;
struct __attribute__((packed)) HeardEntry { uint8_t id; int8_t rssi; };
struct __attribute__((packed)) HeardPkt {
  uint8_t    magic;
  uint8_t    type;
  uint8_t    id;
  uint8_t    n;
  HeardEntry e[HEARD_MAX];
};
inline size_t heardLen(uint8_t n) { return 4 + 2 * (size_t)n; }

constexpr uint8_t N_EXIT = 6;
constexpr uint8_t N_PAIR = 6;
extern const uint32_t EXIT_COLOURS[N_EXIT + 1];
extern const uint32_t PAIR_COLOURS[N_PAIR];
uint32_t dimColour(uint32_t c, uint8_t b);

struct RxFrame {
  uint32_t t;
  int8_t   rssi;
  uint8_t  len;
  uint8_t  mac[6];
  uint8_t  data[sizeof(HeardPkt)];
};
bool     radioBegin(uint8_t txPower, uint16_t queueDepth);
bool     radioPoll(RxFrame& out);
bool     radioSend(const void* data, size_t len);
uint32_t radioDropped();
const uint8_t* selfMac();
void     macToStr(const uint8_t* mac, char out[18]);

void serialBegin(size_t txBuf, size_t rxBuf);
bool emitLine(const char* s, size_t n);
bool emitf(const char* fmt, ...) __attribute__((format(printf, 1, 2)));

class LineBuf {
 public:
  void add(const char* fmt, ...) __attribute__((format(printf, 2, 3)));
  bool emit();
  void clear() { n_ = 0; }
 private:
  char   b_[720];
  size_t n_ = 0;
};

class LineReader {
 public:
  char* poll(Stream& s);
 private:
  char   buf_[128];
  size_t n_ = 0;
  bool   skip_ = false;
};

class CmdDedupe {
 public:
  bool seen(uint8_t from, uint16_t seq, uint32_t now);
 private:
  struct Entry { uint8_t from; uint16_t seq; uint32_t at; };
  Entry   e_[8] = {};
  uint8_t next_ = 0;
};

int  splitWords(char* s, char** out, int max);
bool parseLong(const char* s, long& v);
bool parseFloat(const char* s, float& v);
