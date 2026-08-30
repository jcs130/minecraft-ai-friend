# -*- coding: utf-8 -*-
"""modpack 清单与部署形态一致性单测（2026-08-30 收纳三件套上服后补）。

守护：
1. modpack.json active 与 mods 目录实集不漂移（本地跑时比对；CI 无 jar 则跳过）；
2. docker-compose 的女神化身直连配置（MC_HOST=mc / MC_PORT=25599）不被改回
   gate 边车——2026-08-30 双门（CFG-GATE/RECIPE-GATE）生效后直连是正解，
   gate 的 PLAY 期翻译层在双端内容 mod 面前有流错位，主 bot 不得再依赖。
"""
import json
import re
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
MODPACK = REPO / "ops" / "docker" / "modpack.json"
MODS_DIR = REPO / "ops" / "docker" / "shadow" / "mc" / "mods"
COMPOSE = REPO / "ops" / "docker" / "shadow" / "docker-compose.yml"


def _active_jars():
    d = json.loads(MODPACK.read_text(encoding="utf-8"))
    jars = []
    for group, entries in d["active"].items():
        if group.startswith("_"):
            continue
        jars.extend(k for k in entries if not k.startswith("_"))
    return jars


def test_modpack_parses_and_unique():
    jars = _active_jars()
    assert len(jars) >= 30, f"现役 mod 数量异常缩水: {len(jars)}"
    dupes = {j for j in jars if jars.count(j) > 1}
    assert not dupes, f"active 里重复条目: {dupes}"
    for j in jars:
        assert "/" not in j and "\\" not in j, f"清单条目应为纯文件名: {j}"
        assert j.endswith(".jar"), f"非 jar 条目: {j}"


def test_modpack_has_storage_trio():
    """2026-08-30 收纳三件套必须在册（造物主钦定，众力技能书收纳）。"""
    jars = set(_active_jars())
    for expect in (
        "curios-neoforge-9.5.1+1.21.1.jar",
        "sophisticatedbackpacks-1.21.1-3.25.78.2107.jar",
        "sophisticatedcore-1.21.1-1.4.90.2299.jar",
    ):
        assert expect in jars, f"收纳三件套缺 {expect}"


def test_modpack_local_deploy_sync():
    """本地部署现场比对：active 清单 ⊆ shadow/mc/mods 实集（CI 无 jar 跳过）。

    反向漂移（目录有 jar 但清单没有）不判死罪（临时排障 jar 常见），
    打印提醒即可；正向漂移（清单有而目录没有）= 部署缺失，必须抓。
    """
    if not MODS_DIR.is_dir() or not list(MODS_DIR.glob("*.jar")):
        pytest.skip("mods 目录无 jar（CI 干净 checkout），本地部署时才比对")
    on_disk = {p.name for p in MODS_DIR.glob("*.jar")}
    missing = [j for j in _active_jars() if j not in on_disk]
    assert not missing, f"清单在册但 mods 目录缺失（会被静默不加载）: {missing}"


def test_compose_goddess_direct_connect():
    """女神化身必须直连 mc:25599，不得回退 gate:25700（双门 mixin 生效后）。"""
    text = COMPOSE.read_text(encoding="utf-8")
    m = re.search(r"MC_HOST:\s*(\S+)", text)
    assert m, "compose 里找不到 MC_HOST"
    assert m.group(1) == "mc", f"MC_HOST={m.group(1)}——女神化身应直连 mc（双门生效后勿再绕 gate）"
    m2 = re.search(r'MC_PORT:\s*"?(\d+)"?', text)
    assert m2 and m2.group(1) == "25599", f"MC_PORT={m2 and m2.group(1)}——应为 25599"


def test_gate_container_still_defined():
    """gate 容器保留（Taro 等穿越者仍走），只是女神化身不再依赖。"""
    text = COMPOSE.read_text(encoding="utf-8")
    assert re.search(r"^\s+gate:", text, re.M), "gate 服务定义被删了？穿越者链路还在用"
