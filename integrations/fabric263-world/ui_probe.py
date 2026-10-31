"""Open normal player-facing mod screens and read their real widget labels."""
import json
import time
import java
from graalweave import client, ticks

mc = java.type("net.minecraft.client.Minecraft").getInstance()
Screenshot = java.type("net.minecraft.client.Screenshot")


def screen_state():
    screen = mc.gui.screen()
    if screen is None:
        return {"status": "no_screen", "observedAt": time.time()}
    children = []
    for widget in screen.children():
        if len(children) >= 24:
            break
        label = str(widget.getMessage().getString()) if hasattr(widget, "getMessage") else None
        children.append({"class": str(widget.getClass().getName()), "label": label})
    return {"status": "open", "class": str(screen.getClass().getName()), "title": str(screen.getTitle().getString()),
            "widgets": children, "observedAt": time.time()}


if client.call(lambda: mc.player is None or mc.player.isDeadOrDying()):
    raise RuntimeError("Alive player required")
for command in ("vq journal", "vq questmaster", "quest list"):
    client.call(lambda: mc.gui.setScreen(None))
    client.call(lambda: mc.player.connection.sendCommand(command))
    ticks.wait(20)
    result = client.call(screen_state)
    print(json.dumps({"command": command, "screen": result}, ensure_ascii=False))
    if command.startswith("vq ") and result["status"] == "open":
        client.call(lambda: Screenshot.grab(mc, False))
client.call(lambda: mc.gui.setScreen(None))
