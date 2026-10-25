"""Where people can walk on the Cal Hacks 13 floor: web/venue/venue.glb seen from above as a grid of 25 cm cells.

A cell is walkable where the model has floor and nothing stands within reach of a person: walls, tables, the
stage and the food line block it, chairs do not. The module's crowd walks around them on this grid, so
people follow the aisles and the hall's curve from one spot to the next instead of crossing tables and walls.

    python3 pipeline/venue_floor.py          -> web/venue/floor.json, loaded by scripts/e2e-setup (load_venue_floor)
    python3 pipeline/venue_floor.py --png F  also draws the grid with the venue's spots, to check it

floor.json holds the grid's corner in model metres (x east, z south), the cell size, its size in cells and the
cells row by row as run lengths, starting with a blocked run.
"""

import argparse
import heapq
import json
import struct
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
CELL = 0.25
# The model is drawn from above at this size first.
PIX = 0.125
# Table tops and counters from this height up to head height block a cell, and so does anything upright that
# reaches above a chair's back: walls, columns, railings. Chairs do not: people walk between them and sit on them,
# so the gaps between rows of hacker tables stay open.
LOW_M, HIGH_M = 0.6, 2.0
UPRIGHT_M = 0.95
# A person needs this much room around the middle of a cell.
REACH_M = 0.25
# Floor is level geometry at most this high.
FLOOR_M = 0.12


def load_glb(path):
    data = Path(path).read_bytes()
    _, _, length = struct.unpack("<III", data[:12])
    chunks, off = [], 12
    while off < length:
        size, _ = struct.unpack("<II", data[off:off + 8])
        chunks.append(data[off + 8:off + 8 + size])
        off += 8 + size
    return json.loads(chunks[0]), chunks[1]


def accessor(gltf, binary, i):
    a = gltf["accessors"][i]
    view = gltf["bufferViews"][a["bufferView"]]
    dtype = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8}[a["componentType"]]
    width = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[a["type"]]
    start = view.get("byteOffset", 0) + a.get("byteOffset", 0)
    item = np.dtype(dtype).itemsize * width
    stride = view.get("byteStride", item)
    raw = np.frombuffer(binary, np.uint8, stride * (a["count"] - 1) + item, start)
    rows = np.lib.stride_tricks.as_strided(raw, (a["count"], item), (stride, 1))
    return rows.copy().view(dtype).reshape(a["count"], width)


def node_matrix(n):
    if "matrix" in n:
        return np.array(n["matrix"], float).reshape(4, 4).T
    x, y, z, w = n.get("rotation", [0, 0, 0, 1])
    r = np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])
    m = np.eye(4)
    m[:3, :3] = r * np.array(n.get("scale", [1, 1, 1]))
    m[:3, 3] = n.get("translation", [0, 0, 0])
    return m


def triangles(gltf, binary):
    """Every triangle of the scene in world metres."""
    out = []

    def visit(i, parent):
        n = gltf["nodes"][i]
        m = parent @ node_matrix(n)
        if "mesh" in n:
            for p in gltf["meshes"][n["mesh"]]["primitives"]:
                if p.get("mode", 4) != 4:
                    continue
                pos = accessor(gltf, binary, p["attributes"]["POSITION"]).astype(float)
                pos = (np.c_[pos, np.ones(len(pos))] @ m.T)[:, :3]
                idx = accessor(gltf, binary, p["indices"]).reshape(-1) if "indices" in p else np.arange(len(pos))
                out.append(pos[idx.reshape(-1, 3)])
        for c in n.get("children", []):
            visit(c, m)

    for i in gltf["scenes"][gltf.get("scene", 0)]["nodes"]:
        visit(i, np.eye(4))
    return np.concatenate(out)


