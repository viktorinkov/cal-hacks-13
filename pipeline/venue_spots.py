"""The spots people use on the Cal Hacks 13 floor, in the frame of web/venue/venue.glb (meters, x east, z south).

Reads the venue map's named locations (hive.hackberkeley.org/venue-map, fetched through Bright Data) and the
palace-interior floor layout, both on Viktor's Mac (gitignored), and writes web/venue/spots.json. The module's
crowd sits teams at the hacker tables, sends visitors and staff to the sponsor tables, the stage, the food line
and the doors, and the live page labels the hall with the rest.

    python3 pipeline/venue_spots.py \
        --locations var/venue-3d/brightdata/hive/locations.json \
        --layout pipeline/data/venue/palace-interior/layout/layout.json
"""

import argparse
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def to_m(layout, px, py):
    ox, oy = layout["origin"]
    k = layout["metersPerPixel"]
    return round((px - ox) * k, 2), round((py - oy) * k, 2)


def spot(kind, name, x, z, number=0, angle=0.0):
    return {"kind": kind, "name": name, "number": number, "x": round(x, 2), "z": round(z, 2), "angle": round(angle, 3)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--locations", required=True)
    ap.add_argument("--layout", required=True)
    ap.add_argument("--out", default=str(ROOT / "web/venue/spots.json"))
    a = ap.parse_args()
    locations = json.load(open(a.locations))["locations"]
    layout = json.load(open(a.layout))
    hall = layout["hall"]
    out = []

    # Hacker tables on the main floor, by their printed numbers.
    tables = [l for l in locations if l["category"] == "table_number" and l["floor"] == "main floor"]
    for t in sorted(tables, key=lambda t: t["table_number"]):
        out.append(spot("table", t["name"], t["scene_x"], t["scene_z"], t["table_number"]))
    table_xz = [(s["x"], s["z"]) for s in out]

    # Sponsor tables with the way they face: staff stand on one long side, visitors on the other.
    for s in layout["mainSponsorTables"]:
        x, z = to_m(layout, s["x"], s["y"])
        out.append(spot("sponsor_table", s["name"], x, z, angle=math.radians(s["angle"])))

    # The stage, and the crowd in front of it: a grid on the hall side, kept clear of the tables.
    poly = [to_m(layout, *p) for p in hall["stage"]]
    cx = sum(p[0] for p in poly) / 4
    cz = sum(p[1] for p in poly) / 4
    out.append(spot("place", "Stage", cx, cz))
    ax = (poly[2][0] - poly[1][0], poly[2][1] - poly[1][1])
    length = math.hypot(*ax)
    along = (ax[0] / length, ax[1] / length)
    facing = (along[1], -along[0])
    if facing[0] < 0:
        facing = (-facing[0], -facing[1])
    for d in (4.0, 5.5, 7.0, 8.5):
        for s in (-4.5, -3.0, -1.5, 0.0, 1.5, 3.0, 4.5):
            x = cx + facing[0] * d + along[0] * s
            z = cz + facing[1] * d + along[1] * s
            if all(math.hypot(x - tx, z - tz) > 1.6 for tx, tz in table_xz):
                out.append(spot("stage", "Stage", x, z))

    # The food line: people queue on both long sides of the service tables.
    for t in hall["serviceTables"]:
        x, z = to_m(layout, t["x"], t["y"])
        n = math.radians(t["angle"] + 90)
        for side in (-1.4, 1.4):
            out.append(spot("food", "Food", x + math.cos(n) * side, z + math.sin(n) * side))

    # The doors. The business entrance has check-in and the queue; every door is an exit.
    for o in layout["mainFloor"]["openings"]:
        ax_, az_ = to_m(layout, *o["a"])
        bx_, bz_ = to_m(layout, *o["b"])
        mx, mz = (ax_ + bx_) / 2, (az_ + bz_) / 2
        out.append(spot("exit", o["label"], mx, mz))
        if o["id"] in ("public-entrance", "business-entrance"):
            for f in (0.25, 0.4, 0.6, 0.75):
                out.append(spot("entrance", o["label"], ax_ + (bx_ - ax_) * f, az_ + (bz_ - az_) * f))
    for t in hall["singleTables"]:
        if t["kind"] == "checkin":
            x, z = to_m(layout, t["x"], t["y"])
            out.append(spot("entrance", "Check-in", x, z))

    # Named places and areas, for the live page's labels.
    for l in locations:
        if l["category"] == "general" and l["floor"] == "main floor" and l["name"] != "Stage":
            out.append(spot("place", l["name"], l["scene_x"], l["scene_z"]))
    for z in layout["mainFloor"]["zones"]:
        x, zz = to_m(layout, *z["at"])
        out.append(spot("area", z["label"], x, zz))

    Path(a.out).write_text(json.dumps(out, separators=(",", ":")) + "\n")
    counts = {}
    for s in out:
        counts[s["kind"]] = counts.get(s["kind"], 0) + 1
    print(a.out, counts)


if __name__ == "__main__":
    main()
