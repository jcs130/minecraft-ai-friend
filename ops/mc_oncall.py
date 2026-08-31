# -*- coding: utf-8 -*-
"""真人玩家上线自动到岗 on-call（2026-08-31 萌萌说了一小时没人应根治）。

规则：真人（REAL_PLAYERS）在游戏里，AI 运营与角色就不许下班——
发现任一真人在场而 shadow-world / shadow-qwenpaw / vllm / shadow-guard / shadow-npc
有缺席的，直接 docker start 补齐（幂等，已在跑的不动）。

在线判定权威：MC latest.log 重放 join/leave（不依赖 RCON——世界进程独占 RCON，
旁路短连曾酿风暴，见 LESSONS）。只 tail 日志尾部，2 分钟一跳，成本可忽略。

注册（2026-08-31 进程收编 docker）：shadow-sentinel 容器循环跑（挂 docker.sock +
/mclogs）；宿主旧 schtask mc-oncall 退役。路径全 env 化，容器/宿主双跑兼容。
"""
import os
import re
import subprocess
import sys
import time

REPO = r"C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend"
LOG = os.environ.get(
    "ONCALL_LOG", os.path.join(REPO, "ops", "docker", "shadow", "mc", "logs", "latest.log")
)
TAIL_BYTES = 4 * 1024 * 1024  # 只回放尾部 4MB（远超 2 分钟窗口）

# 真人登录名（显示名≠程序键——铁律 name/ID 分离）
REAL_PLAYERS = {"MengMeng", "KangQiang", "MicroKQ"}

# 到岗清单（docker start 顺序：模型先起、角色后进村；asr=天耳容器，2026-08-31 收编）
# ⚠ shadow-npc 暂除（R011 遏制）：dedup 逻辑 4h 屠 1916 村民，容器停着是遏制措施，
# 真人在场也不能自动放它出笼——根因排除并冒烟通过前，恢复需人工。
FULL_CREW = [
    "vllm-qwen38-ara-df2",
    "shadow-qwenpaw",
    "shadow-guard",
    "shadow-world",
    "shadow-asr",
    "shadow-voice",
]

JOIN_RE = re.compile(r"(\w+) joined the game")
LEAVE_RE = re.compile(r"(\w+) left the game")

TASK_LOG = os.environ.get("ONCALL_LOG_FILE") or os.path.join(
    REPO, "ops", "docker", "shadow", "mc", "data", "oncall.log"
)  # 自写日志，不信外壳重定向


def log(msg):
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    try:
        try:  # 心跳 18KB/天，超 1MB 滚动一次
            if os.path.getsize(TASK_LOG) > 1024 * 1024:
                os.replace(TASK_LOG, TASK_LOG + ".old")
        except OSError:
            pass
        with open(TASK_LOG, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        pass


def sh(cmd):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True)


def running_set():
    out = sh('docker ps --format "{{.Names}}"').stdout
    return set(x.strip() for x in out.splitlines() if x.strip())


def replay_online():
    """从日志尾部重放 join/leave 得到当前在线玩家集合。"""
    try:
        size = os.path.getsize(LOG)
        with open(LOG, "rb") as f:
            f.seek(max(0, size - TAIL_BYTES))
            data = f.read().decode("utf-8", errors="replace")
    except OSError:
        return set()
    online = set()
    for line in data.splitlines():
        m = JOIN_RE.search(line)
        if m:
            online.add(m.group(1))
            continue
        m = LEAVE_RE.search(line)
        if m:
            online.discard(m.group(1))
    return online


def main():
    online = replay_online()
    real_present = online & REAL_PLAYERS
    # 值班心跳（一行/班，查岗用：证明哨还在走班）
    log("tick online=%s" % (",".join(sorted(online)) or "-"))
    if not real_present:
        return 0
    miss = [c for c in FULL_CREW if c not in running_set()]
    if not miss:
        return 0
    # 有真人在场且有人缺席 → 叫醒（一次 start 全部缺失项）
    subprocess.run(
        ["docker", "start"] + miss, capture_output=True, text=True, timeout=120
    )
    log("real=%s woke=%s" % (",".join(sorted(real_present)), ",".join(miss)))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # 值哨绝不能把自己搞死还没人知道
        log("oncall error: %r" % (e,))
        sys.exit(0)