def fill(mask, tri, x0, z0, pix):
    """Marks the pixels under a triangle seen from above, and along its edges so an upright wall marks its line."""
    rows, cols = mask.shape
    p = (tri[:, [0, 2]] - (x0, z0)) / pix
    lo = np.maximum(np.floor(p.min(0)).astype(int), 0)
    hi = np.minimum(np.ceil(p.max(0)).astype(int), (cols - 1, rows - 1))
    if (hi < lo).any():
        return
    for a, b in ((p[0], p[1]), (p[1], p[2]), (p[2], p[0])):
        n = int(np.hypot(*(b - a)) * 2) + 2
        t = np.linspace(0, 1, n)[:, None]
        e = np.floor(a + (b - a) * t).astype(int)
        ok = (e[:, 0] >= 0) & (e[:, 0] < cols) & (e[:, 1] >= 0) & (e[:, 1] < rows)
        mask[e[ok, 1], e[ok, 0]] = True
    xs, zs = np.meshgrid(np.arange(lo[0], hi[0] + 1) + 0.5, np.arange(lo[1], hi[1] + 1) + 0.5)
    (ax, az), (bx, bz), (cx, cz) = p
    det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
    if abs(det) < 1e-9:
        return
    l1 = ((bz - cz) * (xs - cx) + (cx - bx) * (zs - cz)) / det
    l2 = ((cz - az) * (xs - cx) + (ax - cx) * (zs - cz)) / det
    inside = (l1 >= 0) & (l2 >= 0) & (l1 + l2 <= 1)
    sub = mask[lo[1]:hi[1] + 1, lo[0]:hi[0] + 1]
    sub |= inside


def rasterize(tris, x0, z0, cols, rows, pix):
    """The pixels under the floor, and the pixels a table top, a counter or something upright stands in."""
    floor = np.zeros((rows, cols), bool)
    block = np.zeros((rows, cols), bool)
    e1, e2 = tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0]
    normal = np.cross(e1, e2)
    level = np.abs(normal[:, 1]) / (np.linalg.norm(normal, axis=1) + 1e-12) > 0.9
    ylo, yhi = tris[:, :, 1].min(1), tris[:, :, 1].max(1)
    for k in np.flatnonzero(level & (yhi < FLOOR_M)):
        fill(floor, tris[k], x0, z0, pix)
    # A chair back's top is level too, but narrower than any table.
    span = np.minimum(np.ptp(tris[:, :, 0], axis=1), np.ptp(tris[:, :, 2], axis=1))
    tops = level & (ylo > LOW_M) & (yhi < HIGH_M) & (span >= 0.3)
    upright = ~level & (yhi > UPRIGHT_M) & (ylo < HIGH_M)
    for k in np.flatnonzero(tops | upright):
        fill(block, tris[k], x0, z0, pix)
    return floor, block


def grow(mask, cells):
    out = mask.copy()
    for dz in range(-cells, cells + 1):
        for dx in range(-cells, cells + 1):
            if dx * dx + dz * dz > cells * cells:
                continue
            out |= np.roll(np.roll(mask, dz, 0), dx, 1)
    return out


def nearest(walk, s, x0, z0):
    """The walkable cell nearest to a spot, within 3 m."""
    rows, cols = walk.shape
    c, r = int((s["x"] - x0) / CELL), int((s["z"] - z0) / CELL)
    best = min(((abs(dc) + abs(dr), r + dr, c + dc) for dr in range(-12, 13) for dc in range(-12, 13)
                if 0 <= r + dr < rows and 0 <= c + dc < cols and walk[r + dr, c + dc]), default=None)
    return best[1:] if best else None


def flood(walk, starts):
    """The walkable cells reachable from `starts`."""
    rows, cols = walk.shape
    reach = np.zeros_like(walk)
    stack = list(starts)
    while stack:
        r, c = stack.pop()
        if reach[r, c] or not walk[r, c]:
            continue
        reach[r, c] = True
        for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            if 0 <= r + dr < rows and 0 <= c + dc < cols and walk[r + dr, c + dc] and not reach[r + dr, c + dc]:
                stack.append((r + dr, c + dc))
    return reach


def doorway(walk, on_floor, room, hall):
    """A doorway from `room` to `hall`: the fewest closed cells of floor between them, opened 1.25 m wide."""
    rows, cols = walk.shape
    cost = np.full(walk.shape, np.inf)
    back = {}
    heap = [(0.0, r, c) for r, c in zip(*np.nonzero(room))]
    for _, r, c in heap:
        cost[r, c] = 0.0
    heapq.heapify(heap)
    end = None
    while heap:
        d, r, c = heapq.heappop(heap)
        if d > cost[r, c]:
            continue
        if hall[r, c]:
            end = (r, c)
            break
        for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nr, nc = r + dr, c + dc
            if not (0 <= nr < rows and 0 <= nc < cols and on_floor[nr, nc]):
                continue
            nd = d + (1.0 if walk[nr, nc] else 40.0)
            if nd < cost[nr, nc]:
                cost[nr, nc] = nd
                back[(nr, nc)] = (r, c)
                heapq.heappush(heap, (nd, nr, nc))
    out = np.zeros_like(walk)
    while end in back:
        if not walk[end]:
            out[end[0] - 2:end[0] + 3, end[1] - 2:end[1] + 3] = True
        end = back[end]
    return out & on_floor


