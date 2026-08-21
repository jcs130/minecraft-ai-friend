# -*- coding: utf-8 -*-
import sys
sys.path.insert(0, r"C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\sidecar")
import mc_npc as M

base = stand = vill = missing = 0
missing_list = []
for v in M.PROFILES:
    tag = v["tag"]
    found = None
    for etype in ["settlements:base_villager", "minecraft:villager", "minecraft:armor_stand"]:
        r = M.R.cmd('execute if entity @e[type=%s,tag=%s,limit=1]' % (etype, tag))
        if r and 'passed' in r:
            found = etype
            break
    if found == "settlements:base_villager":
        base += 1
    elif found == "minecraft:villager":
        vill += 1
    elif found == "minecraft:armor_stand":
        stand += 1
    else:
        missing += 1
        missing_list.append(v['display'])
print('base_villager=%d  vanilla_villager=%d  armor_stand=%d  missing=%d' % (base, vill, stand, missing))
if missing_list:
    print('missing:', ', '.join(missing_list))
