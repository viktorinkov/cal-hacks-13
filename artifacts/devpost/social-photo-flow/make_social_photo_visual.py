"""Product illustration: context-based photo matching, not facial identity."""
import base64
import html
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
OUT = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "diagrams/generator"))
from lib import Scene

INK = "#24333d"
MUTED = "#4d6169"
s = Scene()
s.begin_frame("How your photos find you", 0, 0, 1600, 875)
svg = ['<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="875" viewBox="0 0 1600 875">', '<rect width="1600" height="875" fill="#ffffff"/>']

def rect(x, y, w, h, fill, stroke="transparent", radius=20):
    element = s.base("rectangle", x, y, w, h, backgroundColor=fill, strokeColor=stroke,
                     strokeWidth=1, roughness=0, roundness={"type": 3})
    svg.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{radius}" fill="{fill}" stroke="{stroke}"/>')
    return element

def text(x, y, body, size=28, color=INK, center=False):
    lines = body.split("\n")
    width = max(map(len, lines)) * size * .64 + 4
    s.base("text", x-width/2 if center else x, y, width, len(lines)*size*1.25,
           text=body, originalText=body, fontSize=size, fontFamily=5,
           textAlign="center" if center else "left", verticalAlign="top", containerId=None,
           autoResize=True, lineHeight=1.25, strokeColor=color, roughness=0)
    for i, line in enumerate(lines):
        svg.append(f'<text x="{x}" y="{y+size+i*size*1.25}" fill="{color}" font-family="Arial, sans-serif" font-size="{size}" text-anchor="{"middle" if center else "start"}">{html.escape(line)}</text>')

def arrow(x1, y, x2):
    s.base("arrow", x1, y, x2-x1, 0, points=[[0, 0], [x2-x1, 0]],
           strokeColor="#526f78", strokeWidth=4, roughness=0, startArrowhead=None,
           endArrowhead="triangle", startBinding=None, endBinding=None,
           lastCommittedPoint=None, elbowed=False)
    svg.append(f'<path d="M{x1} {y} H{x2-12}" fill="none" stroke="#526f78" stroke-width="4"/><path d="M{x2-15} {y-8} L{x2} {y} L{x2-15} {y+8} Z" fill="#526f78"/>')

def person(x, y, color, scale=1):
    return f'<g transform="translate({x} {y}) scale({scale})"><circle cx="0" cy="16" r="16" fill="#b77b60"/><path d="M-23 53 Q-23 37 0 37 Q23 37 23 53 V98 H-23 Z" fill="{color}"/><path d="M-13 96 V132 M13 96 V132" stroke="#33464d" stroke-width="14" stroke-linecap="round"/><path d="M-22 51 L-33 92 M22 51 L33 92" stroke="#b77b60" stroke-width="12" stroke-linecap="round"/><path d="M-33 81 L-30 72" stroke="#1f746a" stroke-width="8" stroke-linecap="round"/></g>'

def picture():
    return '<rect x="15" y="15" width="370" height="218" rx="18" fill="#fffdf8"/><path d="M15 190 H385 V215 Q385 233 367 233 H33 Q15 233 15 215 Z" fill="#d9e5d2"/><rect x="90" y="38" width="220" height="35" rx="6" fill="#e6c17b"/>' + person(135, 86, "#428a98", .75) + person(205, 78, "#9b709b", .82) + person(280, 90, "#d68c56", .73)

def art(name, contents, viewbox, x, y, h):
    path = OUT / name
    content = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{viewbox}" width="400" height="250">{contents}</svg>'
    path.write_text(content)
    el = s.image(x, y, path, h)
    encoded = base64.b64encode(content.encode()).decode()
    svg.append(f'<image x="{x}" y="{y}" width="{el["width"]}" height="{h}" href="data:image/svg+xml;base64,{encoded}"/>')

