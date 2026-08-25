# -*- coding: utf-8 -*-
"""重启世界进程（Goddess 化身，Node/TS，唯一 RCON 持有者）。

停掉旧的 bootstrap-world.mts 进程，再用 node+tsx 直接拉起（绕过 start-world.bat 的
批处理编码坑——UTF-8 中文注释在 cmd /c 下会被 GBK 误读、拆坏 set 行）。
MC 主服（Java）不受影响，只重启 TS 侧世界进程。
"""
import subprocess, os, time

WS = r"C:\Users\lzl19\.copaw\workspaces\default"
REPO = os.path.join(WS, "minecraft-ai-friend")
# 2026-08-26 全量清理：A 仓 deepseek-harness 引用已全部清除，B 仓完全自持（mc-server / mc-data / node_modules）
DATA = os.environ.get("MC_DATA_DIR_OVERRIDE") or os.path.join(REPO, "mc-data")
NODE = r"C:\Program Files\nodejs\node.exe"
TSX_CLI = os.path.join(REPO, "node_modules", "tsx", "dist", "cli.mjs")


def ps(cmd_script: str) -> str:
    return subprocess.run(["powershell", "-NoProfile", "-Command", cmd_script],
                          capture_output=True, text=True).stdout.strip()


def world_pids() -> list[str]:
    cmd = ("Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | "
           "Where-Object { $_.CommandLine -like '*bootstrap-world.mts*' } | "
           "Select-Object -ExpandProperty ProcessId")
    return [p for p in ps(cmd).split() if p.strip()]


def build_env() -> dict:
    env = os.environ.copy()
    env.pop("PYTHONHOME", None)
    env.pop("PYTHONPATH", None)
    env["MC_GOD_NAME"] = "Goddess"
    env["MC_PORT"] = "25599"
    env["MC_VIEWER"] = "1"
    env["MC_VIEWER_PORT"] = "3050"
    env["MC_DATA_DIR"] = DATA
    env["MC_LOG_PATH"] = os.path.join(REPO, "mc-server", "logs", "latest.log")
    env["MC_ADVANCEMENTS_DIR"] = os.path.join(REPO, "mc-server", "world", "advancements")
    env["MC_VIP_LISTEN"] = "mengmeng,kangqiang"
    return env


def main() -> None:
    pids = world_pids()
    for pid in pids:
        subprocess.run(["powershell", "-NoProfile", "-Command",
                        f"Stop-Process -Id {pid} -Force"], capture_output=True)
        print(f"[restart-world] stopped world pid {pid}")
    if not pids:
        print("[restart-world] no running world process (cold start)")

    time.sleep(2)

    DETACHED = 0x00000008 | 0x00000200 | 0x08000000  # DETACHED_PROCESS | NEW_PROCESS_GROUP | NO_WINDOW
    wlog = os.path.join(DATA, "world-process.log")
    wlog_err = os.path.join(DATA, "world-process.err.log")

    with open(wlog, "ab") as out, open(wlog_err, "ab") as err:
        out.write(("\n===== world boot (restart-world) %s =====\n" % time.strftime("%Y-%m-%d %H:%M:%S")).encode("utf-8"))
        p = subprocess.Popen([NODE, TSX_CLI, "bootstrap-world.mts"], cwd=REPO, env=build_env(),
                             stdout=out, stderr=err, creationflags=DETACHED, close_fds=True)
    print(f"[restart-world] launched node tsx bootstrap-world.mts (launcher pid={p.pid})")

    time.sleep(15)

    pids2 = world_pids()
    print(f"[restart-world] world pid after boot: {pids2 or 'NONE'}")

    if os.path.exists(wlog):
        with open(wlog, "rb") as f:
            f.seek(0, os.SEEK_END)
            f.seek(max(0, f.tell() - 2000))
            tail = f.read().decode("utf-8", errors="replace")
        print("--- world-process.log tail ---")
        print(tail[-1500:])


if __name__ == "__main__":
    main()
