import argparse
import base64
import json
import math
import os
import shutil
import struct
import sys
import time
from urllib.parse import quote

from elastic import ROOT, load_env

USAGE = """3D model of the venue: the Cal Hacks venue map's three.js scene, exported to GLB inside Bright Data's Browser API

  python3 pipeline/venue_model.py               -> var/venue-3d/brightdata/palace-interior/palace-interior.glb, screenshot.png
  python3 pipeline/venue_model.py --assets      also copy the GLB to web/venue/venue.glb

Needs pip install playwright (no browser download: it drives Bright Data's remote browser over CDP) and, in .env,
BRIGHTDATA_CUSTOMER_ID, BRIGHTDATA_BROWSER_ZONE and BRIGHTDATA_BROWSER_PASSWORD (the Browser API zone).

The map (palace-interior.vercel.app, embedded by hive.hackberkeley.org/venue-map) builds the hall in three.js from the
organizers' floor plans. Before the page loads, a hook stands in for the three.js devtools, which every Scene reports to
on construction. Once the canvas is up, the page flattens the largest captured scene into one mesh per material in
world coordinates (meters, y up; instances expanded, table numbers baked from their atlas, no lights), imports three's
GLTFExporter for the same three release and exports it as binary glTF. If the hook sees no scene, it is injected into
the HTML itself (page.route), then the embed URL is tried.
"""

URLS = ['https://palace-interior.vercel.app/', 'https://palace-interior.vercel.app/?view=3d&embed=1']
OUT = os.path.join(ROOT, 'var', 'venue-3d', 'brightdata', 'palace-interior')
ASSET = os.path.join(ROOT, 'web', 'venue', 'venue.glb')
CHUNK = 3 << 20

HOOK = """
window.__venueScenes = [];
window.__THREE_DEVTOOLS__ = new EventTarget();
window.__THREE_DEVTOOLS__.addEventListener('observe', e => { if (e.detail && e.detail.isScene) window.__venueScenes.push(e.detail); });
"""

