#!/usr/bin/env python3
"""BandIt scenario gateway: the gateway's serial protocol, driven by a modelled fleet of nine bands and two stations.

The dashboard can be built and rehearsed without hardware. Output lines are formatted exactly like
firmware/bandit_gateway (same keys, same order, no spaces, '\n' endings) and it takes the same command syntax.

    python3 tools/scenario_gateway.py              lines on stdout, commands on stdin
    python3 tools/scenario_gateway.py --pty        opens a pseudo-terminal and prints its path on stderr; open that
                                                   path from the dashboard exactly like /dev/cu.usbmodemXXXX
    options:  --speed 2     run the model twice as fast (t, the gateway uptime, runs at the same rate)
              --once        stop after one pass of the script instead of looping
              --no-script   people stand spread out and only react to commands
              --loss 0.03   fraction of band packets the gateway misses
              --seed 7      repeatable run

The script (about 165 s, then it loops):
      0 s  spread out across the room, 2.6 m apart: rings green
     20 s  walk toward the pit (a 1.5 m square): neighbour counts rise, yellow
     35 s  packed into the 1.2 m square: red, guide state with the exit colour
     55 s  step back out: green again
     70 s  band 5 holds SOS; bands 4, 6 and 8 stand next to it and form the light circle (state 4)
     86 s  band 5 holds again: SOS cleared
     95 s  band 3 short press (flag 4), the "approve" a merchant page waits for
    105 s  band 1 starts looking for band 8 (as after "cmd 1 find 8") and walks over; band 8 goes to found me
    140 s  band 8 presses (ping); 148 s band 1 holds 3 s and the find ends
Interactive: every command works on the model. "cmd N pay" opens the prompt and band N's wearer presses about 2.5 s
later. "cmd N find M" makes band N walk over to band M. "cmd 0 state 2" forces states (Plan B), "cmd 0 thresh",
"cmd 0 rssi" retune the neighbour counting live, "cmd N sleep" silences a band.
"""
import argparse
import math
import os
import random
import re
import select
import sys
import threading
import time
import tty

# ------------------------------------------------------------------ protocol, mirrored from bandit_common.h
T_BAND, T_STATION, T_CMD, T_HEARD = 1, 2, 3, 4
F_SOS, F_FALL, F_PRESS, F_LOWBAT, F_MPU, F_MOTOR = 1, 2, 4, 8, 16, 32
(S_IDLE, S_YELLOW, S_GUIDE, S_SOS, S_NEAR_SOS, S_PAY, S_PAID, S_CONNECT, S_IDENT, S_OFF, S_FIND,
 S_FOUND_ME) = range(12)
S_COUNT = 12
CMD_STATE, CMD_EXIT, CMD_CLEAR, CMD_BUZZ, CMD_PAY, CMD_PAID, CMD_THRESH, CMD_RSSI, CMD_OVERRIDE, CMD_FIND, \
    CMD_SLEEP, CMD_HAPTIC, CMD_LOWVIS = range(1, 14)
# name, cmd, min args, max args, default first arg: the gateway's command table
CMDS = {
    'state': (CMD_STATE, 1, 2, 0), 'exit': (CMD_EXIT, 1, 1, 0), 'clear': (CMD_CLEAR, 0, 0, 0),
    'buzz': (CMD_BUZZ, 0, 1, 1), 'pay': (CMD_PAY, 0, 0, 0), 'paid': (CMD_PAID, 0, 0, 0),
    'thresh': (CMD_THRESH, 2, 2, 0), 'rssi': (CMD_RSSI, 2, 2, 0), 'override': (CMD_OVERRIDE, 1, 1, 0),
    'find': (CMD_FIND, 1, 2, 0), 'sleep': (CMD_SLEEP, 0, 1, 0), 'haptic': (CMD_HAPTIC, 1, 1, 0),
    'lowvis': (CMD_LOWVIS, 1, 1, 0),
}
ID_ALL_BANDS, ID_BAND_MAX, ID_ALL_STATIONS = 0, 99, 100
N_EXIT, N_PAIR = 6, 6

# ------------------------------------------------------------------ firmware constants, mirrored from band.cpp
BEACON_MS, JITTER_MS, HEARD_MS, STATION_MS = 100, 30, 1000, 200
NEIGH_WINDOW_MS, ZONE_WINDOW_MS = 2000, 3000
FAST_TAU, SLOW_TAU = 500.0, 2000.0
DENSITY_MS, DENSITY_KEEP = 250, 0.7
PRESS_MS, PAY_MS, PAID_MS, NEAR_SOS_MS, CONNECT_MS, IDENT_MS = 1000, 8000, 1500, 1500, 2000, 3000
FIND_TIMEOUT_MS, SOUGHT_MS = 5 * 60 * 1000, 2000
FOUND_ME_RSSI, FOUND_ME_EXIT, FOUND_ME_DWELL_MS = -55, -60, 1000

