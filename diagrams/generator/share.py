"""Upload an .excalidraw scene to excalidraw.com the way its Share button does, images included: python3 share.py scene.excalidraw"""
import base64, json, os, struct, sys, urllib.parse, urllib.request, zlib
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

def concat(*bufs):
    out = struct.pack(">I", 1)
    for b in bufs:
        out += struct.pack(">I", len(b)) + b
    return out

def compress(data, key, metadata=None):
    info = json.dumps({"version": 2, "compression": "pako@1", "encryption": "AES-GCM"}).encode()
    inner = concat(json.dumps(metadata).encode(), data)
    iv = os.urandom(12)
    enc = AESGCM(key).encrypt(iv, zlib.compress(inner), None)
    return concat(info, iv, enc)

scene = json.load(open(sys.argv[1]))
key = os.urandom(16)
k = base64.urlsafe_b64encode(key).decode().rstrip("=")
els = [e for e in scene["elements"] if not e.get("isDeleted")]
body = {"type": "excalidraw", "version": 2, "source": "https://excalidraw.com", "elements": els,
        "appState": {"viewBackgroundColor": scene.get("appState", {}).get("viewBackgroundColor", "#ffffff"), "gridSize": None}}
payload = compress(json.dumps(body).encode(), key)
req = urllib.request.Request("https://json.excalidraw.com/api/v2/post/", data=payload, method="POST")
sid = json.loads(urllib.request.urlopen(req, timeout=60).read())["id"]
used = {e["fileId"] for e in els if e["type"] == "image"}
for fid, f in scene.get("files", {}).items():
    if fid not in used:
        continue
    meta = {"id": fid, "mimeType": f["mimeType"], "created": f.get("created", 0), "lastRetrieved": f.get("created", 0)}
    blob = compress(f["dataURL"].encode(), key, meta)
    name = urllib.parse.quote(f"files/shareLinks/{sid}/{fid}", safe="")
    url = f"https://firebasestorage.googleapis.com/v0/b/excalidraw-room-persistence.appspot.com/o?name={name}"
    r = urllib.request.Request(url, data=blob, method="POST", headers={"Content-Type": "application/octet-stream",
                                                                       "Cache-Control": "public, max-age=31536000"})
    urllib.request.urlopen(r, timeout=60).read()
print(f"https://excalidraw.com/#json={sid},{k}")
