"""One native Arcane Bolt against the uniquely named hostile QA fixture."""
import json
import time
import java
from graalweave import client, ticks

mc = java.type("net.minecraft.client.Minecraft").getInstance()
Registry = java.type("net.minecraft.core.registries.BuiltInRegistries")
Anchor = java.type("net.minecraft.commands.arguments.EntityAnchorArgument$Anchor")


def target():
    matches = []
    for entity in mc.level.entitiesForRendering():
        if entity.getCustomName() is not None and str(entity.getCustomName().getString()) == "MAW_SpellProbe":
            if str(Registry.ENTITY_TYPE.getKey(entity.getType())) != "minecraft:husk":
                raise RuntimeError("Fixture type mismatch; never target players or friendly entities")
            matches.append(entity)
    if len(matches) > 1:
        raise RuntimeError("Ambiguous fixture; no target may be selected")
    return matches[0] if matches else None


enemy = None
for _ in range(20):
    enemy = client.call(target)
    if enemy is not None:
        break
    ticks.wait(5)
if enemy is None:
    raise RuntimeError("Named hostile fixture not received; no spell sent")


def facts():
    p = mc.player
    return {"bodyId": str(p.getUUID()), "playerHealth": p.getHealth(), "targetUuid": str(enemy.getUUID()),
            "targetType": str(Registry.ENTITY_TYPE.getKey(enemy.getType())), "targetHealth": enemy.getHealth(),
            "targetAlive": enemy.isAlive(), "distance": p.distanceTo(enemy), "lineOfSight": p.hasLineOfSight(enemy),
            "position": {"x": enemy.getX(), "y": enemy.getY(), "z": enemy.getZ()}, "observedAt": time.time()}


before = client.call(facts)
if before["playerHealth"] <= 0 or not before["targetAlive"] or not before["lineOfSight"]:
    raise RuntimeError("Unsafe or obstructed fixture; no cast sent")
client.call(lambda: mc.player.lookAt(Anchor.EYES, enemy.getEyePosition()))
ticks.wait(3)


def cast():
    p = mc.player
    if str(Registry.ITEM.getKey(p.getMainHandItem().getItem())) != "wizards:wand_arcane":
        raise RuntimeError("Expected actual Arcane Wand in hand")
    options = [o for o in p.getCastController().displayOptions() if str(o.id()) == "wizards:arcane_bolt"]
    if len(options) != 1:
        raise RuntimeError("Exact spell unavailable; no alternate selected")
    return str(p.getCastController().startSpellCast(p.getMainHandItem(), options[0].spell()))


attempt = client.call(cast)
ticks.wait(40)
after = client.call(facts)
client.call(lambda: mc.player.getCastController().cancelSpellCast())
print(json.dumps({"kind": "native-spell", "spellId": "wizards:arcane_bolt", "attempt": attempt, "before": before, "after": after,
                  "goalVerified": after["targetHealth"] < before["targetHealth"]}, ensure_ascii=False))
if after["targetHealth"] >= before["targetHealth"]:
    raise RuntimeError("Native controller accepted/read result must not be confused with a verified hit")