def runs(mask):
    flat = mask.reshape(-1).astype(np.int8)
    edges = np.flatnonzero(np.diff(flat)) + 1
    bounds = np.r_[0, edges, flat.size]
    lengths = np.diff(bounds).tolist()
    return lengths if flat[0] == 0 else [0] + lengths


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=str(ROOT / "web/venue/venue.glb"))
    ap.add_argument("--spots", default=str(ROOT / "web/venue/spots.json"))
    ap.add_argument("--out", default=str(ROOT / "web/venue/floor.json"))
    ap.add_argument("--png")
    a = ap.parse_args()

    tris = triangles(*load_glb(a.model))
    lo, hi = tris.reshape(-1, 3).min(0), tris.reshape(-1, 3).max(0)
    x0, z0 = np.floor(lo[0]) - 1, np.floor(lo[2]) - 1
    cols, rows = int(np.ceil((hi[0] + 1 - x0) / CELL)), int(np.ceil((hi[2] + 1 - z0) / CELL))
    k = int(round(CELL / PIX))
    floor, block = rasterize(tris, x0, z0, cols * k, rows * k, PIX)
    # Room for a person: whatever stands grows by their reach, and a cell is walkable when all of it is clear.
    free = floor & ~grow(block, int(round(REACH_M / PIX)))
    walk = free.reshape(rows, k, cols, k).all(axis=(1, 3))

    # The model has no doorways between the hall and the lobby, the loading bay or the side rooms: each spot's
    # floor gets a doorway through the thinnest wall to the hall.
    spots = json.loads(Path(a.spots).read_text())
    on_floor = floor.reshape(rows, k, cols, k).any(axis=(1, 3))
    starts = [nearest(walk, s, x0, z0) for s in spots]
    public = [p for s, p in zip(spots, starts) if p and s["kind"] == "entrance"]
    hall = flood(walk, public[:1])
    doors = 0
    for p in starts:
        if p and not hall[p]:
            room = flood(walk, [p])
            walk |= doorway(walk, on_floor, room, hall)
            hall = flood(walk, public[:1])
            doors += 1

    # Only the floor people can reach from the doors counts: closed rooms and stray cells drop out.
    reach = flood(walk, [p for s, p in zip(spots, starts) if p and s["kind"] in ("entrance", "exit")])

    out = {"x0": float(x0), "z0": float(z0), "cell": CELL, "cols": cols, "rows": rows, "runs": runs(reach)}
    Path(a.out).write_text(json.dumps(out, separators=(",", ":")) + "\n")
    print(a.out, f"{cols} x {rows} cells of {CELL} m, {int(reach.sum())} walkable, {doors} doorways, {len(out['runs'])} runs")

    if a.png:
        from PIL import Image, ImageDraw
        img = np.zeros((rows, cols, 3), np.uint8)
        img[floor.reshape(rows, k, cols, k).any(axis=(1, 3))] = (70, 70, 80)
        img[walk] = (120, 120, 135)
        img[reach] = (190, 190, 205)
        im = Image.fromarray(img).resize((cols * 2, rows * 2), Image.NEAREST)
        d = ImageDraw.Draw(im)
        colour = {"table": (40, 160, 90), "sponsor_table": (220, 50, 50), "stage": (230, 170, 0), "food": (0, 150, 220),
                  "entrance": (200, 0, 200), "exit": (0, 0, 0), "place": (240, 120, 0), "area": (90, 90, 230)}
        for s in spots:
            x, z = (s["x"] - x0) / CELL * 2, (s["z"] - z0) / CELL * 2
            d.ellipse([x - 3, z - 3, x + 3, z + 3], fill=colour[s["kind"]])
        im.save(a.png)


if __name__ == "__main__":
    main()
