# -*- coding: utf-8 -*-
"""health_mon 单元测试(纯逻辑,零网络零依赖,CI 可跑)"""
import importlib.util
import io
import json
import os
import sys
import time

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
HM_PATH = os.path.join(HERE, "..", "ops", "health", "health_mon.py")


def load_hm():
    spec = importlib.util.spec_from_file_location("health_mon", HM_PATH)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


hm = load_hm()


# ---------- Rcon 包编码(不发网络) ----------
class FakeSock:
    def __init__(self):
        self.sent = b""

    def sendall(self, data):
        self.sent += data


def test_rcon_pkt_encoding():
    """SERVERDATA_EXECCOMMAND 包:length + requestid + type(2) + body + 两字节 NUL。"""
    r = hm.Rcon.__new__(hm.Rcon)  # 不走 __init__(免连)
    r.rid = 7
    fake = FakeSock()
    r.s = fake
    r._pkt(2, "list")
    import struct
    data = fake.sent
    ln = struct.unpack("<i", data[:4])[0]
    assert ln == len(data) - 4
    rid, ptype = struct.unpack("<ii", data[4:12])
    assert rid == 7 and ptype == 2
    assert data[12:12 + 4] == b"list"
    assert data[-2:] == b"\x00\x00"


def test_rcon_pkt_utf8_body():
    """中文命令体按 utf-8 编码,包长按字节数(非字符数)。"""
    r = hm.Rcon.__new__(hm.Rcon)
    r.rid = 1
    fake = FakeSock()
    r.s = fake
    r._pkt(2, "numen_act invoke \"鸣人\" get_self_status {}")
    body = "numen_act invoke \"鸣人\" get_self_status {}".encode("utf-8")
    import struct
    ln = struct.unpack("<i", fake.sent[:4])[0]
    assert ln == 4 + 4 + len(body) + 2  # rid+type+body+2 NUL(length 自身不计入)


# ---------- 节流闸 ----------
def test_reflex_style_cooldown_gate():
    """通用节流语义:首过、冷却内拦、冷却后再过。"""
    cd = {}
    tag = ("Naruto", "eat")
    assert hm._cool(tag, cd, 60) is True       # 首次放行
    assert hm._cool(tag, cd, 60) is False      # 冷却内拦
    cd[tag] = time.time() - 61
    assert hm._cool(tag, cd, 60) is True       # 过期再放行


# ---------- 降级表 ----------
def test_yellow_only_is_retired_3050():
    """viewer-3050 已退役:降级表清空,且探针表里不再有 3050。"""
    assert "viewer-3050" not in hm.HTTP_PROBES
    assert "viewer-3050" not in hm.YELLOW_ONLY


# ---------- report 汇总(monkeypatch 警报文件) ----------
def test_report_groups_by_component(tmp_path, monkeypatch, capsys):
    alerts = tmp_path / "alerts.jsonl"
    now = time.time()
    rows = [
        {"at": "t1", "ts": now - 100, "comp": "guard-bridge", "msg": "dead"},
        {"at": "t2", "ts": now - 50, "comp": "guard-bridge", "msg": "dead again"},
        {"at": "t3", "ts": now - 86400 - 999, "comp": "old", "msg": "out of window"},
    ]
    with io.open(str(alerts), "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    monkeypatch.setattr(hm, "ALERTS", str(alerts))
    rc = hm.report()
    out = capsys.readouterr().out
    assert rc == 1
    assert "guard-bridge: 2x" in out
    assert "old" not in out  # 窗口外的 filt 掉


def test_report_quiet(tmp_path, monkeypatch, capsys):
    alerts = tmp_path / "alerts.jsonl"
    with io.open(str(alerts), "w", encoding="utf-8") as f:
        f.write(json.dumps({"at": "t", "ts": time.time() - 5, "comp": "x", "msg": "y"}) + "\n")
    monkeypatch.setattr(hm, "ALERTS", str(alerts))
    # 单条且在窗口内 -> rc=1
    assert hm.report() == 1
    # 空窗口
    with io.open(str(alerts), "w", encoding="utf-8") as f:
        pass
    assert hm.report() == 0
