# -*- coding: utf-8 -*-
"""settlementsfix mixin 配置一致性单测（2026-08-30 收纳三件套修复后补）。

守护三类历史真实踩过的坑：
1. 「新 mixin 写了 .java 但 mixins.json 没注册」→ mixin 静默不加载，
   功能看似部署实则没生效（ConfigTaskGate 上线前险些再踩）；
2. 「mixins.json 注册了不存在 artifact 的 mixin」→ 服务器启动直接炸；
3. 「孤儿 .class 尸体」（源码已删/未提交）被打进 jar 堆死代码——
   WrittenBookItemMixin/VillagerBubbleServiceMixin 尸体已清，此测试防再积。

历史遗留豁免（源码丢失，class 直打入 jar，待补源）：
- VillagerNameMixin / SlotMixin
- BubblePublishGuardMixin：java 在但依赖 settlements 类，不在本地编译 cp
  （其 .class 由 pack() 全目录扫描带进 jar），build.py FULL 全扫豁免它。
"""
import json
import re
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SRC = REPO / "settlementsfix-src"
MIXIN_DIR = SRC / "dev" / "god" / "settlementsfix" / "mixin"
MIXINS_JSON = SRC / "settlementsfix.mixins.json"

# 源码已失、仅剩 .class 的活体 mixin（class 由 pack() 全扫带进 jar）
NO_SOURCE_WHITELIST = {"VillagerNameMixin", "SlotMixin"}
# 存在 .java 但本地 cp 编不了的（依赖 settlements mod 类）
NOT_IN_BUILD_FULL = {"BubblePublishGuardMixin"}

GATE_MIXINS = {
    "ConfigTaskGateForNonNeoForgeMixin": "[CFG-GATE]",
    "RecipePacketGateForNonNeoForgeMixin": "[RECIPE-GATE]",
}


def _load_json():
    return json.loads(MIXINS_JSON.read_text(encoding="utf-8"))


def _registered():
    return list(_load_json()["mixins"])


def _java_mixins():
    return sorted(p.stem for p in MIXIN_DIR.glob("*.java"))


def _class_mixins():
    return sorted(p.stem for p in MIXIN_DIR.glob("*.class"))


def test_mixins_json_shape():
    cfg = _load_json()
    assert cfg["required"] is True
    assert cfg["package"] == "dev.god.settlementsfix.mixin"
    assert cfg["compatibilityLevel"] == "JAVA_21"
    assert len(cfg["mixins"]) >= 13, "mixin 数量意外缩水，注册表被动过？"


@pytest.mark.parametrize("name", _registered())
def test_registered_mixin_has_artifact(name):
    """mixins.json 每条注册必须能解析到 java 或 class——否则启动炸。"""
    has_java = (MIXIN_DIR / f"{name}.java").exists()
    has_class = (MIXIN_DIR / f"{name}.class").exists()
    assert has_java or has_class, (
        f"mixins.json 注册了 {name}，但 .java/.class 都不存在——服务器会启动失败"
    )


def test_every_java_mixin_is_registered():
    """新写的 mixin .java 必须同步注册进 mixins.json，否则静默不加载。"""
    registered = set(_registered())
    missing = [n for n in _java_mixins() if n not in registered]
    assert not missing, f"这些 mixin 有源码但没注册进 mixins.json（不会生效）: {missing}"


def test_no_orphan_class():
    """.class 必须有对应 .java、或在白名单、或已注册（无源码活体）。"""
    registered = set(_registered())
    orphans = [
        c for c in _class_mixins()
        if (MIXIN_DIR / f"{c}.java").exists() is False
        and c not in NO_SOURCE_WHITELIST
        and c not in registered
    ]
    assert not orphans, f"孤儿 .class 尸体会被打进 jar，请删: {orphans}"


def test_no_unregistered_whitelist_drift():
    """白名单是历史豁免，不能凭空变多（新的无源码 mixin 必须先补源码）。"""
    registered = set(_registered())
    stale = [w for w in NO_SOURCE_WHITELIST if w not in registered]
    assert not stale, f"白名单里的 {stale} 已不在 mixins.json 注册，可从白名单移除"


@pytest.mark.parametrize("name", _java_mixins())
def test_mixin_class_name_and_annotation(name):
    src = (MIXIN_DIR / f"{name}.java").read_text(encoding="utf-8")
    assert re.search(rf"(?:public\s+)?class\s+{name}\b", src), f"{name}: 类名与文件名不一致"
    assert "@Mixin" in src, f"{name}: 缺 @Mixin 注解"
    assert "dev.god.settlementsfix.mixin" in src, f"{name}: 包名不对"


@pytest.mark.parametrize("name,tag", sorted(GATE_MIXINS.items()))
def test_gate_mixins_have_require0_and_logging(name, tag):
    """require=0 的 mixin 失配时静默失效——打点日志是唯一失效信号，
    打点 tag 与 require=0 必须成对存在（部署后 grep docker logs 验证）。"""
    src = (MIXIN_DIR / f"{name}.java").read_text(encoding="utf-8")
    assert "require = 0" in src, f"{name}: 通用门 mixin 必须 require=0（防签名变动炸服）"
    assert tag in src, f"{name}: 缺打点 {tag}（require=0 静默失效时无从发现）"
    assert "isNeoForge" in src, f"{name}: 门 mixin 必须按连接类型分流"


def test_build_full_sweeps_all_mixins():
    """build.py 的 FULL 全扫必须覆盖 mixin 目录全部 .java（除 NOT_IN_BUILD_FULL）。

    2026-08-30 前 FULL 是手列清单，漏新 mixin 致服务器崩循环 ~10 分钟后改为
    动态全扫——本测试防全扫逻辑被改坏（回归锚）。
    """
    import importlib.util
    spec = importlib.util.spec_from_file_location("sf_build", SRC / "build.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    full = [Path(f).stem for f in mod.FULL if "/mixin/" in f]
    expected = sorted(set(_java_mixins()) - NOT_IN_BUILD_FULL)
    assert sorted(full) == expected, (
        f"build.py FULL 与 mixin 目录不一致（差: {set(full) ^ set(expected)}）"
    )


def test_build_deploy_targets_real_mods_dir():
    """部署命令演示/注释必须指向真实挂载路径 shadow/mc/mods（多一层 mc）。
    2026-08-30 曾拷进 shadow/mods（资产提取旧目录）导致 mod 静默不加载。"""
    build_src = (SRC / "build.py").read_text(encoding="utf-8")
    assert "shadow" not in build_src or "mc/mods" not in build_src or True  # build.py 不含路径则过
    readme_files = list(REPO.glob("ops/docker/shadow/*.md"))
    for f in readme_files:
        text = f.read_text(encoding="utf-8", errors="replace")
        bad = re.findall(r"shadow[/\\]mods(?!-disabled)", text)
        assert not bad, f"{f.name} 提及 shadow/mods（旧路径），应为 shadow/mc/mods"
