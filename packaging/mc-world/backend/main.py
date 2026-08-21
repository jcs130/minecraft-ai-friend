# -*- coding: utf-8 -*-
"""mc-world —— 标准版 MC + AI 原住民（PawApp 后端入口）。

阶段 2：双进程拉起
  - MC 服务端（NeoForge 21.1.73 + numen/settlements mods）→ assets/mc-server/
  - 世界进程（Node/TS 天神化身，唯一 RCON 持有者）→ assets/world/

启动序：随机化 RCON 密码 → 拉起 MC 服务端 → 后台等 MC 就绪 → 拉起世界进程。
关停序：世界进程 terminate → MC 服务端 stdin「stop」优雅关服。
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
import secrets
import shutil
import subprocess
from pathlib import Path

from qwenpaw.pawapp import PawApp

logger = logging.getLogger("qwenpaw").getChild("plugin.mc_world")

BACKEND_DIR = Path(__file__).resolve().parent
PLUGIN_DIR = BACKEND_DIR.parent
ASSETS_DIR = PLUGIN_DIR / "assets"
MC_SERVER_DIR = ASSETS_DIR / "mc-server"
WORLD_DIR = ASSETS_DIR / "world"
DATA_DIR = ASSETS_DIR / "data"
LOG_DIR = PLUGIN_DIR / "logs"

NEOFORGE_VER = "21.1.73"
RCON_PLACEHOLDER = "__MC_WORLD_RCON__"
MC_PORT = 25599  # MC 服务端端口；25565 留给 skin-proxy / 真人客户端
RCON_PORT = 25575
GOD_NAME = "Goddess"

app = PawApp("MC 异世界", app_id="mc-world")

_mc_proc: subprocess.Popen | None = None
_world_proc: subprocess.Popen | None = None


# ─── 运行环境探测 ──────────────────────────────────────────
def _find_exe(env_var: str, name: str, java_home_subdir: str | None = None) -> str | None:
    """探测可执行：env 指定路径 → JAVA_HOME → PATH。"""
    p = os.environ.get(env_var)
    if p and Path(p).exists():
        return p
    if java_home_subdir:
        java_home = os.environ.get("JAVA_HOME")
        if java_home:
            cand = Path(java_home) / java_home_subdir / name
            if cand.exists():
                return str(cand)
    return shutil.which(name)


def _find_java() -> str | None:
    name = "java.exe" if os.name == "nt" else "java"
    return _find_exe("MC_JAVA_PATH", name, java_home_subdir="bin")


def _find_node() -> str | None:
    name = "node.exe" if os.name == "nt" else "node"
    return _find_exe("MC_NODE_PATH", name)


# ─── RCON 密码（首启随机化） ───────────────────────────────
def _ensure_rcon_secret() -> str:
    """首启随机化 RCON 密码，同步写 server.properties 与 DATA_DIR/rcon-secret.txt。"""
    secret_path = DATA_DIR / "rcon-secret.txt"
    if secret_path.exists():
        secret = secret_path.read_text(encoding="utf-8").strip()
        if secret:
            return secret
    secret = secrets.token_hex(16)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    secret_path.write_text(secret, encoding="utf-8")
    props_path = MC_SERVER_DIR / "server.properties"
    props = props_path.read_text(encoding="utf-8")
    props = re.sub(r"^rcon\.password=.*$", f"rcon.password={secret}", props, flags=re.M)
    props_path.write_text(props, encoding="utf-8")
    logger.info("mc-world：已随机化 RCON 密码并落盘")
    return secret


# ─── MC 服务端 ────────────────────────────────────────────
async def _start_mc() -> subprocess.Popen | None:
    java = _find_java()
    if not java:
        logger.error("mc-world：未找到 Java（MC_JAVA_PATH/JAVA_HOME/PATH），MC 服务端未启动")
        return None
    args_file = "win_args.txt" if os.name == "nt" else "unix_args.txt"
    args_txt = f"@libraries/net/neoforged/neoforge/{NEOFORGE_VER}/{args_file}"
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    logf = open(LOG_DIR / "mc-server.log", "ab", buffering=0)
    cmd = [java, "@user_jvm_args.txt", args_txt, "nogui"]
    logger.info("mc-world：拉起 MC 服务端 [%s]", " ".join(cmd))
    return subprocess.Popen(
        cmd, cwd=MC_SERVER_DIR, stdout=logf, stderr=subprocess.STDOUT,
        stdin=subprocess.PIPE,  # 关服时写「stop」
    )


async def _wait_mc_ready(timeout: float = 180.0) -> bool:
    """轮询 latest.log 出现「Done (」判 MC 就绪。"""
    latest = MC_SERVER_DIR / "logs" / "latest.log"
    waited = 0.0
    while waited < timeout:
        if latest.exists():
            try:
                if "Done (" in latest.read_text(encoding="utf-8", errors="replace"):
                    return True
            except OSError:
                pass
        await asyncio.sleep(2.0)
        waited += 2.0
    return False


# ─── 世界进程 ─────────────────────────────────────────────
async def _start_world() -> subprocess.Popen | None:
    node = _find_node()
    if not node:
        logger.error("mc-world：未找到 Node（MC_NODE_PATH/PATH），世界进程未启动")
        return None
    if not (WORLD_DIR / "node_modules").exists():
        logger.warning(
            "mc-world：assets/world/node_modules 缺失 —— 请先 npm install "
            "（cd %s && npm install），或设 MC_AUTO_NPM_INSTALL=1 自动安装", WORLD_DIR
        )
        if os.environ.get("MC_AUTO_NPM_INSTALL") == "1":
            logger.info("mc-world：自动 npm install（可能耗时）...")
            await asyncio.to_thread(
                subprocess.run, ["npm", "install"], cwd=WORLD_DIR, check=False
            )
        else:
            return None
    env = os.environ.copy()
    env["MC_DATA_DIR"] = str(DATA_DIR)
    env["MC_LOG_PATH"] = str(MC_SERVER_DIR / "logs" / "latest.log")
    env["MC_ADVANCEMENTS_DIR"] = str(MC_SERVER_DIR / "world" / "advancements")
    env["MC_GOD_NAME"] = GOD_NAME
    env["MC_HOST"] = "localhost"
    env["MC_PORT"] = str(MC_PORT)
    env["MC_RCON_PORT"] = str(RCON_PORT)
    logf = open(LOG_DIR / "world-process.log", "ab", buffering=0)
    cmd = [node, "--import", "tsx", "bootstrap-world.mts"]
    logger.info("mc-world：拉起世界进程 [%s]", " ".join(cmd))
    return subprocess.Popen(
        cmd, cwd=WORLD_DIR, env=env, stdout=logf, stderr=subprocess.STDOUT,
    )


async def _start_world_after_mc() -> None:
    """后台任务：等 MC 就绪后再拉起世界进程（不阻塞 startup）。"""
    global _world_proc
    if await _wait_mc_ready():
        _world_proc = await _start_world()
    else:
        logger.warning("mc-world：MC 服务端 %ss 内未就绪，世界进程未拉起", 180)


# ─── 优雅关停 ─────────────────────────────────────────────
async def _stop_world() -> None:
    global _world_proc
    if _world_proc and _world_proc.poll() is None:
        _world_proc.terminate()
        try:
            await asyncio.to_thread(_world_proc.wait, timeout=10)
        except subprocess.TimeoutExpired:
            _world_proc.kill()
        logger.info("mc-world：世界进程已停")


async def _stop_mc() -> None:
    global _mc_proc
    if _mc_proc and _mc_proc.poll() is None:
        try:
            if _mc_proc.stdin:
                _mc_proc.stdin.write(b"stop\n")
                _mc_proc.stdin.flush()
            await asyncio.to_thread(_mc_proc.wait, timeout=60)
        except (subprocess.TimeoutExpired, OSError):
            _mc_proc.kill()
        logger.info("mc-world：MC 服务端已停")


# ─── 生命周期钩子 ─────────────────────────────────────────
@app.hook("startup", priority=90)
async def _startup() -> None:
    global _mc_proc
    _ensure_rcon_secret()
    _mc_proc = await _start_mc()
    if _mc_proc:
        # 世界进程依赖 MC 就绪，放后台等，不阻塞 QwenPaw 启动
        asyncio.create_task(_start_world_after_mc())


@app.hook("shutdown", priority=90)
async def _shutdown() -> None:
    await _stop_world()
    await _stop_mc()
    logger.info("mc-world shutdown")


# PluginLoader 查找的入口变量
plugin = app
