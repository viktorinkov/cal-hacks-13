import json, sys, itertools
d = json.load(open(sys.argv[1]))
els = d["elements"]
byid = {e["id"]: e for e in els}
frames = [e for e in els if e["type"] == "frame"]
def bb(e):
    if e["type"] == "arrow":
        xs = [e["x"] + p[0] for p in e["points"]]; ys = [e["y"] + p[1] for p in e["points"]]
        return min(xs), min(ys), max(xs), max(ys)
    return e["x"], e["y"], e["x"] + e["width"], e["y"] + e["height"]
for f in frames:
    fx0, fy0, fx1, fy1 = bb(f)
    kids = [e for e in els if e.get("frameId") == f["id"]]
    ext = [min(bb(k)[0] for k in kids), min(bb(k)[1] for k in kids), max(bb(k)[2] for k in kids), max(bb(k)[3] for k in kids)]
    print(f["name"], "frame", (fx0, fy0, fx1, fy1), "content", [round(v) for v in ext])
    for k in kids:
        x0, y0, x1, y1 = bb(k)
        if x0 < fx0 or y0 < fy0 or x1 > fx1 or y1 > fy1:
            print("  OUTSIDE", k["type"], k["id"], (k.get("text") or "")[:40], [round(v) for v in (x0, y0, x1, y1)])
    # free text: only the title, box labels, arrow labels and zone labels may hold text
    zr = [k for k in kids if k["type"] == "rectangle" and k.get("roughness") == 0 and k.get("strokeWidth") == 1]
    for t in [k for k in kids if k["type"] == "text" and not k.get("containerId")]:
        zone_label = any(z["x"] <= t["x"] <= z["x"] + 320 and z["y"] <= t["y"] <= z["y"] + 20 for z in zr)
        if t["fontSize"] < 40 and not zone_label:
            print("  FREE TEXT", t["text"][:40])
    # overlapping boxes (rects/diamonds with bound text), ignoring zones (no bound text)
    boxes = [k for k in kids if k["type"] in ("rectangle", "diamond") and any(b["type"] == "text" for b in k["boundElements"])]
    for a, b in itertools.combinations(boxes, 2):
        ax0, ay0, ax1, ay1 = bb(a); bx0, by0, bx1, by1 = bb(b)
        if ax0 < bx1 and bx0 < ax1 and ay0 < by1 and by0 < ay1:
            ta = byid[[x for x in a["boundElements"] if x["type"]=="text"][0]["id"]]["text"].split("\n")[0]
            tb = byid[[x for x in b["boundElements"] if x["type"]=="text"][0]["id"]]["text"].split("\n")[0]
            print("  OVERLAP", ta, "|", tb)
    # arrows crossing boxes they are not bound to
    for ar in [k for k in kids if k["type"] == "arrow"]:
        pts = [(ar["x"] + p[0], ar["y"] + p[1]) for p in ar["points"]]
        ends = {(ar.get("startBinding") or {}).get("elementId"), (ar.get("endBinding") or {}).get("elementId")}
        for bx in boxes:
            if bx["id"] in ends: continue
            x0, y0, x1, y1 = bb(bx)
            for (p, q) in zip(pts, pts[1:]):
                # sample along segment
                for t in [i / 20 for i in range(1, 20)]:
                    px, py = p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t
                    if x0 + 2 < px < x1 - 2 and y0 + 2 < py < y1 - 2:
                        tb = byid[[x for x in bx["boundElements"] if x["type"]=="text"][0]["id"]]["text"].split("\n")[0]
                        print("  ARROW THROUGH", tb, "arrow", ar["id"]); break
                else: continue
                break
# boxes must sit fully inside the zone that holds their centre
zones = [e for e in els if e["type"] == "rectangle" and not e["boundElements"] and e.get("roughness") == 0 and e.get("strokeWidth") == 1]
for b in [e for e in els if e["type"] in ("rectangle", "diamond") and any(x["type"] == "text" for x in e["boundElements"])]:
    cx, cy = b["x"] + b["width"] / 2, b["y"] + b["height"] / 2
    for z in zones:
        if z["x"] < cx < z["x"] + z["width"] and z["y"] < cy < z["y"] + z["height"]:
            if b["x"] < z["x"] or b["y"] < z["y"] + 30 or b["x"] + b["width"] > z["x"] + z["width"] or b["y"] + b["height"] > z["y"] + z["height"]:
                t = byid[[x for x in b["boundElements"] if x["type"]=="text"][0]["id"]]["text"].split("\n")[0]
                print("  SPILLS OUT OF ZONE", t)
