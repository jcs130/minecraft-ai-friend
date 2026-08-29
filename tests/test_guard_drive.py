# -*- coding: utf-8 -*-
"""guard_drive 纯函数单元测试(慢快双系统的心跳解析与反射节流)

import guard_drive 无网络副作用(Rcon lazy 连接,R=Rcon() 仅建锁),
CI(ubuntu 无 MC/RCON)可直接跑。
"""
import importlib.util
import os
import sys
import time

import pytest  # 两处 mcp 依赖缺失时 pytest.skip 兜底（gate job 已装 pytest）

HERE = os.path.dirname(os.path.abspath(__file__))
GD_PATH = os.path.join(HERE, "..", "sidecar", "guard", "guard_drive.py")

spec = importlib.util.spec_from_file_location("guard_drive", GD_PATH)
gd = importlib.util.module_from_spec(spec)
# 哨兵先行:guard_drive 顶层 wrap std 流(Windows GBK 修复),pytest capture 下
# wrap 会住宿主临时文件并 GC 关闭它,宿主收尾崩。哨兵=wrap 整段跳过。
os.environ["GUARD_DRIVE_NO_WRAP"] = "1"
# CI 哨兵(2026-08-30 红根因②):guard_drive 顶层校验 RCON_PASSWORD 缺失即
# SystemExit——干净 checkout/CI 无 .env。测试只测纯函数,dummy 密码即可放行。
os.environ.setdefault("RCON_PASSWORD", "ci-dummy-not-a-secret")
spec.loader.exec_module(gd)
del os.environ["GUARD_DRIVE_NO_WRAP"]


# ---------- _parse_health:numen get_self_status 的多种真实形态 ----------
def test_parse_dict_direct():
    st = {"hp": 20, "hunger": 13, "position": [-522, 68, 826]}
    h = gd._parse_health(st)
    assert h == {"hp": 20, "hunger": 13, "pos": [-522, 68, 826]}


def test_parse_rcon_text_wrapped():
    """RCON 回执是文本包 JSON,靠正则抠出来。"""
    st = 'Naruto has: {"hp": 7.5, "hunger": 12.0, "position": [1, 2, 3]}'
    h = gd._parse_health(st)
    assert h["hp"] == 7.5 and h["hunger"] == 12.0


def test_parse_garbage_returns_none():
    assert gd._parse_health("no json here") is None
    assert gd._parse_health(None) is None
    assert gd._parse_health(12345) is None


def test_parse_non_numeric_fields_none():
    """hp 非数值(如 'NaN'/None)时该字段 None,不抛异常。"""
    h = gd._parse_health({"hp": "dead", "hunger": None})
    assert h == {"hp": None, "hunger": None, "pos": None}


# ---------- 反射层节流(_reflex_gate) ----------
def test_reflex_gate_throttle():
    gd._reflex_ts.clear()
    tag = "Naruto"
    assert gd._reflex_gate(tag, "eat", 90) is True       # 首拍放行
    assert gd._reflex_gate(tag, "eat", 90) is False      # 90s 内拦
    # 不同类型互不影响
    assert gd._reflex_gate(tag, "attack", 12) is True
    # 时间倒退 91s 后再放行
    gd._reflex_ts[(tag, "eat")] = time.time() - 91
    assert gd._reflex_gate(tag, "eat", 90) is True
    gd._reflex_ts.clear()


# ---------- 反射食物链:覆盖鸣人实背包里的东西 ----------
def test_food_chain_prioritizes_cooked():
    chain = gd.REFLEX_FOOD_CHAIN
    # 熟牛排排最前(鸣人背包实有 16 块)
    assert chain[0] == "minecraft:cooked_beef"
    # 面包在前 3(亲卫实际依赖它)
    assert "minecraft:bread" in chain[:3]
    # 全链 minecraft: 前缀(eat 工具 item_id 规范)
    assert all(f.startswith("minecraft:") for f in chain)


