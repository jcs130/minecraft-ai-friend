# -*- coding: utf-8 -*-
import sys
sys.path.insert(0, r"C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\sidecar")
import mc_npc as M
M.R.connect()
print("auth ok")
r = M.R.cmd("stop")
print("stop ->", r)
