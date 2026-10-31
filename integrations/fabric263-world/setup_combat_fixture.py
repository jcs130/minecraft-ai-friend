"""Developer fixture only, in the owned loopback lab. Supplies are not earned loot."""
from manage import settings, control

config = settings()
if config["port"] != 39781:
    raise ValueError("Fixture is restricted to the designated local experiment")
command = 'execute at GraalScout positioned ~8 ~ ~ positioned over motion_blocking_no_leaves run summon minecraft:husk ~ ~ ~ {Tags:["maw_fabric263_spell_probe_v2"],CustomName:{text:"MAW_SpellProbe"},PersistenceRequired:1b,NoAI:1b}'
print(control(config, "console", {"command": command}))
