import json, sys, urllib.request
scene = open(sys.argv[1]).read()
body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                   "params": {"name": "export_to_excalidraw", "arguments": {"json": scene}}}).encode()
req = urllib.request.Request("https://mcp.excalidraw.com/mcp", data=body, method="POST",
                             headers={"Content-Type": "application/json", "Accept": "application/json, text/event-stream"})
raw = urllib.request.urlopen(req, timeout=60).read().decode()
for line in raw.splitlines():
    if line.startswith("data: "):
        d = json.loads(line[6:])
        print(json.dumps(d.get("result", d))[:2000])
