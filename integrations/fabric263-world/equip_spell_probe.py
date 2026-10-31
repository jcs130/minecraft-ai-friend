import json
import java
from graalweave import client, ticks

mc = java.type("net.minecraft.client.Minecraft").getInstance()
Registry = java.type("net.minecraft.core.registries.BuiltInRegistries")
Input = java.type("net.minecraft.world.inventory.ContainerInput")


def equip():
    p = mc.player
    if p.isDeadOrDying() or p.containerMenu.containerId != 0 or not p.containerMenu.getCarried().isEmpty():
        raise RuntimeError("Alive body and empty inventory cursor required")
    for i in range(p.containerMenu.slots.size()):
        stack = p.containerMenu.getSlot(i).getItem()
        if str(Registry.ITEM.getKey(stack.getItem())) == "wizards:wand_arcane":
            mc.gameMode.handleContainerInput(0, i, 0, Input.valueOf("SWAP"), p)
            return
    raise RuntimeError("Fixture wand absent; no item was fabricated")


client.call(equip)
ticks.wait(10)


def read():
    p = mc.player
    options = p.getCastController().displayOptions()
    return {"bodyId": str(p.getUUID()), "heldId": str(Registry.ITEM.getKey(p.getMainHandItem().getItem())),
            "options": [{"id": str(o.id()), "mode": str(o.mode()), "range": o.range()} for o in options],
            "position": {"x": p.getX(), "y": p.getY(), "z": p.getZ()}}


print(json.dumps(client.call(read), ensure_ascii=False))
