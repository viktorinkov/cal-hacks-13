"""BandIt density calibration from labelled gateway logs.

    python3 tools/calibrate.py logs/bandit_*.jsonl

Record three runs at the venue with everyone wearing a band (same wrist, ring facing out), about 60 s each:
    python3 tools/gateway_monitor.py --label spread     people 2 m apart
    python3 tools/gateway_monitor.py --label sq15       everyone inside the 1.5 m taped square
    python3 tools/gateway_monitor.py --label sq12       everyone inside the 1.2 m taped square
or one log with "label spread" / "label sq15" / "label sq12" typed at the monitor prompt before each run.

Each band sends a heard list once a second (gateway line type 4: every band it hears with the smoothed RSSI it
uses itself), so the neighbour count can be recomputed here for any threshold. The script prints, per band and
run, the RSSI of the bands it hears and the neighbour counts it reported, then suggests:
    rssi    the neighbour threshold that best separates the runs: spread stays at 0..1 neighbours, the 1.5 m and
            1.2 m squares differ by at least one count, and red does not need every band (red <= 6 with nine
            bands); the light-circle threshold 4 dB stricter
    thresh  yellow and red counts: yellow fires in the 1.5 m square, red fires in the 1.2 m square, and the
            spread run never reaches yellow
Push the result live:  cmd 0 rssi <n> <c>   and   cmd 0 thresh <yellow> <red>   (the bands save them)
Options: --spread NAME --loose NAME --tight NAME choose other label names; --skip 5 drops the first 5 s of a run.
"""
import json
import os
import re
import sys
from collections import defaultdict


def pct(xs, p):
    if not xs:
        return None
    xs = sorted(xs)
    return xs[min(len(xs) - 1, max(0, int(round(p / 100 * (len(xs) - 1)))))]


def load(paths, skip_ms):
    """-> {label: {'heard': [(band, [(id, rssi)])], 'neigh': {band: [counts]}}}"""
    runs = defaultdict(lambda: {'heard': [], 'neigh': defaultdict(list)})
    for path in paths:
        m = re.match(r'bandit_(.+?)_\d{8}_\d{6}\.jsonl$', os.path.basename(path))
        label, start = (m.group(1) if m else os.path.basename(path)), None
        for line in open(path):
            try:
                d = json.loads(line)
            except ValueError:
                continue
            if 'label' in d:
                label, start = d['label'], None
                continue
            t = d.get('t')
            if t is None or 'type' not in d:
                continue
            if start is None or t < start:
                start = t
            if t - start < skip_ms:
                continue
            if d['type'] == 4:
                runs[label]['heard'].append((d['id'], [(a, r) for a, r in d['heard'] if a <= 99]))
            elif d['type'] == 1:
                runs[label]['neigh'][d['id']].append(d['neigh'])
    return runs


def counts_at(run, thr):
    return [sum(1 for _, r in h if r >= thr) for _, h in run['heard']]


def suggest(spread, loose, tight):
    """Pick the threshold with the widest gap between consecutive runs, then counts in the middle of each gap."""
    rows = []
    for thr in range(-40, -91, -1):
        cs, cl, ct = counts_at(spread, thr), counts_at(loose, thr), counts_at(tight, thr)
        if not (cs and cl and ct):
            continue
        gap_y = pct(cl, 25) - pct(cs, 95)           # 1.5 m square vs spread
        gap_r = pct(ct, 25) - pct(cl, 75)           # 1.2 m square vs 1.5 m square
        yellow = max(2, min(pct(cs, 95) + 2, pct(cl, 25)))
        red = max(yellow + 1, (pct(cl, 75) + 1 + pct(ct, 25) + 1) // 2)
        ok = pct(cs, 90) <= 1 and gap_y >= 1 and gap_r >= 1
        score = (red <= 6, min(gap_y, gap_r), gap_y + gap_r)   # with 9 bands, red must not need everyone
        rows.append((thr, ok, score, yellow, red, pct(cs, 50), pct(cl, 50), pct(ct, 50)))
    good = [r for r in rows if r[1]]
    if good:
        best = max(r[2] for r in good)
        tops = [r for r in good if r[2] == best]
        return tops[len(tops) // 2], rows
    return None, rows


def main():
    args = sys.argv[1:]
    opt = {'--spread': 'spread', '--loose': 'sq15', '--tight': 'sq12', '--skip': '5'}
    paths = []
    i = 0
    while i < len(args):
        if args[i] in opt:
            opt[args[i]] = args[i + 1]
            i += 2
        else:
            paths.append(args[i])
            i += 1
    if not paths:
        print(__doc__)
        sys.exit(1)
    runs = load(paths, int(float(opt['--skip']) * 1000))
    names = [opt['--spread'], opt['--loose'], opt['--tight']]
    print('runs found:', ', '.join(f"{k} ({len(v['heard'])} heard lists)" for k, v in runs.items()))

    for name in [n for n in names if n in runs] + [k for k in runs if k not in names]:
        run = runs[name]
        print(f'\n== {name}')
        print(' band   neighbour RSSI p10 / p50 / p90 (n)      reported neigh p10 / p50 / p90')
        per = defaultdict(list)
        for band, h in run['heard']:
            per[band] += [r for _, r in h]
        for band in sorted(set(per) | set(run['neigh'])):
            r, n = per.get(band, []), run['neigh'].get(band, [])
            rs = f"{pct(r, 10)} / {pct(r, 50)} / {pct(r, 90)} ({len(r)})" if r else '-'
            ns = f"{pct(n, 10)} / {pct(n, 50)} / {pct(n, 90)}" if n else '-'
            print(f' {band:>4}   {rs:<38} {ns}')

    missing = [n for n in names if n not in runs]
    if missing:
        print(f"\nno run labelled {', '.join(missing)}: record it to get a suggestion")
        return
    best, rows = suggest(*(runs[n] for n in names))
    print('\n threshold  ok  yellow red   median count spread / 1.5 m / 1.2 m')
    for thr, ok, margin, y, r, ms, ml, mt in rows:
        if ok or thr % 4 == 0:
            print(f'   {thr:>5}    {"yes" if ok else "  -"}  {y:>4} {r:>4}    {ms} / {ml} / {mt}')
    if best is None:
        print('\nno threshold separates the runs cleanly. Check antennas and wrists, re-run the squares tighter, or use '
              'Plan B (camera density, "cmd 0 override 1" and "cmd 0 state").')
        return
    thr, _, _, y, r, *_ = best
    print(f'\nsuggested:  cmd 0 rssi {-thr} {-thr - 4}    cmd 0 thresh {y} {r}')


if __name__ == '__main__':
    main()