EXPORT = """async () => {
  const meshes = s => { let n = 0; s.traverse(o => { if (o.isMesh) n++; }); return n; };
  const src = window.__venueScenes.reduce((a, b) => meshes(b) > meshes(a) ? b : a);
  const base = `https://cdn.jsdelivr.net/npm/three@0.${window.__THREE__}.0`;
  const THREE = await import(`${base}/+esm`);
  const { GLTFExporter } = await import(`${base}/examples/jsm/exporters/GLTFExporter.js/+esm`);

  // One mesh per material, in world coordinates (meters, y up): instances expanded, lights and helpers left out.
  src.updateMatrixWorld(true);
  const shown = o => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
  const groups = new Map();
  let objects = 0;
  src.traverse(o => {
    objects++;
    if (!(o.isMesh || o.isLine) || !shown(o) || !o.geometry?.attributes.position) return;
    const g = o.geometry;
    const ranges = Array.isArray(o.material)
      ? g.groups.map(r => [r.start, r.count, o.material[r.materialIndex]])
      : [[g.drawRange.start, g.drawRange.count, o.material]];
    // The table numbers pick their cell of a number atlas in a shader, from a per-instance 'cell' attribute.
    // Running the material's shader hook on a blank shader gives the cell size; the cell is then baked into the UVs.
    let cellSize = null;
    if (g.attributes.cell && o.material.onBeforeCompile) {
      const shader = { vertexShader: '', fragmentShader: '', uniforms: {} };
      o.material.onBeforeCompile(shader);
      cellSize = shader.uniforms.cellSize?.value;
    }
    const kind = o.isLineSegments ? 'segments' : o.isLine ? 'line' : 'mesh';
    for (let i = 0; i < (o.isInstancedMesh ? o.count : 1); i++) {
      const matrix = o.matrixWorld.clone();
      if (o.isInstancedMesh) { const m = new THREE.Matrix4(); o.getMatrixAt(i, m); matrix.multiply(m); }
      const tint = o.isInstancedMesh && o.instanceColor ? o.getColorAt(i, new THREE.Color()) : null;
      const cell = cellSize && [g.attributes.cell.getX(i), g.attributes.cell.getY(i)];
      for (const [start, count, material] of ranges) {
        if (!material) continue;
        const key = `${material.uuid}:${kind}`;
        if (!groups.has(key)) {
          const type = material.map ? 'textured' : material.type.replace(/^(Mesh|Line)|Material$/g, '').toLowerCase();
          const name = cellSize ? 'table-numbers' : `${type}-${material.color ? material.color.getHexString() : 'ffffff'}`;
          groups.set(key, { name, material, kind, parts: [] });
        }
        groups.get(key).parts.push({ g, matrix, tint, cell, cellSize, start, count, colors: material.vertexColors && g.attributes.color });
      }
    }
  });

  const out = new THREE.Scene();
  const v = new THREE.Vector3(), nm = new THREE.Matrix3();
  let vertices = 0, tableNumbers = 0;
  for (const grp of groups.values()) {
    const span = p => {
      const n = p.g.index ? p.g.index.count : p.g.attributes.position.count, s = Math.min(p.start, n);
      return [s, Math.min(p.count, n - s)];
    };
    let nv = 0, ni = 0;
    for (const p of grp.parts) { nv += p.g.index ? p.g.attributes.position.count : span(p)[1]; ni += span(p)[1]; }
    const pos = new Float32Array(nv * 3);
    const nor = grp.parts.every(p => p.g.attributes.normal) && new Float32Array(nv * 3);
    const uv = grp.parts.some(p => p.g.attributes.uv) && new Float32Array(nv * 2);
    const col = grp.parts.some(p => p.tint || p.colors) && new Float32Array(nv * 3).fill(1);
    const idx = new Uint32Array(ni);
    let vo = 0, io = 0;
    for (const p of grp.parts) {
      const a = p.g.attributes, [s, c] = span(p);
      const first = p.g.index ? 0 : s, n = p.g.index ? a.position.count : c;
      nm.getNormalMatrix(p.matrix);
      for (let j = 0; j < n; j++) {
        const k = first + j, w = vo + j;
        v.fromBufferAttribute(a.position, k).applyMatrix4(p.matrix);
        pos[w * 3] = v.x; pos[w * 3 + 1] = v.y; pos[w * 3 + 2] = v.z;
        if (nor) {
          v.fromBufferAttribute(a.normal, k).applyMatrix3(nm).normalize();
          nor[w * 3] = v.x; nor[w * 3 + 1] = v.y; nor[w * 3 + 2] = v.z;
        }
        if (uv && a.uv) {
          let x = a.uv.getX(k), y = a.uv.getY(k);
          if (p.cell) { x = (x + p.cell[0]) * p.cellSize.x; y = (y + p.cell[1]) * p.cellSize.y; }
          uv[w * 2] = x; uv[w * 2 + 1] = y;
        }
        if (col) {
          let r = 1, gr = 1, b = 1;
          if (p.colors) { r = p.colors.getX(k); gr = p.colors.getY(k); b = p.colors.getZ(k); }
          if (p.tint) { r *= p.tint.r; gr *= p.tint.g; b *= p.tint.b; }
          col[w * 3] = r; col[w * 3 + 1] = gr; col[w * 3 + 2] = b;
        }
      }
      for (let j = 0; j < c; j++) idx[io + j] = vo + (p.g.index ? p.g.index.getX(s + j) : j);
      vo += n; io += c;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    if (nor) geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    if (uv) geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    if (col) geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    const Kind = { segments: THREE.LineSegments, line: THREE.Line, mesh: THREE.Mesh }[grp.kind];
    const mesh = new Kind(geo, grp.material);
    mesh.name = grp.name;
    out.add(mesh);
    vertices += nv;
    if (grp.name === 'table-numbers') tableNumbers = ni / 6;
  }

  // Render-target textures (shadows, reflections) have no pixels to embed; leave them out for the export.
  const drawable = t => { const i = t.image; return i && (i.data || i instanceof HTMLImageElement || i instanceof HTMLCanvasElement || i instanceof ImageBitmap || (typeof OffscreenCanvas < 'u' && i instanceof OffscreenCanvas)); };
  const detached = [];
  out.traverse(o => [].concat(o.material || []).forEach(m => Object.keys(m).forEach(k => {
    if (m[k] && m[k].isTexture && !drawable(m[k])) { detached.push([m, k, m[k]]); m[k] = null; }
  })));
  try {
    const glb = new Uint8Array(await new GLTFExporter().parseAsync(out, { binary: true }));
    window.__venueGlb = glb;
    return { revision: window.__THREE__, scenes: window.__venueScenes.length, objects, meshes: out.children.length, vertices, tableNumbers, bytes: glb.length, detached: detached.length };
  } finally {
    detached.forEach(([m, k, t]) => { m[k] = t; });
  }
}"""

