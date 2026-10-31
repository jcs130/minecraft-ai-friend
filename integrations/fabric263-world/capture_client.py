"""Save a genuine game-renderer screenshot, without desktop mouse interaction."""
import json
from pathlib import Path
import java
from graalweave import client, ticks

mc = java.type("net.minecraft.client.Minecraft").getInstance()
Screenshot = java.type("net.minecraft.client.Screenshot")
client.call(lambda: Screenshot.grab(mc, False))
ticks.wait(20)
folder = Path(str(mc.gameDirectory)) / "screenshots"
files = list(folder.glob("*.png"))
if not files:
    raise RuntimeError("Screenshot was requested but no file exists")
latest = max(files, key=lambda path: path.stat().st_mtime)
print(json.dumps({"kind": "real-client-screenshot", "path": str(latest), "bytes": latest.stat().st_size}))
