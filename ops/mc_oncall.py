# -*- coding: utf-8 -*-
"""真人玩家上线自动到岗 on-call（2026-08-31 萌萌说了一小时没人应根治）。

规则：真人（REAL_PLAYERS）在游戏里，AI 运营与角色就不许下班——
发现任一真人在场而 shadow-world / shadow-qwenpaw / vllm / shadow-guard / shadow-npc
有缺席的，直接 docker start 补齐（幂等，已在跑的不动）。

在线判定权威：MC latest.log 重放 join/leave（不依赖 RCON——世界进程独占 RCON，
旁路短连曾酿风暴，见 LESSONS）。只 tail 日志尾部，2 分钟一跳，成本可忽略。

注册：schtask mc-oncall 每 2 分钟 pythonw 静默跑。
"""
import os
import re
import subprocess
import sys
import time

REPO = r"C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend"
LOG = os.path.join(REPO, "ops", "docker", "shadow", "mc", "logs", "latest.log")
TAIL_BYTES = 4 * 1024 * 1024  # 只回放尾部 4MB（远超 2 分钟窗口）

# 真人登录名（显示名≠程序键——铁律 name/ID 分离）
REAL_PLAYERS = {"MengMeng", "KangQiang", "MicroKQ"}

# 到岗清单（docker start 顺序：模型先起、角色后进村）
FULL_CREW = [
    "vllm-qwen38-ara-df2",
    "shadow-qwenpaw",
    "shadow-guard",
    "shadow-npc",
    "shadow-world",
]

# ASR watcher 保活（2026-08-31）：watcher 自带 msvcrt 单实例锁——每跳无脑拉一次，
# 已在跑的新实例自退，崩了的 ≤2 分钟被接班。无需另设看门狗（曾有看门狗=繁殖源）。
WATCHER_PYW = r"C:\Users\lzl19\AppData\Local\Programs\Python\Python313\pythonw.exe"
WATCHER_SCRIPT = os.path.join(
    REPO, "ops", "docker", "shadow", "god-voice", "mic_asr_watcher.py"
)


def ensure_watcher():
    try:
        if os.path.isfile(WATCHER_PYW) and os.path.isfile(WATCHER_SCRIPT):
            subprocess.Popen(
                [WATCHER_PYW, WATCHER_SCRIPT],
                cwd=os.path.dirname(WATCHER_SCRIPT),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
    except Exception:
        pass


JOIN_RE = re.compile(r"(\w+) joined the game")
LEAVE_RE = re.compile(r"(\w+) left the game")

TASK_LOG = os.path.join(
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
    ensure_watcher()  # 每跳保活（锁挡双开，与真人在否无关）
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
