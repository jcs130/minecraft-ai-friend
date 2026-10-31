"""Read the actual Village Quest packet-backed journal data for this body."""
import json
import time
import java
from graalweave import client, ticks

mc = java.type("net.minecraft.client.Minecraft").getInstance()
def current_class():
    screen = mc.gui.screen()
    return str(screen.getClass().getName()) if screen is not None else None

if client.call(lambda: mc.player is None or mc.player.isDeadOrDying()):
    raise RuntimeError("Body unavailable; no journal command sent")
if client.call(current_class) != "de.quest.client.screen.JournalScreen":
    client.call(lambda: mc.player.connection.sendCommand("vq journal"))
    for _ in range(40):
        ticks.wait(5)
        if client.call(current_class) == "de.quest.client.screen.JournalScreen":
            break


def read():
    screen = mc.gui.screen()
    if screen is None or str(screen.getClass().getName()) != "de.quest.client.screen.JournalScreen":
        raise RuntimeError("Journal not received; actual screen=" + str(current_class()) + "; no server data was inferred")
    fields = [field for field in screen.getClass().getDeclaredFields() if str(field.getType().getName()) == "de.quest.client.screen.JournalScreenData"]
    if len(fields) != 1:
        raise RuntimeError("Unknown journal layout; explicitly inspect this mod version")
    fields[0].setAccessible(True)
    data = fields[0].get(screen)
    titles = {str(e.getKey()): str(e.getValue().getString()) for e in data.activeTitles().entrySet()}
    return {"schemaVersion": 1, "source": "server-synchronized-client-journal", "bodyId": str(mc.player.getUUID()), "observedAt": time.time(),
            "counts": {"total": data.total, "discovered": data.discovered, "completed": data.completed, "active": data.active},
            "currencyBalance": data.currencyBalance,
            "reputation": {"farming": data.farmingReputation, "crafting": data.craftingReputation, "animals": data.animalReputation,
                           "trade": data.tradeReputation, "monsters": data.monsterReputation},
            "activeTitles": titles, "networkNextAction": str(data.networkNextAction.getString()),
            "daily": {"active": data.dailyActive, "title": str(data.dailyTitle.getString()), "progress": str(data.dailyProgress.getString())},
            "weekly": {"active": data.weeklyActive, "title": str(data.weeklyTitle.getString()), "progress": str(data.weeklyProgress.getString())},
            "story": {"active": data.storyActive, "title": str(data.storyTitle.getString()), "progress": str(data.storyProgress.getString())}}


print(json.dumps(client.call(read), ensure_ascii=False))
client.call(lambda: mc.gui.setScreen(None))