SLICE = """([from, to]) => {
  const part = window.__venueGlb.subarray(from, to);
  let s = '';
  for (let i = 0; i < part.length; i += 0x8000) s += String.fromCharCode.apply(null, part.subarray(i, i + 0x8000));
  return btoa(s);
}"""


def cdp_url():
    load_env()
    need = ['BRIGHTDATA_CUSTOMER_ID', 'BRIGHTDATA_BROWSER_ZONE', 'BRIGHTDATA_BROWSER_PASSWORD']
    missing = [k for k in need if not os.environ.get(k)]
    if missing:
        raise SystemExit(f'{", ".join(missing)} must be set in .env')
    cid, zone, pw = (os.environ[k].strip('"\'') for k in need)
    return f'wss://brd-customer-{cid}-zone-{zone}:{quote(pw, safe="")}@brd.superproxy.io:9222', zone


def inject(route):
    res = route.fetch()
    html = res.text().replace('<head>', f'<head><script>{HOOK}</script>', 1)
    route.fulfill(response=res, body=html)


def load(page, url, wait):
    page.goto(url, wait_until='domcontentloaded', timeout=120000)
    page.wait_for_selector('canvas', timeout=60000)
    end = time.time() + wait
    while time.time() < end:
        if page.evaluate('() => (window.__venueScenes || []).length'):
            # Let the plan textures and the rest of the hall load before exporting.
            page.wait_for_timeout(8000)
            return True
        page.wait_for_timeout(1000)
    return False


def capture(browser, wait):
    """Open the map until a Scene is captured; return (page, method)."""
    for url in URLS:
        for method in ('init-script', 'route'):
            page = browser.new_page(viewport={'width': 1600, 'height': 900})
            if method == 'init-script':
                page.add_init_script(HOOK)
            else:
                page.route(lambda u: u.split('?')[0] in [x.split('?')[0] for x in URLS], inject)
            ok = load(page, url, wait)
            print(f'venue_model: {method} on {url}: {"scene captured" if ok else "no scene"}')
            if ok:
                return page, f'{method} on {url}'
            page.close()
    raise SystemExit('venue_model: the map never built a three.js scene')


def mat_mul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]


