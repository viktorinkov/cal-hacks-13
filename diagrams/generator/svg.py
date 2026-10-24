"""Export every frame of the scene as its own SVG: python svg.py scene.excalidraw out_dir name1 name2 ..."""
import json
import pathlib
import sys

from playwright.sync_api import sync_playwright

scene = json.loads(open(sys.argv[1]).read())
out = pathlib.Path(sys.argv[2])
names = sys.argv[3:]
frames = [e for e in scene["elements"] if e["type"] == "frame"]
frames.sort(key=lambda f: (f["y"], f["x"]))
assert len(frames) == len(names), f"{len(frames)} frames, {len(names)} names"
out.mkdir(parents=True, exist_ok=True)

JS = """async ({scene, frameId}) => {
  const { exportToSvg } = await import("https://esm.sh/@excalidraw/excalidraw@0.18.0?bundle-deps");
  const frame = scene.elements.find(e => e.id === frameId);
  const svg = await exportToSvg({
    elements: scene.elements, files: scene.files || {}, exportingFrame: frame,
    appState: { ...scene.appState, exportBackground: true, exportWithDarkMode: false, exportEmbedScene: false },
  });
  return svg.outerHTML;
}"""

with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome")
    page = browser.new_page()
    page.goto("https://esm.sh/")
    for f, name in zip(frames, names):
        svg = page.evaluate(JS, {"scene": scene, "frameId": f["id"]})
        (out / f"{name}.svg").write_text(svg)
        print(name, f["name"], len(svg))
    browser.close()
