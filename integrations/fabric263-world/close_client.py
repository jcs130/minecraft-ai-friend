"""Save and close the selected lab client, including pinned Baritone workers.

Official Baritone 1.20.0 leaves two non-daemon cache workers running after the
Minecraft render loop ends. Their exact reviewed bytecode exits on interrupt.
This one-shot shutdown helper is not a pause/reconnect command.
"""
import hashlib
import json
from pathlib import Path
import java
from graalweave import client

mc = java.type("net.minecraft.client.Minecraft").getInstance()
baritone = java.type("baritone.api.BaritoneAPI").getProvider().getPrimaryBaritone()
uri = baritone.getClass().getProtectionDomain().getCodeSource().getLocation().toURI()
jar = Path(str(java.type("java.io.File")(uri).getPath()))
if hashlib.sha256(jar.read_bytes()).hexdigest() != "49adfc063cfbfd0b6f08e9d814359807baa2d1768c0d39d6c5968268547cbca6":
    raise RuntimeError("Shutdown helper only supports the reviewed Baritone 1.20.0 bytes")
Modifier = java.type("java.lang.reflect.Modifier")
methods = [m for m in baritone.getClass().getDeclaredMethods()
           if Modifier.isStatic(m.getModifiers()) and m.getParameterCount() == 0
           and str(m.getReturnType().getName()) == "java.util.concurrent.Executor"]
if len(methods) != 1:
    raise RuntimeError("Unique reviewed Baritone cache executor accessor not found")
executor = methods[0].invoke(None)
client.call(lambda: baritone.getPathingBehavior().cancelEverything())
world = client.call(lambda: baritone.getWorldProvider().getCurrentWorld())
if world is not None:
    world.getCachedWorld().save()
executor.shutdownNow()
if not executor.awaitTermination(3, java.type("java.util.concurrent.TimeUnit").SECONDS):
    raise RuntimeError("Cache executor has not stopped; do not claim a clean exit")
print(json.dumps({"kind": "client-shutdown", "cachedWorldSaved": world is not None,
                  "baritoneWorkersStopped": True, "gameExitRequested": True}))
client.call(lambda: mc.stop())
