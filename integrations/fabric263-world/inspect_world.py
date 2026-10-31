"""Run inside GraalWeave; read actual client objects without a screenshot."""
import json
import time
import java
from graalweave import api, client

Minecraft = java.type("net.minecraft.client.Minecraft")
BlockPos = java.type("net.minecraft.core.BlockPos")
Registries = java.type("net.minecraft.core.registries.BuiltInRegistries")
mc = Minecraft.getInstance()


def snapshot():
    p = mc.player
    observed = time.time()
    if p is None or mc.level is None:
        return {"schemaVersion": 1, "status": "offline", "observedAt": observed}
    inventory = p.getInventory()
    items = []
    for index in range(inventory.getContainerSize()):
        stack = inventory.getItem(index)
        if not stack.isEmpty():
            items.append({"slot": index, "id": str(Registries.ITEM.getKey(stack.getItem())),
                          "name": str(stack.getHoverName().getString()), "count": stack.getCount(),
                          "components": str(stack.getComponents())})
    below = BlockPos.containing(p.getX(), p.getY() - 0.1, p.getZ())
    block = mc.level.getBlockState(below)
    menu = p.containerMenu
    return {"schemaVersion": 1, "status": "dead" if p.isDeadOrDying() else "online",
            "bodyId": str(p.getUUID()), "name": str(p.getName().getString()), "observedAt": observed,
            "position": {"x": p.getX(), "y": p.getY(), "z": p.getZ()}, "coordinateSystem": "absolute-world-blocks",
            "dimensionKey": str(mc.level.dimension()), "health": p.getHealth(), "maxHealth": p.getMaxHealth(),
            "food": p.getFoodData().getFoodLevel(), "onGround": p.onGround(),
            "onFire": p.isOnFire(), "fireTicks": p.getRemainingFireTicks(), "gameMode": str(mc.gameMode.getPlayerMode()),
            "below": {"x": below.getX(), "y": below.getY(), "z": below.getZ(), "id": str(Registries.BLOCK.getKey(block.getBlock()))},
            "inventory": items, "menu": {"id": menu.containerId, "slots": menu.slots.size(), "class": str(menu.getClass().getName())},
            "screen": str(mc.gui.screen().getClass().getName()) if mc.gui.screen() is not None else None}


print(json.dumps(client.call(snapshot), ensure_ascii=False))