GATEWAY_MAC = '02:BA:4D:17:00:C8'


def git_fw():
    try:
        import subprocess
        h = subprocess.run(['git', 'rev-parse', '--short', 'HEAD'], capture_output=True, text=True,
                           cwd=os.path.dirname(os.path.abspath(__file__))).stdout.strip()
        return f'scenario-{h}' if h else 'scenario'
    except OSError:
        return 'scenario'


# ------------------------------------------------------------------ radio model
ROOM_W, ROOM_H = 12.0, 8.0
PIT = (6.0, 4.0)
GATEWAY_POS = (6.0, 8.6)


def path_loss(d, ref=-47.0, slope=32.0):
    """Mean RSSI in dBm at distance d (m). The default is wrist to wrist at 8 dBm through a crowd, where bodies
    absorb most of the signal (-62 dBm at about 0.9 m); stations and the gateway use a gentler slope."""
    return ref - slope * math.log10(max(d, 0.2) / 0.3)


class Peer:
    __slots__ = ('fast', 'slow', 'last', 'flags', 'target', 'arg', 'state')

    def __init__(self):
        self.fast = self.slow = -127.0
        self.last = None
        self.flags = self.target = self.arg = self.state = 0

    def fresh(self, now, window):
        return self.last is not None and now - self.last < window

    def hear(self, r, t):
        if self.last is None or t - self.last > NEIGH_WINDOW_MS:
            self.fast = self.slow = float(r)
        else:
            dt = float(t - self.last)
            self.fast += (r - self.fast) * dt / (FAST_TAU + dt)
            self.slow += (r - self.slow) * dt / (SLOW_TAU + dt)
        self.last = t


class Station:
    def __init__(self, sid, x, y):
        self.id, self.x, self.y = sid, x, y
        self.colour = sid - 100
        self.mode = 0
        self.seq = random.randrange(65536)
        self.next = random.randrange(STATION_MS)


