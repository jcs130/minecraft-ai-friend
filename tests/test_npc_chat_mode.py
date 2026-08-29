# -*- coding: utf-8 -*-
"""村民闲聊零 LLM 回归闸(2026-08-29 造物主谕「算力再分配·二」)。

背景:村民闲聊曾走 agent_chat(本地27B)/llm_reply 实时生成——算力大头且阻塞风险;
造物主谕令:村民的话不用 LLM 实时生成,LLM 只留给工会委托(llm_quest)。
闸:①闲聊路径的 LLM 调用必须包在 chat_mode=="chat" 开关内(默认 quests=关);
   ②世界设定问询必须有零 LLM 的固定指路语(WORLD_GUIDE)兜住;
   ③配置默认 chat_mode=quests;④llm_quest(委托)必须保留不被误伤。
"""
import io
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NPC = io.open(os.path.join(ROOT, "sidecar", "mc_npc.py"), encoding="utf-8").read()
CFG = json.load(io.open(os.path.join(ROOT, "ops", "docker", "shadow", "data", "village", "config.json"), encoding="utf-8"))


def test_chat_llm_gated_by_chat_mode():
    """闲聊路径的 agent_chat/llm_reply 调用必须包在 _chat_llm_on(chat_mode=='chat')内。"""
    # 找 handle 闲聊段(QUEST_KW 之后到 dedup 注释之前),段内所有 LLM 调用须先过开关
    seg = NPC[NPC.index('QUEST_KW = ['):]
    seg = seg[seg.index("if any(w in rest for w in QUEST_KW):"):]
    seg = seg[:seg.index("# ---------- 村民看护")]
    assert '_chat_llm_on = CFG.get("llm", {}).get("chat_mode", "quests") == "chat"' in seg, \
        "chat_mode 开关读取丢失(默认必须 quests=闲聊零LLM)"
    # 每处 agent_chat/llm_reply 调用之前,同分支里必须有 _chat_llm_on 守卫
    for m in re.finditer(r"lines = (agent_chat|llm_reply)\(hit_v", seg):
        # 向上找本分支最近的 if 行,确保是 _chat_llm_on 守卫
        before = seg[:m.start()]
        last_if = before[before.rfind("if _chat_llm_on"):]
        assert last_if.startswith("if _chat_llm_on"), \
            f"闲聊路径 {m.group(1)} 调用未被 _chat_llm_on 守卫(会绕过 chat_mode=quests 静默烧卡)"


def test_world_guide_no_llm_fallback():
    """世界设定问询必须有固定指路语,且命中时直接返回(不落 LLM)。"""
    assert "WORLD_GUIDE = [" in NPC, "WORLD_GUIDE 固定指路语表丢失"
    assert "def world_guide_reply(msg):" in NPC, "world_guide_reply 函数丢失"
    seg = NPC[NPC.index("if any(w in rest for w in WORLD_QUERY_KW):"):]
    seg = seg[:seg.index("# 指名道姓")]
    assert "guide = world_guide_reply(rest)" in seg and "if guide:" in seg, \
        "WORLD_QUERY 命中必须先走 guide 模板(零 LLM)"


def test_config_chat_mode_quests():
    """两份运行配置默认闲聊零 LLM。"""
    assert CFG.get("llm", {}).get("chat_mode") == "quests", "运行配置 chat_mode 必须 quests"
    cfg2 = json.load(io.open(os.path.join(ROOT, "mc-data", "village", "config.json"), encoding="utf-8"))
    assert cfg2.get("llm", {}).get("chat_mode") == "quests", "mc-data 副本 chat_mode 必须 quests"


def test_quest_llm_kept():
    """工会委托的 LLM 生成(llm_quest)必须保留——造物主明说『和任务相关的工会委托的可以用』。"""
    assert "def llm_quest(v, day):" in NPC, "llm_quest 委托生成被误删"
    assert re.search(r"q = llm_quest\(v, day\)", NPC), "llm_quest 调用点被误删"