def test_reflex_thresholds():
    """反射阈值回归锚:贴脸反击 12s / 进食 90s / 濒死逃跑 120s。"""
    assert gd.REFLEX_ATTACK_THROTTLE == 12
    assert gd.REFLEX_EAT_THROTTLE == 90
    assert gd.REFLEX_FLEE_THROTTLE == 120
    assert gd.REFLEX_POLL == 5


# ---------- 2026-08-29 二批:R4 溺水 / R5 着火 / R6 卡死(mindcraft 对齐) ----------
def test_r4_air_dangerous():
    """Air NBT(总 300):低于 150 危险;None(取不到)不动作。"""
    assert gd._air_dangerous(120) is True
    assert gd._air_dangerous(150) is False
    assert gd._air_dangerous(300) is False
    assert gd._air_dangerous(None) is False


def test_r5_fire_burning():
    """Fire NBT:0 未烧 / -1 灭 / >0 在烧;None 不动作。"""
    assert gd._fire_burning(1) is True
    assert gd._fire_burning(60) is True
    assert gd._fire_burning(0) is False
    assert gd._fire_burning(-1) is False
    assert gd._fire_burning(None) is False


def test_r6_stuck_verdict_triggers():
    """任务在跑 + 基点后连续 4 拍位移<2格 → True(整 20s 没挪窝)。

    首拍存基点(不计比较),其后每拍比较一次;4 次比较都没动=20s 整。
    """
    gd._reflex_stuck.clear()
    tag = "Kirito"
    pos = [-500.0, 70.0, 800.0]
    for _ in range(4):   # 基点 + 3 次比较:不触发
        assert gd._stuck_verdict(tag, pos, True) is False
    # 第 5 拍(第 4 次比较):仍然没动 → 触发
    assert gd._stuck_verdict(tag, pos, True) is True
    gd._reflex_stuck.clear()


def test_r6_stuck_reset_when_moved():
    """中途挪窝(>2格)计数清零。"""
    gd._reflex_stuck.clear()
    tag = "Naruto"
    a, far = [0.0, 70.0, 0.0], [10.0, 70.0, 0.0]
    gd._stuck_verdict(tag, a, True)
    gd._stuck_verdict(tag, a, True)
    gd._stuck_verdict(tag, a, True)   # 基点+2 比较
    assert gd._stuck_verdict(tag, far, True) is False  # 挪了 → 清零
    assert gd._stuck_verdict(tag, far, True) is False  # 新基点
    assert gd._stuck_verdict(tag, far, True) is False
    assert gd._stuck_verdict(tag, far, True) is False
    assert gd._stuck_verdict(tag, far, True) is True   # 基点+4 次比较没动才触发
    gd._reflex_stuck.clear()


def test_r6_stuck_idle_never_triggers():
    """无任务(mindcraft isIdle 同义)永不触发并清零。"""
    gd._reflex_stuck.clear()
    tag = "Kirito"
    pos = [1.0, 70.0, 1.0]
    for _ in range(6):
        assert gd._stuck_verdict(tag, pos, False) is False
    gd._reflex_stuck.clear()


def test_nbt_number_extraction():
    """data get entity 回执抠裸数字;非数字回执 None。"""
    assert gd._nbt_number("Kirito has the following entity data: 300") == 300
    assert gd._nbt_number("Naruto has the following entity data: -1") == -1
    assert gd._nbt_number("No entity was found") is None
    assert gd._nbt_number(None) is None
    assert gd._nbt_number(12345) is None


# ---------- 2026-08-29 三批:决策词表对齐 mcp_numen 全工具面(mindcraft $COMMAND_DOCS 等价物) ----------

_ESSENTIAL_TOOLS = [
    "craft", "lookup_recipe", "equip_item",
    "interact_at", "interact_entity", "inspect_gui", "transfer", "close_gui",
    "locate_structure", "locate_biome", "remember_place", "list_places",
    "goto", "mine", "eat", "attack", "sleep", "say", "chant", "pray", "task_stop",
]


def _fake_guard():
    return {"name": "桐人", "agent": "mc-guard-kirito", "login": "Kirito"}


