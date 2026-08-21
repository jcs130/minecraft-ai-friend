# -*- coding: utf-8 -*-
"""直启 skin-proxy（node 宿主机），DETACHED 后台。
拓扑: 客户端 -> [proxy :25565] -> java :25599
前置: 主服必须已从 25565 迁到 25599（否则端口冲突拒绝启动）。
"""
import subprocess, os, time, socket, sys

NODE = "node"
SCRIPT = r"C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\sidecar\skin-proxy.mjs"
CWD = r"C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend"
SKINS_FILE = r"C:\Users\lzl19\.copaw\workspaces\default\deepseek-harness\scratch-plugin\data\skins.json"
STAT_FILE = r"C:\Users\lzl19\.copaw\workspaces\default\deepseek-harness\scratch-plugin\data\skin-proxy-status.json"
LOG = r"C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\sidecar\skin-proxy.log"


def port_open(port):
    try:
        s = socket.create_connection(("127.0.0.1", port), timeout=2)
        s.close()
        return True
    except OSError:
        return False


if port_open(25565):
    print("25565 已被占用（主服未停？），拒绝启动 proxy")
    sys.exit(1)

env = os.environ.copy()
env["SKINS_FILE"] = SKINS_FILE
env["SKIN_PROXY_STAT"] = STAT_FILE
env["SKIN_LISTEN_PORT"] = "25565"
env["SKIN_UPSTREAM_HOST"] = "127.0.0.1"
env["SKIN_UPSTREAM_PORT"] = "25599"

lf = open(LOG, "ab")
lf.write(f"\n===== [manual boot] {time.strftime('%Y-%m-%d %H:%M:%S')} =====\n".encode("utf-8"))
p = subprocess.Popen(
    [NODE, SCRIPT],
    cwd=CWD, env=env, stdout=lf, stderr=subprocess.STDOUT,
    creationflags=subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW,
)
print("skin-proxy 直启 PID", p.pid, "日志", LOG)
