"""Craft from this body's gathered logs using normal container inputs."""
import json
import time
import java
from graalweave import client, ticks

Minecraft = java.type("net.minecraft.client.Minecraft")
Registries = java.type("net.minecraft.core.registries.BuiltInRegistries")
Input = java.type("net.minecraft.world.inventory.ContainerInput")
Identifier = java.type("net.minecraft.resources.Identifier")
QuestData = java.type("com.erikedits.justquests.network.ClientQuestData")
mc = Minecraft.getInstance()
pickup, quick_move = Input.valueOf("PICKUP"), Input.valueOf("QUICK_MOVE")


def inventory():
    p = mc.player
    result = []
    for i in range(p.getInventory().getContainerSize()):
        stack = p.getInventory().getItem(i)
        if not stack.isEmpty():
            result.append({"slot": i, "id": str(Registries.ITEM.getKey(stack.getItem())), "count": stack.getCount()})
    return result


def find_slot(item_id):
    p = mc.player
    if p.containerMenu.containerId != 0 or not p.containerMenu.getCarried().isEmpty():
        raise RuntimeError("Expected inventory menu with empty cursor")
    for i in range(p.containerMenu.slots.size()):
        slot = p.containerMenu.slots.get(i)
        if str(slot.container.getClass().getName()) == "net.minecraft.world.entity.player.Inventory":
            stack = slot.getItem()
            if str(Registries.ITEM.getKey(stack.getItem())) == item_id:
                return i
    raise RuntimeError("Required item absent: " + item_id)


def click(slot, button=0, operation=pickup):
    def send():
        p = mc.player
        if p.containerMenu.containerId != 0:
            raise RuntimeError("Menu changed during operation")
        mc.gameMode.handleContainerInput(0, slot, button, operation, p)
    client.call(send)
    ticks.wait(4)


def output_is(expected):
    return str(Registries.ITEM.getKey(mc.player.containerMenu.getSlot(0).getItem().getItem())) == expected


before = client.call(inventory)
if client.call(lambda: mc.player.isDeadOrDying()):
    raise RuntimeError("Body is dead; no container input may be sent before respawn and reconciliation")
log_slot = client.call(lambda: find_slot("minecraft:acacia_log"))
click(log_slot)
click(1, 1)
click(log_slot)
if not client.call(lambda: output_is("minecraft:acacia_planks")):
    raise RuntimeError("Server did not present the expected planks result")
click(0, operation=quick_move)
planks_slot = client.call(lambda: find_slot("minecraft:acacia_planks"))
click(planks_slot)
for slot in (1, 2, 3, 4):
    click(slot, 1)
if not client.call(lambda: output_is("minecraft:crafting_table")):
    raise RuntimeError("Server did not present the expected workbench result")
click(0, operation=quick_move)
after = client.call(inventory)
completed = client.call(lambda: QuestData.getData().isClaimable(Identifier.parse("maw:workbench")))
print(json.dumps({"kind": "ordinary-crafting", "before": before, "after": after, "questClaimable": completed,
                  "observedAt": time.time(), "goalVerified": completed and any(s["id"] == "minecraft:crafting_table" for s in after)}, ensure_ascii=False))
if not completed:
    raise RuntimeError("Crafted inventory must be reconciled; quest not confirmed")
client.call(lambda: mc.player.connection.sendCommand("quest claim maw:workbench"))
ticks.wait(20)
print(json.dumps({"kind": "workbench-reward", "inventory": client.call(inventory), "observedAt": time.time()}, ensure_ascii=False))
