import argparse
import base64
import json
import math
import os
import shutil
import struct
import sys
import re
import time
from urllib.parse import quote, urljoin, urlparse

from elastic import ROOT, load_env

USAGE = """3D model of the venue: the Cal Hacks venue map's three.js scene, exported to GLB inside Bright Data's Browser API

  python3 pipeline/venue_model.py               -> var/venue-3d/brightdata/palace-interior/palace-interior.glb, screenshot.png
  python3 pipeline/venue_model.py --assets      also copy the GLB to web/venue/venue.glb
  python3 pipeline/venue_model.py --url URL --out DIR
                                                any venue's public 3D map page or model file -> DIR/model.glb,
                                                layout.json (named places with their boxes), summary.json, screenshot.png

Needs pip install playwright (no browser download: it drives Bright Data's remote browser over CDP) and, in .env,
BRIGHTDATA_CUSTOMER_ID, BRIGHTDATA_BROWSER_ZONE and BRIGHTDATA_BROWSER_PASSWORD (the Browser API zone). A model file
link (.glb, .gltf) is downloaded through the Web Unlocker instead: BRIGHTDATA_API_TOKEN and BRIGHTDATA_ZONE.

With --url, the page opens in Bright Data's browser with three catches in every frame: the three.js devtools hook,
any glTF file the page downloads, and a Babylon.js scene. A three.js scene is exported as above, a Babylon scene
through Babylon's own glTF serializer, and otherwise the largest glTF file the page loaded is kept as it is. The last
line printed is the summary as JSON.

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
MAX_BYTES = 100 << 20

HOOK = """
window.__venueScenes = [];
window.__THREE_DEVTOOLS__ = new EventTarget();
window.__THREE_DEVTOOLS__.addEventListener('observe', e => { if (e.detail && e.detail.isScene) window.__venueScenes.push(e.detail); });
"""

EXPORT = """async () => {
  const meshes = s => { let n = 0; s.traverse(o => { if (o.isMesh) n++; }); return n; };
  const src = window.__venueScenes.reduce((a, b) => meshes(b) > meshes(a) ? b : a);
  const base = `https://cdn.jsdelivr.net/npm/three@0.${parseInt(window.__THREE__)}.0`;
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

HOOK_ANY = HOOK + """
// glTF binaries the page downloads, by fetch or XHR, kept as they arrive (GLB magic 'glTF').
window.__venueFiles = [];
(() => {
  const keep = (url, buf) => {
    try {
      const u8 = new Uint8Array(buf);
      if (u8.length > 20 && u8[0] === 0x67 && u8[1] === 0x6c && u8[2] === 0x54 && u8[3] === 0x46) window.__venueFiles.push({ url: String(url), bytes: u8.slice() });
    } catch (e) {}
  };
  const ab = Response.prototype.arrayBuffer;
  Response.prototype.arrayBuffer = async function () { const b = await ab.call(this); keep(this.url, b); return b; };
  const open = XMLHttpRequest.prototype.open, send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) { this.__venueUrl = url; return open.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () {
    this.addEventListener('load', () => { if (this.response instanceof ArrayBuffer) keep(this.__venueUrl, this.response); });
    return send.apply(this, arguments);
  };
})();
"""

# What one frame has caught so far.
FOUND = """() => {
  const meshes = s => { let n = 0; s.traverse(o => { if (o.isMesh) n++; }); return n; };
  const three = (window.__venueScenes || []).reduce((n, s) => Math.max(n, meshes(s)), 0);
  const B = window.BABYLON, bs = B && ((B.EngineStore && B.EngineStore.LastCreatedScene) || (B.Engine && B.Engine.LastCreatedScene));
  const files = (window.__venueFiles || []).map(f => ({ url: f.url, bytes: f.bytes.length }));
  const models = performance.getEntriesByType('resource').map(r => r.name).filter(u => /\\.(glb|gltf)(\\?|#|$)/i.test(u));
  return { three, babylon: bs ? bs.meshes.length : 0, files, models, title: document.title };
}"""

# The frames and embeds a page shows, by address.
FRAMES = """() => [...document.querySelectorAll('iframe, embed, object')].map(f => f.src || f.data || '').filter(u => /^https?:/.test(u))"""

# Named places in the largest three.js scene, with their world boxes: object names, and text labels (troika Text).
PLACES = """() => {
  const meshes = s => { let n = 0; s.traverse(o => { if (o.isMesh) n++; }); return n; };
  const src = window.__venueScenes.reduce((a, b) => meshes(b) > meshes(a) ? b : a);
  src.updateMatrixWorld(true);
  const generic = /^(object|mesh|group|node|scene|root|rootnode|gltf|sketchfab_model|defaultmaterial|cube|plane)?[ _.-]*\\d*$/i;
  const shown = o => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
  const places = [], seen = new Set();
  const box = o => {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    o.traverse(m => {
      const g = m.geometry;
      if (!g || !g.attributes || !g.attributes.position) return;
      if (!g.boundingBox) g.computeBoundingBox();
      const b = g.boundingBox;
      for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
        const e = m.matrixWorld.elements, w = [e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]];
        for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], w[k]); hi[k] = Math.max(hi[k], w[k]); }
      }
    });
    return lo[0] <= hi[0] ? [lo, hi] : null;
  };
  const r = v => Math.round(v * 100) / 100;
  src.traverse(o => {
    if (places.length >= 2000 || o === src || !shown(o)) return;
    const label = typeof o.text === 'string' ? o.text.trim() : '';
    const name = label || (o.name || '').trim();
    if (!name || generic.test(name) || name.length > 120) return;
    const b = box(o);
    if (!b) return;
    const key = name + b[0].map(r).join();
    if (seen.has(key)) return;
    seen.add(key);
    places.push({ name, kind: label ? 'label' : o.type, min: b[0].map(r), max: b[1].map(r) });
  });
  return places;
}"""

# A Babylon scene through Babylon's glTF serializer for the same release; the GLB waits in window.__venueGlb.
BABYLON_EXPORT = """async () => {
  const B = window.BABYLON, scene = (B.EngineStore && B.EngineStore.LastCreatedScene) || B.Engine.LastCreatedScene;
  if (!B.GLTF2Export) {
    await new Promise((ok, fail) => {
      const s = document.createElement('script');
      s.src = `https://cdn.jsdelivr.net/npm/babylonjs-serializers@${B.Engine.Version}/babylonjs.serializers.min.js`;
      s.onload = ok; s.onerror = () => fail(new Error('could not load the Babylon serializer ' + B.Engine.Version));
      document.head.appendChild(s);
    });
  }
  const out = await B.GLTF2Export.GLBAsync(scene, 'venue', { shouldExportNode: n => !(n instanceof B.Light || n instanceof B.Camera) });
  const glb = new Uint8Array(await out.glTFFiles['venue.glb'].arrayBuffer());
  window.__venueGlb = glb;
  const r = v => Math.round(v * 100) / 100;
  const places = scene.meshes.filter(m => m.name && m.isEnabled() && m.isVisible && m.getTotalVertices() > 0).slice(0, 2000).map(m => {
    const b = m.getBoundingInfo().boundingBox;
    return { name: m.name, kind: 'mesh', min: [b.minimumWorld.x, b.minimumWorld.y, b.minimumWorld.z].map(r), max: [b.maximumWorld.x, b.maximumWorld.y, b.maximumWorld.z].map(r) };
  });
  return { revision: B.Engine.Version, meshes: scene.meshes.length, bytes: glb.length, places };
}"""

# The largest glTF binary the page downloaded, kept as it is.
FILE_PICK = """() => {
  const f = window.__venueFiles.reduce((a, b) => b.bytes.length > a.bytes.length ? b : a);
  window.__venueGlb = f.bytes;
  return { url: f.url, bytes: f.bytes.length };
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


GENERIC = re.compile(r'^(object|mesh|group|node|scene|root|rootnode|gltf|sketchfab_model|defaultmaterial|cube|plane)?[ _.-]*\d*$', re.I)


def inspect(path):
    """Check the GLB header and summarise its JSON chunk, with the named nodes as places; boxes ignore GPU instancing."""
    data = open(path, 'rb').read()
    magic, version, length = struct.unpack_from('<4sII', data, 0)
    if magic != b'glTF' or version != 2 or length != len(data):
        raise SystemExit(f'venue_model: {path} is not a glTF 2 binary ({magic!r}, v{version}, {length} vs {len(data)} bytes)')
    size, kind = struct.unpack_from('<I4s', data, 12)
    gltf = json.loads(data[20:20 + size])
    lo, hi = [math.inf] * 3, [-math.inf] * 3
    triangles = 0
    places = []

    def walk(i, parent):
        """The node's world box, its children's included, or None."""
        nonlocal triangles
        n = gltf['nodes'][i]
        m = mat_mul(parent, node_matrix(n))
        box_lo, box_hi = [math.inf] * 3, [-math.inf] * 3
        if 'mesh' in n:
            for p in gltf['meshes'][n['mesh']]['primitives']:
                acc = gltf['accessors'][p['attributes']['POSITION']]
                count = gltf['accessors'][p['indices']]['count'] if 'indices' in p else acc['count']
                mode = p.get('mode', 4)
                triangles += count // 3 if mode == 4 else max(count - 2, 0) if mode in (5, 6) else 0
                a, b = acc['min'], acc['max']
                for c in ((x, y, z) for x in (a[0], b[0]) for y in (a[1], b[1]) for z in (a[2], b[2])):
                    w = [sum(m[r][k] * v for k, v in enumerate((*c, 1))) for r in range(3)]
                    for k in range(3):
                        box_lo[k], box_hi[k] = min(box_lo[k], w[k]), max(box_hi[k], w[k])
        for ch in n.get('children', []):
            sub = walk(ch, m)
            if sub:
                for k in range(3):
                    box_lo[k], box_hi[k] = min(box_lo[k], sub[0][k]), max(box_hi[k], sub[1][k])
        if box_lo[0] > box_hi[0]:
            return None
        for k in range(3):
            lo[k], hi[k] = min(lo[k], box_lo[k]), max(hi[k], box_hi[k])
        name = (n.get('name') or '').strip()
        if name and not GENERIC.match(name) and len(places) < 2000:
            places.append({'name': name, 'kind': 'node', 'min': [round(v, 2) for v in box_lo], 'max': [round(v, 2) for v in box_hi]})
        return box_lo, box_hi

    eye = [[float(i == j) for j in range(4)] for i in range(4)]
    for s in gltf.get('scenes', []):
        for i in s.get('nodes', []):
            walk(i, eye)
    return {
        'bytes': len(data),
        'nodes': len(gltf.get('nodes', [])),
        'meshes': len(gltf.get('meshes', [])),
        'primitives': sum(len(m['primitives']) for m in gltf.get('meshes', [])),
        'triangles': triangles,
        'materials': len(gltf.get('materials', [])),
        'textures': len(gltf.get('textures', [])),
        'images': len(gltf.get('images', [])),
        'extensions': gltf.get('extensionsUsed', []),
        'bbox_min': [round(v, 2) for v in lo],
        'bbox_max': [round(v, 2) for v in hi],
        'size': [round(h - l, 2) for l, h in zip(lo, hi)],
    }, places


def env(*keys):
    load_env()
    missing = [k for k in keys if not os.environ.get(k)]
    if missing:
        raise SystemExit(f'{", ".join(missing)} must be set in .env')
    return [os.environ[k].strip('"\'') for k in keys]


def unlocker(url):
    """One file through Bright Data's Web Unlocker, as raw bytes."""
    import requests
    token, zone = env('BRIGHTDATA_API_TOKEN', 'BRIGHTDATA_ZONE')
    res = requests.post('https://api.brightdata.com/request', headers={'Authorization': f'Bearer {token}'},
                        json={'zone': zone, 'url': url, 'format': 'raw'}, timeout=300)
    target = res.headers.get('x-brd-status-code', '')
    if res.status_code != 200 or (target and not target.startswith('2')):
        raise SystemExit(f'venue_model: {url}: Bright Data answered {res.status_code}, the site {target or "?"}: {res.text[:200]}')
    print(f'venue_model: Web Unlocker {url}: {len(res.content)} bytes')
    return res.content


def image_type(data):
    if data[:8] == b'\x89PNG\r\n\x1a\n':
        return 'image/png'
    if data[:3] == b'\xff\xd8\xff':
        return 'image/jpeg'
    if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        return 'image/webp'
    if data[:12] == b'\xabKTX 20\xbb\r\n\x1a\n':
        return 'image/ktx2'
    return 'application/octet-stream'


def to_glb(gltf, binary):
    js = json.dumps(gltf, separators=(',', ':')).encode()
    js += b' ' * (-len(js) % 4)
    binary += b'\0' * (-len(binary) % 4)
    chunks = struct.pack('<I4s', len(js), b'JSON') + js
    if binary:
        chunks += struct.pack('<I4s', len(binary), b'BIN\0') + binary
    return struct.pack('<4sII', b'glTF', 2, 12 + len(chunks)) + chunks


def pack_gltf(url, text):
    """A .gltf and the buffers and images it points at, fetched next to it and packed into one GLB."""
    gltf = json.loads(text)
    fetch = lambda uri: base64.b64decode(uri.split(',', 1)[1]) if uri.startswith('data:') else unlocker(urljoin(url, uri))
    binary, starts = bytearray(), []
    for b in gltf.get('buffers', []):
        binary += b'\0' * (-len(binary) % 4)
        starts.append(len(binary))
        binary += fetch(b['uri']) if 'uri' in b else b''
    for v in gltf.get('bufferViews', []):
        v['byteOffset'] = v.get('byteOffset', 0) + starts[v.get('buffer', 0)]
        v['buffer'] = 0
    for img in gltf.get('images', []):
        if 'uri' not in img:
            continue
        data = fetch(img.pop('uri'))
        binary += b'\0' * (-len(binary) % 4)
        gltf.setdefault('bufferViews', []).append({'buffer': 0, 'byteOffset': len(binary), 'byteLength': len(data)})
        img['bufferView'] = len(gltf['bufferViews']) - 1
        img.setdefault('mimeType', image_type(data))
        binary += data
    gltf['buffers'] = [{'byteLength': len(binary)}] if binary else []
    return to_glb(gltf, bytes(binary))


def new_page(browser):
    # Pages that forbid outside scripts would block the exporter's import; ask the browser to look past that.
    try:
        return browser.new_page(viewport={'width': 1600, 'height': 900}, bypass_csp=True)
    except Exception as e:
        print(f'venue_model: no bypass_csp ({e}); opening a plain page')
        return browser.new_page(viewport={'width': 1600, 'height': 900})


def found(page):
    """What the page caught so far, read in its main frame; None while it does not answer. Embedded
    frames are opened as pages of their own instead (open_any), since a call into one can wait forever."""
    try:
        return page.main_frame, page.evaluate(FOUND)
    except Exception:
        return None


def caught(hit):
    return bool(hit) and any((hit[1]['three'], hit[1]['babylon'], hit[1]['files'], hit[1]['models']))


def watch(browser, url, wait):
    """Opens the page and waits until what it caught stops changing for 5 s, or `wait` s pass. A page that
    has caught nothing after 15 s but embeds frames stops early, for open_any to open its frames."""
    page = new_page(browser)
    page.add_init_script(HOOK_ANY)
    page.goto(url, wait_until='domcontentloaded', timeout=120000)
    start, last, steady = time.time(), None, 0
    while time.time() < start + wait:
        page.wait_for_timeout(1000)
        hit = found(page)
        if not caught(hit):
            if time.time() > start + 15 and frames(page):
                return page, hit
            continue
        got = hit[1]
        now = (got['three'], got['babylon'], sum(f['bytes'] for f in got['files']), len(got['models']))
        steady = steady + 1 if now == last else 0
        last = now
        if steady >= 5:
            break
    # Textures can still be on their way once the meshes have stopped changing.
    page.wait_for_timeout(3000)
    return page, found(page)


def frames(page):
    try:
        return page.evaluate(FRAMES)
    except Exception:
        return []


def open_any(connect, url, wait, depth=0):
    """The page, or the first page it embeds (two frames deep), that has a 3D scene or model. Each page opens in a
    browser session of its own (connect), since one Bright Data session may only navigate to so many domains."""
    page, hit = watch(connect(), url, wait)
    if caught(hit) or depth >= 2:
        return page, hit
    same = lambda a, b: a.split('#')[0].rstrip('/') == b.split('#')[0].rstrip('/')
    for src in [u for u in frames(page) if not same(u, url)][:3]:
        print(f'venue_model: {url} embeds {src}; opening it')
        sub = open_any(connect, src, wait, depth + 1)
        if caught(sub[1]):
            page.close()
            return sub
        sub[0].close()
    return page, hit


def pull(frame, size, path):
    with open(path, 'wb') as f:
        for start in range(0, size, CHUNK):
            f.write(base64.b64decode(frame.evaluate(SLICE, [start, min(start + CHUNK, size)])))


def from_page(cdp, url, out, wait):
    """Opens the page in Bright Data's browser and exports what it shows: the three.js or Babylon scene, or
    the largest glTF file it downloaded when that has more triangles. Returns (method, places, extra, got)."""
    from playwright.sync_api import sync_playwright
    model = os.path.join(out, 'model.glb')
    method, places, extra = None, None, {}
    with sync_playwright() as p:
        browsers = []

        def connect():
            browsers.append(p.chromium.connect_over_cdp(cdp, timeout=120000))
            return browsers[-1]

        try:
            page, hit = open_any(connect, url, wait)
            page.screenshot(path=os.path.join(out, 'screenshot.png'))
            frame, got = hit or (None, {'three': 0, 'babylon': 0, 'files': [], 'models': [], 'title': ''})
            print(f'venue_model: {page.url}: {got["three"]} three.js meshes, {got["babylon"]} Babylon meshes, '
                  f'{len(got["files"])} glTF files caught, {len(got["models"])} model links', flush=True)
            extra = {'title': got['title'], 'frame': page.url}
            if got['three']:
                try:
                    places = frame.evaluate(PLACES)
                    info = frame.evaluate(EXPORT)
                    method, extra['three'] = 'three.js scene', f'r{info["revision"]}'
                except Exception as e:
                    print(f'venue_model: the three.js export failed: {e}')
            if not method and got['babylon']:
                try:
                    info = frame.evaluate(BABYLON_EXPORT)
                    places = info.pop('places')
                    method, extra['babylon'] = 'babylon scene', info['revision']
                except Exception as e:
                    print(f'venue_model: the Babylon export failed: {e}')
            if method:
                print(f'venue_model: {method}: {info["bytes"]} bytes', flush=True)
                if info['bytes'] > MAX_BYTES:
                    raise SystemExit(f'venue_model: the model is {info["bytes"]} bytes, over {MAX_BYTES >> 20} MB')
                pull(frame, info['bytes'], model)
            if got['files']:
                info = frame.evaluate(FILE_PICK)
                # A viewer page's own model file beats an export of its scene, which can be just the stage around it.
                if info['bytes'] <= MAX_BYTES:
                    own = os.path.join(out, 'page-file.glb')
                    pull(frame, info['bytes'], own)
                    file_tris = inspect(own)[0]['triangles']
                    if not method or file_tris > inspect(model)[0]['triangles']:
                        os.replace(own, model)
                        print(f'venue_model: glTF file in the page: {info["url"]}, {info["bytes"]} bytes, {file_tris} triangles', flush=True)
                        method, places, extra['file'] = 'glTF file in the page', None, info['url'] or next(iter(got['models']), '')
                    else:
                        os.remove(own)
        finally:
            for browser in browsers:
                browser.close()
    return method, places, extra, got


def from_url(url, out, wait):
    """Any venue's 3D map page or model file to out/model.glb, layout.json and summary.json."""
    os.makedirs(out, exist_ok=True)
    model = os.path.join(out, 'model.glb')
    t0 = time.time()
    places, extra = None, {}
    if urlparse(url).path.lower().endswith(('.glb', '.gltf')):
        data = unlocker(url)
        if data[:4] != b'glTF':
            data = pack_gltf(url, data.decode('utf-8'))
        open(model, 'wb').write(data)
        method, zone = 'glTF file', env('BRIGHTDATA_ZONE')[0]
    else:
        from playwright.sync_api import Error as BrowserError
        cdp, zone = cdp_url()
        for attempt in (1, 2):
            try:
                method, places, extra, got = from_page(cdp, url, out, wait)
                break
            except BrowserError as e:
                # The remote browser sometimes closes a page under the script; one fresh browser more.
                print(f'venue_model: the browser failed ({str(e).splitlines()[0]})' + ('; trying once more' if attempt == 1 else ''))
                if attempt == 2:
                    summary = {'url': url, 'error': f'the page closed in the browser: {str(e).splitlines()[0]}', 'seconds': round(time.time() - t0, 1)}
                    print(json.dumps(summary))
                    sys.exit(3)
        if not method and got['models']:
            data = unlocker(got['models'][0])
            if data[:4] != b'glTF':
                data = pack_gltf(got['models'][0], data.decode('utf-8'))
            open(model, 'wb').write(data)
            method, extra['file'] = 'glTF file linked by the page', got['models'][0]
        if not method:
            summary = {'url': url, 'error': 'no 3D scene or model file on the page', 'seconds': round(time.time() - t0, 1), **extra}
            json.dump(summary, open(os.path.join(out, 'summary.json'), 'w'), indent=1)
            print(json.dumps(summary))
            sys.exit(3)
    summary, nodes = inspect(model)
    if places is None:
        places = nodes
    json.dump({'source': url, 'method': method, 'places': places}, open(os.path.join(out, 'layout.json'), 'w'), indent=1)
    summary.update(url=url, method=method, zone=zone, places=len(places), seconds=round(time.time() - t0, 1), **extra)
    json.dump(summary, open(os.path.join(out, 'summary.json'), 'w'), indent=1)
    print(json.dumps(summary))


def main():
    ap = argparse.ArgumentParser(description=USAGE, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--out', default=OUT)
    ap.add_argument('--wait', type=int, default=60, help='seconds to wait for the scene after the canvas appears')
    ap.add_argument('--assets', action='store_true', help=f'also copy the GLB to {os.path.relpath(ASSET, ROOT)} (under 20 MB)')
    ap.add_argument('--url', help='any venue\'s public 3D map page or .glb/.gltf link; writes model.glb, layout.json and summary.json to --out')
    args = ap.parse_args()
    if args.url:
        return from_url(args.url, args.out if args.out != OUT else os.path.join(ROOT, 'var', 'venue-3d', 'any'), args.wait)
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
    summary = inspect(glb_path)[0]
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
