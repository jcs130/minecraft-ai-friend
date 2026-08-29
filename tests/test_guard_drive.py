# -*- coding: utf-8 -*-
"""guard_drive 纯函数单元测试(慢快双系统的心跳解析与反射节流)

import guard_drive 无网络副作用(Rcon lazy 连接,R=Rcon() 仅建锁),
CI(ubuntu 无 MC/RCON)可直接跑。
"""
import importlib.util
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
GD_PATH = os.path.join(HERE, "..", "sidecar", "guard", "guard_drive.py")

spec = importlib.util.spec_from_file_location("guard_drive", GD_PATH)
gd = importlib.util.module_from_spec(spec)
# 哨兵先行:guard_drive 顶层 wrap std 流(Windows GBK 修复),pytest capture 下
# wrap 会住宿主临时文件并 GC 关闭它,宿主收尾崩。哨兵=wrap 整段跳过。
os.environ["GUARD_DRIVE_NO_WRAP"] = "1"
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