def node_matrix(n):
    if 'matrix' in n:
        m = n['matrix']
        return [[m[c * 4 + r] for c in range(4)] for r in range(4)]
    tx, ty, tz = n.get('translation', [0, 0, 0])
    x, y, z, w = n.get('rotation', [0, 0, 0, 1])
    sx, sy, sz = n.get('scale', [1, 1, 1])
    r = [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
         [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
         [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]
    return [[r[0][0] * sx, r[0][1] * sy, r[0][2] * sz, tx],
            [r[1][0] * sx, r[1][1] * sy, r[1][2] * sz, ty],
            [r[2][0] * sx, r[2][1] * sy, r[2][2] * sz, tz],
            [0, 0, 0, 1]]


def inspect(path):
    """Check the GLB header and summarise its JSON chunk; the box ignores GPU instancing offsets."""
    data = open(path, 'rb').read()
    magic, version, length = struct.unpack_from('<4sII', data, 0)
    if magic != b'glTF' or version != 2 or length != len(data):
        raise SystemExit(f'venue_model: {path} is not a glTF 2 binary ({magic!r}, v{version}, {length} vs {len(data)} bytes)')
    size, kind = struct.unpack_from('<I4s', data, 12)
    gltf = json.loads(data[20:20 + size])
    lo, hi = [math.inf] * 3, [-math.inf] * 3

    def walk(i, parent):
        n = gltf['nodes'][i]
        m = mat_mul(parent, node_matrix(n))
        if 'mesh' in n:
            for p in gltf['meshes'][n['mesh']]['primitives']:
                acc = gltf['accessors'][p['attributes']['POSITION']]
                a, b = acc['min'], acc['max']
                for c in ((x, y, z) for x in (a[0], b[0]) for y in (a[1], b[1]) for z in (a[2], b[2])):
                    w = [sum(m[r][k] * v for k, v in enumerate((*c, 1))) for r in range(3)]
                    for k in range(3):
                        lo[k], hi[k] = min(lo[k], w[k]), max(hi[k], w[k])
        for ch in n.get('children', []):
            walk(ch, m)

    eye = [[float(i == j) for j in range(4)] for i in range(4)]
    for s in gltf.get('scenes', []):
        for i in s.get('nodes', []):
            walk(i, eye)
    return {
        'bytes': len(data),
        'nodes': len(gltf.get('nodes', [])),
        'meshes': len(gltf.get('meshes', [])),
        'primitives': sum(len(m['primitives']) for m in gltf.get('meshes', [])),
        'materials': len(gltf.get('materials', [])),
        'textures': len(gltf.get('textures', [])),
        'images': len(gltf.get('images', [])),
        'extensions': gltf.get('extensionsUsed', []),
        'bbox_min': [round(v, 2) for v in lo],
        'bbox_max': [round(v, 2) for v in hi],
        'size': [round(h - l, 2) for l, h in zip(lo, hi)],
    }


def main():
    ap = argparse.ArgumentParser(description=USAGE, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--out', default=OUT)
    ap.add_argument('--wait', type=int, default=60, help='seconds to wait for the scene after the canvas appears')
    ap.add_argument('--assets', action='store_true', help=f'also copy the GLB to {os.path.relpath(ASSET, ROOT)} (under 20 MB)')
    args = ap.parse_args()
    from playwright.sync_api import sync_playwright

    url, zone = cdp_url()
    os.makedirs(args.out, exist_ok=True)
    glb_path = os.path.join(args.out, 'palace-interior.glb')
    t0 = time.time()
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(url, timeout=120000)
        try:
            page, method = capture(browser, args.wait)
            page.screenshot(path=os.path.join(args.out, 'screenshot.png'))
            info = page.evaluate(EXPORT)
            print(f'venue_model: exported {info}')
            with open(glb_path, 'wb') as f:
                for start in range(0, info['bytes'], CHUNK):
                    f.write(base64.b64decode(page.evaluate(SLICE, [start, min(start + CHUNK, info['bytes'])])))
        finally:
            browser.close()
    summary = inspect(glb_path)
    summary.update(method=method, zone=zone, seconds=round(time.time() - t0, 1), three=f'r{info["revision"]}')
    json.dump(summary, open(os.path.join(args.out, 'palace-interior.glb.json'), 'w'), indent=1)
    print(f'venue_model: {os.path.relpath(glb_path, ROOT)} {summary["bytes"]} bytes, {summary["nodes"]} nodes, '
          f'{summary["meshes"]} meshes, {summary["materials"]} materials, {summary["images"]} images, '
          f'box {summary["size"]} ({summary["method"]}, zone {zone}, {summary["seconds"]} s)')
    if args.assets:
        if summary['bytes'] >= 20 << 20:
            sys.exit(f'venue_model: {summary["bytes"]} bytes is over 20 MB, not copied to assets')
        os.makedirs(os.path.dirname(ASSET), exist_ok=True)
        shutil.copyfile(glb_path, ASSET)
        print(f'venue_model: copied to {os.path.relpath(ASSET, ROOT)}')


if __name__ == '__main__':
    main()