def test_decision_prompt_tool_vocabulary():
    """全量决策 prompt 必须含全部关键工具行——亲卫的嘴要跟得上身体(mcp_numen 43 工具)。"""
    p = gd.decision_prompt(_fake_guard(), "{}", "{}", "", "", "", "", )
    for t in _ESSENTIAL_TOOLS:
        assert t in p, f"decision_prompt 缺工具说明: {t}"
    # 链路 few-shot 必须在(教亲卫多步活怎么串)
    assert "合成链" in p and "存取链" in p and "交易链" in p


def test_tool_summary_incremental():
    """增量轮压缩摘要也必须覆盖新工具(增量轮是常态轮,词表缺了等于常态失明)。"""
    s = gd._TOOL_SUMMARY
    for t in ["craft", "equip_item", "interact_at", "transfer", "locate_structure",
              "remember_place", "list_places", "inspect_gui", "close_gui",
              "read_skill", "list_skills", "set_timer", "get_owner_status"]:
        assert t in s, f"_TOOL_SUMMARY 缺: {t}"


def test_skill_channel_and_aliases():
    """技能通道+别名(2026-08-29 37 工具对齐批):技能篇自持版可读、防穿越、别名归一。"""
    mn_spec = importlib.util.spec_from_file_location(
        "mcp_numen_skill_test", os.path.join(HERE, "..", "sidecar", "guard", "mcp_numen.py"))
    mn = importlib.util.module_from_spec(mn_spec)
    try:
        mn_spec.loader.exec_module(mn)
    except Exception:
        pytest.skip("mcp_numen 依赖(mcp 包)本环境不可用")
    import asyncio
    # 1. list_skills 出 11 篇且含核心四篇
    listing = asyncio.run(mn.list_skills())
    for s in ("combat_basics", "tier_progression", "containers", "building_design"):
        assert s in listing, f"list_skills 缺技能篇: {s}"
    # 2. read_skill 正文可读且剥了 frontmatter
    body = asyncio.run(mn.read_skill("combat_basics"))
    assert body.startswith("[技能篇") and "description:" not in body.split("\n")[0]
    # 3. 目录穿越防住
    assert "不存在" in asyncio.run(mn.read_skill("../secrets"))
    assert "不存在" in asyncio.run(mn.read_skill("combat_basics/../../mcp_numen.py"))
    # 4. 别名归一:技能篇旧名 → 服务端真实 op
    assert mn._OP_ALIASES["eat_item"] == "eat"
    assert mn._OP_ALIASES["task_finished"] == "task_status"
    # 5. 技能篇自持版正文无过时工具名(防上游同步时回退)
    skills_dir = os.path.join(HERE, "..", "sidecar", "guard", "skills")
    for w in ("load_skill", "task_finished", "eat_item", "known_blocks", "todowrite"):
        for root, _, files in os.walk(skills_dir):
            for fn in files:
                if fn.endswith(".md"):
                    src = open(os.path.join(root, fn), encoding="utf-8").read()
                    assert w not in src, f"{fn} 残留过时工具名: {w}"


def test_places_memory_roundtrip(tmp_path, monkeypatch):
    """地点记忆:存文件按守卫分册、原子写、可回读(mcp_numen remember_place/list_places 的文件层)。"""
    mn_spec = importlib.util.spec_from_file_location(
        "mcp_numen_test", os.path.join(HERE, "..", "sidecar", "guard", "mcp_numen.py"))
    mn = importlib.util.module_from_spec(mn_spec)
    try:
        mn_spec.loader.exec_module(mn)
    except Exception:
        pytest.skip("mcp_numen 依赖(mcp 包)本环境不可用")
    fp = tmp_path / "guard-places.json"
    monkeypatch.setattr(mn, "PLACES_FP", str(fp))
    mn._save_places({"Kirito": {"家": {"x": 3096.0, "y": 67.0, "z": -1340.0, "t": "08-29 12:00"}}})
    d = mn._load_places()
    assert d["Kirito"]["家"]["x"] == 3096.0
    assert d["Kirito"]["家"]["z"] == -1340.0