class Band:
    def __init__(self, bid, x, y, mpu, motor, divider):
        self.id, self.x, self.y = bid, x, y
        self.tx, self.ty, self.speed = x, y, 1.2
        self.follow = None                     # walk toward this band (find)
        self.hw = (F_MPU if mpu else 0) | (F_MOTOR if motor else 0)
        self.bat = random.randint(78, 96) if divider else 255
        self.peers = {}
        self.yellow, self.red, self.nrssi, self.crssi = 3, 5, -62, -58
        self.smooth, self.neigh, self.density, self.zone, self.exit = 0.0, 0, S_IDLE, 0, 1
        self.forced, self.forced_until, self.override = None, 0, False
        self.sos = self.fell = False
        self.press_until = self.pay_until = self.paid_until = 0
        self.connect_until = self.ident_until = self.near_sos_until = 0
        self.find, self.find_colour, self.find_until = 0, 0, 0
        self.seeker, self.seeker_colour, self.sought_last, self.close_since, self.found_me = 0, 0, 0, None, False
        self.asleep_until = None
        self.auto_press_at = None
        self.seq = random.randrange(65536)
        self.slot = random.randrange(BEACON_MS)
        self.next_beacon = self.slot
        self.next_heard = random.randrange(HEARD_MS)
        self.next_density = random.randrange(DENSITY_MS)

    # -------- the band's own logic, as in band.cpp
    def state(self, now):
        if now < self.ident_until:
            return S_IDENT
        if self.sos or self.fell:
            return S_SOS
        if now < self.paid_until:
            return S_PAID
        if now < self.pay_until:
            return S_PAY
        if self.found_me:
            return S_FOUND_ME
        if self.find:
            return S_FIND
        if now < self.connect_until:
            return S_CONNECT
        if now < self.near_sos_until:
            return S_NEAR_SOS
        if self.forced is not None:
            if not self.forced_until or now < self.forced_until:
                return self.forced
            self.forced = None
        if self.override:
            return S_IDLE
        return self.density

    def flags(self, now):
        f = self.hw
        f |= F_SOS if self.sos else 0
        f |= F_FALL if self.fell else 0
        f |= F_PRESS if now < self.press_until else 0
        f |= F_LOWBAT if self.bat != 255 and self.bat < 15 else 0
        return f

    def press(self, now):
        self.press_until = now + PRESS_MS

    def hold3(self, now):
        if self.find:
            self.find = 0
            self.follow = None
        elif self.sos or self.fell:
            self.sos = self.fell = False
        else:
            self.sos = True

    def start_find(self, friend, colour, now, world):
        if not friend or friend == self.id:
            return
        self.find, self.find_colour, self.find_until = friend, colour if colour < N_PAIR else 0, now + FIND_TIMEOUT_MS
        self.follow = world.bands.get(friend)

    def update_density(self, now, stations):
        n = sum(1 for pid, p in self.peers.items()
                if pid <= ID_BAND_MAX and p.fresh(now, NEIGH_WINDOW_MS) and p.fast >= self.nrssi)
        self.smooth = DENSITY_KEEP * self.smooth + (1 - DENSITY_KEEP) * n
        self.neigh = int(math.floor(self.smooth + 0.5))
        c = self.neigh
        if self.density == S_IDLE and c >= self.yellow:
            self.density = S_YELLOW
        if self.density == S_YELLOW and c >= self.red:
            self.density = S_GUIDE
        if self.density == S_GUIDE and c < self.red - 1:
            self.density = S_YELLOW
        if self.density == S_YELLOW and c < self.yellow - 1:
            self.density = S_IDLE
        best = None
        for pid, p in self.peers.items():
            if pid >= 101 and p.fresh(now, ZONE_WINDOW_MS) and (best is None or p.fast > best[1]):
                best = (pid, p.fast)
        self.zone = best[0] if best else 0

    def service_find(self, now):
        if self.find and now >= self.find_until:
            self.find, self.follow = 0, None
        if self.seeker and now - self.sought_last >= SOUGHT_MS:
            self.seeker, self.found_me, self.close_since = 0, False, None
        if self.seeker:
            p = self.peers.get(self.seeker)
            r = p.fast if p else -127
            if not self.found_me:
                if r >= FOUND_ME_RSSI:
                    if self.close_since is None:
                        self.close_since = now
                    elif now - self.close_since >= FOUND_ME_DWELL_MS:
                        self.found_me = True
                else:
                    self.close_since = None
            elif r < FOUND_ME_EXIT:
                self.found_me, self.close_since = False, None

    def receive_band(self, other, rssi, now):
        p = self.peers.setdefault(other.id, Peer())
        prev = p.flags if p.fresh(now, NEIGH_WINDOW_MS) else 0
        p.hear(rssi, now)
        p.flags, p.target, p.arg = other.flags(now), other.find, other.find_colour if other.find else 0
        if p.flags & (F_SOS | F_FALL) and p.fast >= self.crssi:
            self.near_sos_until = now + NEAR_SOS_MS
        if p.target == self.id:
            if self.seeker != other.id:
                self.seeker, self.found_me, self.close_since = other.id, False, None
            self.seeker_colour = p.arg if p.arg < N_PAIR else 0
            self.sought_last = now

    def receive_station(self, st, rssi, now):
        p = self.peers.setdefault(st.id, Peer())
        p.hear(rssi, now)
        p.state = st.colour

    def apply(self, cmd, arg, arg2, now, world):
        hold = arg2 * 100
        if cmd == CMD_STATE:
            if arg == S_CONNECT:
                self.connect_until = now + (hold or CONNECT_MS)
            elif arg == S_IDENT:
                self.ident_until = now + (hold or IDENT_MS)
            elif arg < S_COUNT:
                self.forced, self.forced_until = arg, (now + hold if hold else 0)
        elif cmd == CMD_EXIT and 1 <= arg <= N_EXIT:
            self.exit = arg
        elif cmd == CMD_CLEAR:
            self.sos = self.fell = False
            self.forced, self.near_sos_until = None, 0
        elif cmd == CMD_PAY:
            self.pay_until = now + PAY_MS
            if world.auto_press:
                self.auto_press_at = now + random.randint(1800, 3200)
        elif cmd == CMD_PAID:
            self.pay_until, self.paid_until = 0, now + PAID_MS
        elif cmd == CMD_THRESH and arg >= 1 and arg2 >= arg:
            self.yellow, self.red = arg, arg2
        elif cmd == CMD_RSSI and 20 <= arg <= 100 and 20 <= arg2 <= 100:
            self.nrssi, self.crssi = -arg, -arg2
        elif cmd == CMD_OVERRIDE:
            self.override = arg != 0
        elif cmd == CMD_FIND:
            if arg:
                self.start_find(arg, arg2, now, world)
            else:
                self.find, self.follow = 0, None
        elif cmd == CMD_SLEEP:
            self.sos = self.fell = False
            self.find, self.follow, self.found_me = 0, None, False
            world.emit_band(self, now, state=S_OFF)
            self.asleep_until = now + arg * 60000 if arg else float('inf')


