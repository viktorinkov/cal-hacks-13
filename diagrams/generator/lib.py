"""Tiny Excalidraw scene builder: boxes with bound labels, bound arrows, zones and frames."""
import json
import random
import textwrap

random.seed(13)

FONT = 5  # Excalifont
CHAR = 0.56  # average glyph width as a share of the font size
LINE = 1.25

KINDS = {
    #          fill       stroke
    "device": ("#ffd8a8", "#d9480f"),
    "rust": ("#ffc9c9", "#c92a2a"),
    "stdb": ("#bac8ff", "#364fc7"),
    "web": ("#a5d8ff", "#1864ab"),
    "ext": ("#96f2d7", "#087f5b"),
    "tbd": ("#f1f3f5", "#868e96"),
    "note": ("#fff3bf", "#e67700"),
    "bad": ("#ffe3e3", "#c92a2a"),
    "good": ("#d3f9d8", "#2b8a3e"),
}
ZONES = {
    "device": ("#fff4e6", "#d9480f"),
    "rust": ("#fff5f5", "#c92a2a"),
    "stdb": ("#edf2ff", "#364fc7"),
    "web": ("#e7f5ff", "#1864ab"),
    "ext": ("#e6fcf5", "#087f5b"),
    "tbd": ("#f8f9fa", "#868e96"),
    "plain": ("#f8f9fa", "#495057"),
}


def wrap(text, width, fs):
    per_line = max(8, int((width - 36) / (fs * CHAR)))
    lines = []
    for para in text.split("\n"):
        lines.extend(textwrap.wrap(para, per_line) or [""])
    return lines


def measure(label, w, fs=20, shape="rectangle"):
    lines = wrap(label, w * (0.62 if shape == "diamond" else 1), fs)
    _, th = text_size(lines, fs)
    return max(64, th * 2 + 50 if shape == "diamond" else th + 34)


def text_size(lines, fs):
    # element width is generous on purpose: Excalidraw clips glyphs past the element's width
    return max(len(l) for l in lines) * fs * 0.64 + 4, len(lines) * fs * LINE


class Box:
    def __init__(self, el):
        self.el = el

    @property
    def id(self):
        return self.el["id"]

    def __getattr__(self, k):
        if k in ("x", "y", "width", "height"):
            return self.el[k]
        raise AttributeError(k)

    @property
    def w(self):
        return self.el["width"]

    @property
    def h(self):
        return self.el["height"]

    @property
    def bottom(self):
        return self.y + self.h

    @property
    def right(self):
        return self.x + self.w

    @property
    def cx(self):
        return self.x + self.w / 2

    @property
    def cy(self):
        return self.y + self.h / 2

    def side(self, s, f=0.5):
        if s == "r":
            return (self.right, self.y + self.h * f)
        if s == "l":
            return (self.x, self.y + self.h * f)
        if s == "t":
            return (self.x + self.w * f, self.y)
        return (self.x + self.w * f, self.bottom)


