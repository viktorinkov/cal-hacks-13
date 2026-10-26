"""Build one editable product illustration without app screenshots.

The catalog PNG stays unchanged. Native Excalidraw shapes illustrate the photo
and printed-line layers the browser composes over its reserved image area.
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "diagrams/generator"))
from lib import Scene

OUT = pathlib.Path(__file__).resolve().parent
s = Scene()
s.begin_frame("Your photo on your merch", 0, 0, 1510, 770)


def rect(x, y, w, h, fill, radius=True, stroke="transparent"):
    return s.base("rectangle", x, y, w, h, backgroundColor=fill,
                  strokeColor=stroke, strokeWidth=0 if stroke == "transparent" else 1,
                  roughness=0, roundness={"type": 3} if radius else None)


def ellipse(x, y, w, h, fill):
    return s.base("ellipse", x, y, w, h, backgroundColor=fill,
                  strokeColor="transparent", strokeWidth=0, roughness=0)


def text(x, y, body, fs=27, color="#233449", center=False):
    lines = body.split("\n")
    w = max(len(line) for line in lines) * fs * 0.64 + 4
    return s.base("text", x-w/2 if center else x, y, w, len(lines)*fs*1.25,
                  text=body, originalText=body, fontSize=fs, fontFamily=5,
                  textAlign="center" if center else "left", verticalAlign="top",
                  autoResize=True, containerId=None, lineHeight=1.25,
                  strokeColor=color, roughness=0)


def arrow(x1, y1, x2, y2):
    s.base("arrow", x1, y1, abs(x2-x1), abs(y2-y1),
           points=[[0, 0], [x2-x1, y2-y1]], strokeColor="#67748a",
           strokeWidth=3, roughness=0, startArrowhead=None,
           endArrowhead="triangle", startBinding=None, endBinding=None,
           lastCommittedPoint=None, elbowed=False)


def photo(x, y, w, h):
    """An illustrative photo represented by editable shapes, never a UI capture."""
    first = len(s.elements)
    rect(x, y, w, h, "#dbe8f5", False)
    rect(x, y+h*.61, w, h*.39, "#b0c9d5", False)
    rect(x+w*.06, y+h*.07, w*.88, h*.16, "#7b63a1", False)
    for px, shirt, skin, offset in ((.24,"#e7895d","#b77955",.03),
                                  (.50,"#526fad","#e0b68e",0),
                                  (.76,"#5c9c86","#754c3b",.03)):
        cy = y+h*(.29+offset)
        ellipse(x+w*(px-.069), cy, w*.138, h*.22, skin)
        rect(x+w*(px-.105), cy+h*.24, w*.21, h*.43, shirt)
        rect(x+w*(px-.075), cy+h*.56, w*.06, h*.10, "#43536d", False)
        rect(x+w*(px+.015), cy+h*.56, w*.06, h*.10, "#43536d", False)
    group_id = f"merch_illustrated_photo_{len(s.elements)}"
    for element in s.elements[first:]:
        element["groupIds"] = [group_id]
        element["customData"] = {"illustration": "Event photo illustration; not an actual photo or UI capture."}


# Input group: the photo arrives from the separately documented photo-matching flow.
rect(30, 30, 400, 690, "#e8f1fb")
text(60, 55, "Your event", 32)
photo(60, 115, 340, 225)
text(230, 365, "A photo tagged to you", 25, center=True)
rect(60, 445, 340, 225, "#d7e6f6")
text(230, 466, "Your booth visits", 27, center=True)
s.image(188, 526, ROOT / "diagrams/logos/icon-store.svg", 83)
text(230, 624, "Figma, for example", 23, center=True)

arrow(445, 370, 485, 370)

# One product, with a current catalog asset and the actual preview layers.
rect(500, 30, 640, 690, "#fff0e1")
text(820, 55, "A personal merch suggestion", 31, center=True)
shirt_x, shirt_y, shirt_size = 560, 111, 520
s.image(shirt_x, shirt_y, ROOT / "assets/merch/tee_figma.png", shirt_size)
slot = json.loads((ROOT / "assets/merch/templates.json").read_text())["templates"]["tee_figma.png"]["photo_area"]
scale = shirt_size/1024
# Match recap.ts's 2px overlap around the slot so no green shows at its edge.
px = shirt_x + (slot["x"]-2)*scale
py = shirt_y + (slot["y"]-2)*scale
pw = (slot["w"]+4)*scale
ph = (slot["h"]+4)*scale
photo(px, py, pw, ph)
strip = slot["h"]*.17*scale
rect(shirt_x+slot["x"]*scale, shirt_y+(slot["y"]+slot["h"])*scale-strip,
     slot["w"]*scale, strip, "#354050", False)
text(shirt_x+(slot["x"]+slot["w"]/2)*scale,
     shirt_y+(slot["y"]+slot["h"])*scale-strip+2,
     "Good ideas. Great company.", 8.5, "#ffffff", True)
text(820, 644, "A prepared design with your\nphoto and a short line", 25, center=True)

arrow(1155, 370, 1195, 370)

# Decision and checkout details stay inside the attendee's group.
rect(1210, 30, 270, 690, "#e4f3e9")
text(1345, 55, "You choose", 31, center=True)
s.image(1291, 126, ROOT / "diagrams/logos/icon-box.svg", 108)
text(1345, 273, "Preview first", 27, center=True)
for y, label in ((355, "Choose size"), (455, "Add address"), (555, "Buy")):
    rect(1235, y, 220, 70, "#cae6d4" if label != "Buy" else "#b5d9c4")
    text(1345, y+18, label, 26, center=True)

text(35, 739, "Illustration using an existing catalog design", 18, "#687487")
s.end_frame()
scene = s.scene()
# Avoid collisions when the integrator adds this frame to the canonical board.
for element in scene["elements"]:
    element["id"] = "merch_product_" + element["id"]
    if element.get("frameId"):
        element["frameId"] = "merch_product_" + element["frameId"]
    element["groupIds"] = ["merch_product_"+g for g in element.get("groupIds", [])]
    element["customData"] = {**element.get("customData", {}), "purpose": "product-merch-image-flow"}
(OUT / "merch-image-flow.excalidraw").write_text(json.dumps(scene, indent=1))