# ------------------------------------------------------------------ the world
class World:
    def __init__(self, args, out):
        self.args, self.out = args, out
        self.auto_press = True
        self.lock = threading.Lock()
        self.reset()

    def reset(self):
        spread = self.spread_positions()
        self.bands = {}
        for i in range(1, 10):
            x, y = spread[i - 1]
            self.bands[i] = Band(i, x, y, mpu=i in (1, 4, 7), motor=i in (1, 4, 7), divider=i in (1, 2, 3))
        self.stations = [Station(101, 0.3, 4.0), Station(102, 11.7, 4.0)]
        self.shadow = {}
        self.script_pos = 0

    @staticmethod
    def spread_positions():
        return [(PIT[0] + dx, PIT[1] + dy) for dy in (-2.6, 0, 2.6) for dx in (-2.6, 0, 2.6)]

    @staticmethod
    def square_positions(step):   # 3 x 3 people, step metres apart, around the pit centre
        return [(PIT[0] + dx * step + random.uniform(-0.08, 0.08), PIT[1] + dy * step + random.uniform(-0.08, 0.08))
                for dy in (-1, 0, 1) for dx in (-1, 0, 1)]

    def walk_to(self, positions, speed=1.0):
        for i, (x, y) in enumerate(positions, start=1):
            b = self.bands[i]
            b.tx, b.ty, b.speed, b.follow = x, y, speed, None

    # -------- the scripted scenario
    def script(self):
        bands = self.bands
        sq15, sq12 = self.square_positions(0.75), self.square_positions(0.4)   # 1.5 m and 1.2 m squares
        sos_scene = [(PIT[0] - 3.2, 1.2), (PIT[0], 1.0), (PIT[0] + 3.2, 1.2),
                     (PIT[0] - 0.55, PIT[1]), PIT, (PIT[0] + 0.55, PIT[1]),
                     (PIT[0] - 3.2, 6.8), (PIT[0], PIT[1] + 0.6), (PIT[0] + 3.2, 6.8)]
        return [
            (0, lambda now: self.walk_to(self.spread_positions())),
            (20, lambda now: self.walk_to(sq15, 0.6)),
            (35, lambda now: self.walk_to(sq12, 0.4)),
            (55, lambda now: self.walk_to(self.spread_positions(), 0.9)),
            (66, lambda now: self.walk_to(sos_scene, 1.0)),
            (70, lambda now: bands[5].hold3(now)),
            (86, lambda now: bands[5].hold3(now)),
            (88, lambda now: self.walk_to(self.spread_positions(), 1.0)),
            (95, lambda now: bands[3].press(now)),
            (100, lambda now: self.place_for_find()),
            (105, lambda now: bands[1].start_find(8, 0, now, self)),
            (140, lambda now: bands[8].press(now)),
            (148, lambda now: bands[1].hold3(now)),
            (152, lambda now: self.walk_to(self.spread_positions(), 0.8)),
            (165, None),
        ]

    def place_for_find(self):
        self.walk_to(self.spread_positions(), 1.0)
        b1, b8 = self.bands[1], self.bands[8]
        b1.tx, b1.ty = 1.2, 1.2
        b8.tx, b8.ty, b8.speed = 10.8, 6.8, 1.5

    # -------- radio
    def rssi(self, a, b, base_offset=0.0, slope=32.0):
        key = (min(a.id, b.id), max(a.id, b.id))
        s = self.shadow.get(key, 0.0)
        s = max(-5.0, min(5.0, s + random.gauss(0, 0.15)))   # slow body shadowing per pair
        self.shadow[key] = s
        d = math.hypot(a.x - b.x, a.y - b.y)
        return int(round(path_loss(d, slope=slope) + base_offset + s + random.gauss(0, 3.0)))

    def gw_rssi(self, b):
        d = math.hypot(b.x - GATEWAY_POS[0], b.y - GATEWAY_POS[1])
        return int(round(path_loss(d, slope=22.0) - 2 + random.gauss(0, 2.5)))

    def emit(self, line):
        self.out(line + '\n')

    def emit_band(self, b, now, state=None):
        st = b.state(now) if state is None else state
        b.seq = (b.seq + 1) & 0xFFFF
        if random.random() >= self.args.loss:
            self.emit(f'{{"t":{now},"type":1,"id":{b.id},"rssi":{self.gw_rssi(b)},"flags":{b.flags(now)},'
                      f'"neigh":{b.neigh},"zone":{b.zone},"bat":{b.bat},"state":{st},"seq":{b.seq},"find":{b.find}}}')

    def emit_heard(self, b, now):
        rows = [(pid, int(round(p.fast))) for pid, p in b.peers.items() if p.fresh(now, NEIGH_WINDOW_MS)]
        rows.sort(key=lambda r: -r[1])
        if random.random() >= self.args.loss:
            hs = ','.join(f'[{a},{r}]' for a, r in rows[:16])
            self.emit(f'{{"t":{now},"type":4,"id":{b.id},"rssi":{self.gw_rssi(b)},"heard":[{hs}]}}')

    def awake(self, b, now):
        if b.asleep_until is None:
            return True
        if now >= b.asleep_until:
            b.asleep_until = None
            b.peers, b.smooth, b.neigh, b.density = {}, 0.0, 0, S_IDLE
            b.ident_until = now + 1500
            return True
        return False

    # -------- one model step
    def step(self, now, dt):
        for b in self.bands.values():
            if b.follow is not None and b.find:
                f = b.follow
                d = math.hypot(f.x - b.x, f.y - b.y)
                if d > 0.35:
                    b.tx, b.ty, b.speed = f.x - (f.x - b.x) * 0.35 / d, f.y - (f.y - b.y) * 0.35 / d, 0.35
            dx, dy = b.tx - b.x, b.ty - b.y
            d = math.hypot(dx, dy)
            stepm = b.speed * dt / 1000.0
            if d > 1e-6:
                k = min(1.0, stepm / d)
                b.x, b.y = b.x + dx * k, b.y + dy * k
            if b.auto_press_at is not None and now >= b.auto_press_at:
                b.auto_press_at = None
                if now < b.pay_until:
                    b.press(now)
        live = [b for b in self.bands.values() if self.awake(b, now)]
        for st in self.stations:
            if now >= st.next:
                st.next += STATION_MS
                st.seq = (st.seq + 1) & 0xFFFF
                for b in live:
                    if random.random() > 0.02:
                        b.receive_station(st, self.rssi(b, st, base_offset=6.0, slope=22.0), now)
                d = math.hypot(st.x - GATEWAY_POS[0], st.y - GATEWAY_POS[1])
                r = int(round(path_loss(d, slope=22.0) + 10 + random.gauss(0, 1.5)))
                self.emit(f'{{"t":{now},"type":2,"id":{st.id},"rssi":{r},"flags":0,"neigh":0,"zone":0,"bat":0,'
                          f'"state":{st.colour},"seq":{st.seq}}}')
        for b in live:
            if now >= b.next_density:
                b.next_density += DENSITY_MS
                b.update_density(now, self.stations)
            b.service_find(now)
            if now >= b.next_beacon:
                for o in live:
                    if o is not b and random.random() > 0.05:
                        o.receive_band(b, self.rssi(b, o), now)
                self.emit_band(b, now)
                b.slot += BEACON_MS
                if now - b.slot >= BEACON_MS:
                    b.slot = now
                b.next_beacon = b.slot + random.randint(0, JITTER_MS)
            if now >= b.next_heard:
                b.next_heard = now + HEARD_MS + random.randint(0, 50)
                self.emit_heard(b, now)
            if b.bat != 255 and random.random() < dt / 90000.0:
                b.bat = max(0, b.bat - 1)

    # -------- commands, parsed exactly like gateway.cpp
    def handle_line(self, line, now):
        if len(line) > 127:
            return
        w = line.split()[:8]
        if not w:
            return
        if len(w) == 1 and w[0] == 'info':
            self.emit(f'{{"info":"gateway","mac":"{GATEWAY_MAC}","channel":1,"fw":"{self.args.fw}"}}')
            return
        num = re.compile(r'^[+-]?[0-9]+$')
        if len(w) < 3 or w[0] != 'cmd' or not num.match(w[1]) or not 0 <= int(w[1]) <= 255:
            self.emit('{"err":"usage: cmd <target> <name> [arg] [arg2]"}')
            return
        target = int(w[1])
        if w[2] not in CMDS:
            self.emit('{"err":"unknown cmd"}')
            return
        cmd, lo, hi, def1 = CMDS[w[2]]
        nargs = len(w) - 3
        a = [def1, 0]
        ok = lo <= nargs <= hi
        for i in range(nargs if ok else 0):
            if not num.match(w[3 + i]):
                ok = False
                break
            a[i] = int(w[3 + i])
            if cmd == CMD_RSSI and a[i] < 0:
                a[i] = -a[i]
            if not 0 <= a[i] <= 255:
                ok = False
                break
        if not ok:
            self.emit('{"err":"bad args"}')
            return
        self.emit(f'{{"ack":"cmd","target":{target},"cmd":{cmd},"arg":{a[0]},"arg2":{a[1]}}}')
        self.deliver(target, cmd, a[0], a[1], now)

    def deliver(self, target, cmd, arg, arg2, now):
        if target == ID_ALL_STATIONS or target >= 101:
            for st in self.stations:
                if target in (ID_ALL_STATIONS, st.id):
                    if cmd == CMD_EXIT and 1 <= arg <= N_EXIT:
                        st.colour = arg
                    elif cmd == CMD_STATE and arg in (0, 1, 2, 9):
                        st.mode = arg
                    elif cmd == CMD_CLEAR:
                        st.mode = 0
            return
        for b in self.bands.values():
            if (target == ID_ALL_BANDS or target == b.id) and b.asleep_until is None:
                b.apply(cmd, arg, arg2, now, self)


