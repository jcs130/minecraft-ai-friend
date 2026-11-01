"""Verify selected-pack translations in the real client; open native read-only UIs."""
import json
from pathlib import Path
import re
import sys
import time
import zipfile
import java
from graalweave import client, ticks

mc = java.type("net.minecraft.client.Minecraft").getInstance()
Language = java.type("net.minecraft.locale.Language")
Screenshot = java.type("net.minecraft.client.Screenshot")
QuestData = java.type("com.erikedits.justquests.network.ClientQuestData")
QuestScreen = java.type("com.erikedits.justquests.client.QuestScreen")
provider = java.type("baritone.api.BaritoneAPI").getProvider().getPrimaryBaritone()
uri = provider.getClass().getProtectionDomain().getCodeSource().getLocation().toURI()
root = Path(str(java.type("java.io.File")(uri).getPath())).parent.parent
expected = {}
with zipfile.ZipFile(root / "resourcepacks/my-agent-world-zh_cn-0.1.0.zip") as pack:
    for name in pack.namelist():
        if name.startswith("assets/") and name.endswith("/lang/zh_cn.json"):
            expected.update(json.loads(pack.read(name)))


def verify():
    actual = Language.getInstance()
    bad = []
    for key, value in expected.items():
        # Minecraft's own language loader canonicalizes numeric format codes.
        normalized = re.sub(r"%(\d+\$)?[\d.]*[df]", lambda m: "%" + (m.group(1) or "") + "s", value)
        # GraalWeave's str/print presentation hooks round decimal-looking text.
        # Native Java strings already cross as Python strings: retain exact data.
        received = actual.getOrDefault(key)
        if received != normalized:
            differences = [{"index": index, "expected": ord(a), "received": ord(b)} for index, (a, b) in enumerate(zip(normalized, received)) if a != b]
            bad.append({"key": key, "expected": normalized[:100], "received": received[:100],
                        "expectedLength": len(normalized), "receivedLength": len(received), "codePointDifferences": differences[:5]})
    quests = []
    for entry in QuestData.getQuests().entrySet():
        quest = entry.getValue()
        quests.append({"id": str(entry.getKey()), "title": quest.title().get("zh_cn"),
                       "description": quest.description().get("zh_cn")})
    return {"kind": "real-client-chinese", "bodyId": str(mc.player.getUUID()),
            "language": str(mc.getLanguageManager().getSelected()), "observedAt": time.time(),
            "expectedStrings": len(expected), "mismatchCount": len(bad), "mismatches": bad[:12],
            "questCount": len(quests), "questExamples": [row for row in quests if row["id"] in {"justquests:first_steps", "justquests:animal_friend"} or row["id"].startswith("justquests:gen/")],
            "gameMode": str(mc.gameMode.getPlayerMode())}


if client.call(lambda: mc.player is None or mc.player.isDeadOrDying()):
    raise RuntimeError("Alive UI validation body required")
result = client.call(verify)
sys.stdout.write(json.dumps(result, ensure_ascii=False) + "\n")
if result["language"] != "zh_cn" or result["mismatchCount"]:
    raise RuntimeError("Actual language table differs from the selected Chinese pack")
client.call(lambda: mc.player.connection.sendCommand("vq journal"))
for _ in range(40):
    ticks.wait(5)
    if client.call(lambda: mc.gui.screen() is not None and str(mc.gui.screen().getClass().getName()) == "de.quest.client.screen.JournalScreen"):
        break
screen = client.call(lambda: mc.gui.screen())
if screen is None or str(screen.getClass().getName()) != "de.quest.client.screen.JournalScreen":
    raise RuntimeError("Native journal was not received; no screenshot inferred")
ticks.wait(5)
client.call(lambda: Screenshot.grab(mc, False))
print(json.dumps({"kind": "native-journal", "title": str(client.call(lambda: mc.gui.screen().getTitle().getString()))}, ensure_ascii=False))
client.call(lambda: mc.gui.setScreen(QuestScreen()))
ticks.wait(10)
client.call(lambda: Screenshot.grab(mc, False))
print(json.dumps({"kind": "native-quest-book", "title": str(client.call(lambda: mc.gui.screen().getTitle().getString()))}, ensure_ascii=False))
client.call(lambda: mc.gui.setScreen(None))