class Scene:
    def __init__(self):
        self.elements = []
        self.ox = 0
        self.oy = 0
        self.frame_id = None
        self.frame_children = []
        self.n = 0
        self.back_ids = []

    def uid(self, p):
        self.n += 1
        return f"{p}{self.n}"

    def base(self, typ, x, y, w, h, **kw):
        el = {
            "id": kw.pop("id", None) or self.uid(typ[:2]),
            "type": typ,
            "x": x,
            "y": y,
            "width": w,
            "height": h,
            "angle": 0,
            "strokeColor": "#1e1e1e",
            "backgroundColor": "transparent",
            "fillStyle": "solid",
            "strokeWidth": 2,
            "strokeStyle": "solid",
            "roughness": 1,
            "opacity": 100,
            "groupIds": [],
            "frameId": self.frame_id,
            "roundness": None,
            "seed": random.randint(1, 2**31 - 1),
            "version": 1,
            "versionNonce": random.randint(1, 2**31 - 1),
            "isDeleted": False,
            "boundElements": [],
            "updated": 1792828800000,
            "link": None,
            "locked": False,
        }
        el.update(kw)
        self.elements.append(el)
        return el

    # frames ---------------------------------------------------------------
    def begin_frame(self, name, x, y, w, h):
        self.ox, self.oy = x, y
        fid = self.uid("frame")
        self.frame_id = fid
        self._frame = dict(id=fid, name=name, x=x, y=y, w=w, h=h)
        self._start = len(self.elements)
        self.back_ids = []

    def end_frame(self):
        f = self._frame
        self.frame_id = None
        mine = self.elements[self._start:]
        back = [e for e in mine if e["id"] in self.back_ids]
        front = [e for e in mine if e["id"] not in self.back_ids]
        self.elements[self._start:] = back + front

        def right(e):
            return e["x"] + (max(p[0] for p in e["points"]) if "points" in e else e["width"])

        def bottom(e):
            return e["y"] + (max(p[1] for p in e["points"]) if "points" in e else e["height"])

        w = max(f["w"], max(right(e) for e in mine) - f["x"] + 40)
        h = max(f["h"], max(bottom(e) for e in mine) - f["y"] + 40)
        self.base("frame", f["x"], f["y"], w, h, id=f["id"], name=f["name"],
                  strokeColor="#bbbbbb", strokeWidth=1, roughness=0)
        self.ox = self.oy = 0
        return h

    # primitives -----------------------------------------------------------
    def text(self, x, y, s, fs=18, color="#1e1e1e", width=None, align="left", cap=None):
        lines = wrap(s, width, fs) if width else s.split("\n")
        tw, th = text_size(lines, fs)
        if cap:
            tw = min(tw, cap)
        body = "\n".join(lines)
        return self.base("text", self.ox + x, self.oy + y, tw, th, strokeColor=color, text=body,
                         originalText=body, fontSize=fs, fontFamily=FONT, textAlign=align,
                         verticalAlign="top", containerId=None, autoResize=True, lineHeight=LINE)

    def zone(self, x, y, w, h, label, kind="plain", fs=22, dashed=False):
        fill, stroke = ZONES[kind]
        rect = self.base("rectangle", self.ox + x, self.oy + y, w, h, backgroundColor=fill, strokeColor=stroke,
                         strokeWidth=1, strokeStyle="dashed" if dashed else "solid", roundness={"type": 3}, roughness=0)
        label_el = self.text(x + 18, y + 12, label, fs=fs, color=stroke, width=w - 20)
        self.back_ids += [rect["id"], label_el["id"]]
        return Box(rect)

    def panel(self, x, y, w, title, body, kind="note", fs=20):
        """A filled card with a title and left-aligned body lines (not bound, so lists stay readable)."""
        fill, stroke = KINDS[kind]
        t_lines = wrap(title, w - 10, 22)
        b_lines = []
        for para in body.split("\n"):
            b_lines.extend(wrap(para, w - 10, fs))
        _, th = text_size(t_lines, 22)
        _, bh = text_size(b_lines, fs)
        h = 24 + th + 14 + bh + 24
        rect = self.base("rectangle", self.ox + x, self.oy + y, w, h, backgroundColor=fill, strokeColor=stroke,
                         roundness={"type": 3})
        self.text(x + 22, y + 24, "\n".join(t_lines), fs=22, color=stroke, cap=w - 30)
        self.text(x + 22, y + 24 + th + 14, "\n".join(b_lines), fs=fs, cap=w - 30)
        return Box(rect)

    def box(self, x, y, w, label, kind="stdb", h=None, fs=20, shape="rectangle", dashed=None, cy=None):
        """x, y local; cy (local centre y) overrides y once the height is known."""
        fill, stroke = KINDS[kind]
        if dashed is None:
            dashed = kind == "tbd"
        inner_w = w * (0.62 if shape == "diamond" else 1)
        lines = wrap(label, inner_w, fs)
        tw, th = text_size(lines, fs)
        if h is None:
            h = th + 34
            if shape == "diamond":
                h = th * 2 + 50
        h = max(h, 64)
        if cy is not None:
            y = cy - h / 2
        rid = self.uid("bx")
        tid = self.uid("tx")
        rect = self.base(shape, self.ox + x, self.oy + y, w, h, id=rid, backgroundColor=fill, strokeColor=stroke,
                         strokeStyle="dashed" if dashed else "solid",
                         roundness={"type": 3} if shape == "rectangle" else {"type": 2},
                         boundElements=[{"type": "text", "id": tid}])
        body = "\n".join(lines)
        tw = min(tw, w - 8)
        self.base("text", self.ox + x + (w - tw) / 2, self.oy + y + (h - th) / 2, tw, th, id=tid,
                  strokeColor="#1e1e1e", text=body, originalText=body, fontSize=fs, fontFamily=FONT,
                  textAlign="center", verticalAlign="middle", containerId=rid, autoResize=True, lineHeight=LINE)
        return Box(rect)

    def arrow(self, a, b, pts, label=None, dashed=False, both=False, color="#343a40", fs=16, head="arrow"):
        """pts: absolute scene points, first and last on the boxes' edges."""
        x0, y0 = pts[0]
        rel = [[px - x0, py - y0] for px, py in pts]
        xs = [p[0] for p in rel]
        ys = [p[1] for p in rel]
        aid = self.uid("ar")
        el = self.base("arrow", x0, y0, max(xs) - min(xs), max(ys) - min(ys), id=aid, points=rel,
                       strokeColor=color, strokeStyle="dashed" if dashed else "solid",
                       roundness={"type": 2} if len(pts) == 2 else None,
                       lastCommittedPoint=None, startArrowhead="arrow" if both else None,
                       endArrowhead=head, elbowed=False,
                       startBinding={"elementId": a.id, "focus": 0, "gap": 6} if a else None,
                       endBinding={"elementId": b.id, "focus": 0, "gap": 6} if b else None)
        for box in (a, b):
            if box:
                box.el["boundElements"].append({"type": "arrow", "id": aid})
        if label:
            n = len(pts)
            if n % 2:
                mx, my = pts[n // 2]
            else:
                (ax, ay), (bx, by) = pts[n // 2 - 1], pts[n // 2]
                mx, my = (ax + bx) / 2, (ay + by) / 2
            lines = label.split("\n")
            tw, th = text_size(lines, fs)
            tid = self.uid("lb")
            el["boundElements"].append({"type": "text", "id": tid})
            self.base("text", mx - tw / 2, my - th / 2, tw, th, id=tid, strokeColor=color, text=label,
                      originalText=label, fontSize=fs, fontFamily=FONT, textAlign="center",
                      verticalAlign="middle", containerId=aid, autoResize=True, lineHeight=LINE)
        return el

    # helpers in frame-local coordinates -------------------------------------
    def P(self, x, y):
        return (self.ox + x, self.oy + y)

    def link(self, a, sa, b, sb, label=None, fa=0.5, fb=0.5, via=(), **kw):
        """Arrow from side sa of a to side sb of b, through absolute waypoints via."""
        start = a.side(sa, fa)
        end = b.side(sb, fb)
        pts = [start] + list(via) + [end]
        return self.arrow(a, b, pts, label=label, **kw)

    def h(self, a, b, y=None, **kw):
        """Straight horizontal arrow at absolute height y (default: middle of the overlap)."""
        if y is None:
            y = (max(a.y, b.y) + min(a.bottom, b.bottom)) / 2
        sa, sb = ("r", "l") if a.right <= b.x else ("l", "r")
        return self.link(a, sa, b, sb, fa=(y - a.y) / a.h, fb=(y - b.y) / b.h, **kw)

    def v(self, a, b, x=None, **kw):
        """Straight vertical arrow at absolute x (default: middle of the overlap)."""
        if x is None:
            x = (max(a.x, b.x) + min(a.right, b.right)) / 2
        sa, sb = ("b", "t") if a.bottom <= b.y else ("t", "b")
        return self.link(a, sa, b, sb, fa=(x - a.x) / a.w, fb=(x - b.x) / b.w, **kw)

    def scene(self):
        return {
            "type": "excalidraw",
            "version": 2,
            "source": "https://excalidraw.com",
            "elements": self.elements,
            "appState": {"viewBackgroundColor": "#ffffff", "gridSize": None},
            "files": {},
        }

    def dump(self, path):
        with open(path, "w") as f:
            json.dump(self.scene(), f, indent=1)
