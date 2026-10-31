import json
import java
from graalweave import api, client

Minecraft = java.type("net.minecraft.client.Minecraft")
Registries = java.type("net.minecraft.core.registries.BuiltInRegistries")
mc = Minecraft.getInstance()
print(json.dumps(api.inspect("net.minecraft.client.multiplayer.MultiPlayerGameMode", query="click", limit=16), ensure_ascii=False))


def menu():
    p = mc.player
    current = p.containerMenu
    slots = []
    for i in range(current.slots.size()):
        slot = current.slots.get(i)
        stack = slot.getItem()
        slots.append({"slot": i, "containerSlot": slot.getContainerSlot(), "container": str(slot.container.getClass().getName()),
                      "id": str(Registries.ITEM.getKey(stack.getItem())), "count": stack.getCount()})
    return {"id": current.containerId, "screen": str(mc.gui.screen().getClass().getName()) if mc.gui.screen() else None, "slots": slots}


print(json.dumps(client.call(menu), ensure_ascii=False))