# Three native, colored parent groups. Property cells stay inside their group.
rect(40, 40, 460, 600, "#e7f2f7")
rect(570, 40, 460, 600, "#f3edf8")
rect(1100, 40, 460, 600, "#e8f4ed")
text(270, 64, "Photographer", 35, center=True)
text(800, 64, "Memories engine", 35, center=True)
text(1330, 64, "Your recap", 35, center=True)

# Original, filled vector artwork. No app UI is embedded.
capture = picture() + '<rect x="10" y="129" width="92" height="65" rx="13" fill="#334c57"/><path d="M22 130 L32 113 H67 L80 130" fill="#334c57"/><circle cx="57" cy="160" r="24" fill="#e4f1f4"/><circle cx="57" cy="160" r="14" fill="#427c8b"/><circle cx="84" cy="143" r="5" fill="#f2c06c"/>'
art("photographer-illustration.svg", capture, "0 0 400 250", 60, 126, 260)
text(270, 403, "Add a photo", 31, center=True)
rect(70, 465, 400, 65, "#cfe3ee")
text(270, 479, "Choose its event area", 25, center=True)
rect(70, 547, 400, 65, "#cfe3ee")
text(270, 561, "Time is recorded when added", 23, center=True)

bands = '<ellipse cx="200" cy="134" rx="167" ry="92" fill="#dfd1ec"/><path d="M92 104 L200 164 L304 90" fill="none" stroke="#917aab" stroke-width="5" stroke-dasharray="8 8"/>'
for bx, by, color in ((92, 90, "#337d8e"), (200, 151, "#835d99"), (304, 75, "#bc7849")):
    bands += f'<g transform="translate({bx} {by})"><rect x="-20" y="-41" width="40" height="98" rx="20" fill="{color}"/><rect x="-30" y="-17" width="60" height="49" rx="16" fill="#f9fbfb"/><rect x="-19" y="-7" width="38" height="29" rx="8" fill="{color}"/><circle cx="0" cy="7" r="5" fill="#f4d783"/></g>'
art("nearby-bands-illustration.svg", bands, "0 0 400 250", 590, 126, 260)
text(800, 403, "Estimate who appears", 29, center=True)
rect(600, 465, 400, 65, "#e2d7ed")
text(800, 479, "Bands in that area and time", 23, center=True)
rect(600, 547, 400, 65, "#e2d7ed")
text(800, 561, "People count from the image", 23, center=True)

recap = '<rect x="0" y="0" width="400" height="250" rx="24" fill="#b8d9c8"/>' + picture()
art("recap-photo-illustration.svg", recap, "0 0 400 250", 1120, 126, 260)
text(1330, 403, "Find photos of your day", 29, center=True)
rect(1130, 465, 400, 65, "#cce5d7")
text(1330, 479, "Estimated tags and a caption", 23, center=True)
rect(1130, 547, 400, 65, "#cce5d7")
text(1330, 561, "New matches need Findable", 23, center=True)

arrow(512, 328, 558)
arrow(1042, 328, 1088)

rect(40, 680, 1520, 150, "#fff2d8")
text(80, 704, "Privacy by context", 30)
text(80, 756, "Band records suggest identities. Image analysis counts people, without face identification.", 25, MUTED)
s.end_frame()
scene = s.scene()
# Stable prefix lets the board integrator merge this scene without colliding with other IDs.
remap = {e["id"]: "social-photo-" + e["id"] for e in scene["elements"]}
for e in scene["elements"]:
    e["id"] = remap[e["id"]]
    if e.get("frameId"):
        e["frameId"] = remap[e["frameId"]]
    e.setdefault("customData", {})["productVisual"] = "social-photo-flow"
(OUT / "social-photo-flow.excalidraw").write_text(json.dumps(scene, indent=1))
svg.append("</svg>")
(OUT / "social-photo-flow.svg").write_text("\n".join(svg))
print(f"Wrote {len(scene['elements'])} elements and {len(scene['files'])} original illustrations")