# ------------------------------------------------------------------ io
class PtyOut:
    """Writes whole lines to a pty master without ever blocking; lines are dropped whole when nobody reads."""

    def __init__(self):
        self.master, self.slave = os.openpty()
        tty.setraw(self.slave)
        tty.setraw(self.master)
        os.set_blocking(self.master, False)
        self.pending = b''
        self.path = os.ttyname(self.slave)

    def __call__(self, line):
        if len(self.pending) > 65536:
            return
        self.pending += line.encode()
        self.flush()

    def flush(self):
        while self.pending:
            try:
                n = os.write(self.master, self.pending)
            except (BlockingIOError, OSError):
                return
            self.pending = self.pending[n:]

    def read_lines(self):
        buf = b''
        while True:
            r, _, _ = select.select([self.master], [], [], 0.05)
            if r:
                try:
                    buf += os.read(self.master, 1024)
                except OSError:
                    time.sleep(0.05)
                    continue
                buf = buf.replace(b'\r', b'\n')
                while b'\n' in buf:
                    line, buf = buf.split(b'\n', 1)
                    yield line.decode(errors='replace')


def main():
    ap = argparse.ArgumentParser(description='BandIt scenario gateway')
    ap.add_argument('--pty', action='store_true')
    ap.add_argument('--speed', type=float, default=1.0)
    ap.add_argument('--once', action='store_true')
    ap.add_argument('--no-script', action='store_true')
    ap.add_argument('--loss', type=float, default=0.03)
    ap.add_argument('--seed', type=int)
    args = ap.parse_args()
    if args.seed is not None:
        random.seed(args.seed)
    args.fw = git_fw()

    if args.pty:
        out = PtyOut()
        sys.stderr.write(f'scenario gateway on {out.path}\n')
        sys.stderr.flush()
        line_source = out.read_lines()
    else:
        def out(s):
            try:
                sys.stdout.write(s)
                sys.stdout.flush()
            except BrokenPipeError:
                os._exit(0)
        line_source = (line.rstrip('\n') for line in sys.stdin)

    world = World(args, out)
    inbox = []

    def reader():
        for line in line_source:
            with world.lock:
                inbox.append(line)

    threading.Thread(target=reader, daemon=True).start()
    start = time.time()
    world.emit(f'{{"gateway":"up","mac":"{GATEWAY_MAC}","channel":1,"fw":"{args.fw}"}}')
    script = [] if args.no_script else world.script()
    loop_start, last = 0, 0
    while True:
        now = int((time.time() - start) * 1000 * args.speed)
        with world.lock:
            lines, inbox[:] = inbox[:], []
        for line in lines:
            world.handle_line(line.strip(), now)
        while world.script_pos < len(script) and now - loop_start >= script[world.script_pos][0] * 1000:
            action = script[world.script_pos][1]
            world.script_pos += 1
            if action is None:
                if args.once:
                    return
                loop_start, world.script_pos = now, 0
                script = world.script()
            else:
                action(now)
        world.step(now, max(1, now - last))
        last = now
        if args.pty:
            out.flush()
        time.sleep(0.01)


if __name__ == '__main__':
    main()
