"""神使通道客户端（God Channel client, v1 文件传输）。

创世天神/女神进程对 MC 服务器的进程内控制面——零网络、零认证，
与服务器同机共享数据目录（docker bind mount）。服务端实现见
numen-reference `actuator/neoforge` 的 `GodChannel.java`。

用法：
    from god_channel import GodChannel
    god = GodChannel(r"C:\\...\\ops\\docker\\data\\god-channel")  # 容器内 = /data/god-channel
    print(god.status())                                   # 读世界信标（每 5s 由服务端覆写）
    print(god.send("list"))                               # 假玩家列表
    print(god.send("exec", command="time set noon"))      # 通用控制台命令
    print(god.send("invoke", companion="桐人", tool="task_status", args={}))

协议要点：
  - 请求写 <root>/inbox/<ts>-<id>.json（tmp+rename 原子落盘，单写者=本进程侧）；
  - 回执在 <root>/outbox/<id>.json：{"id","ok","result"/"error","ts"}；
  - 服务端每 0.5s 轮询，处理即归档 inbox/processed/（不自动重试）；
  - 传输层可换：动词表与请求/回执结构是接口，文件只是 v1 传输。
"""

from __future__ import annotations

import json
import os
import pathlib
import time
import uuid

_MAX_ID_LEN = 64


def _sanitize(rid: str) -> str:
    s = "".join(c if (c.isalnum() or c in "_.-") else "_" for c in rid)
    return s[:_MAX_ID_LEN]


class GodChannel:
    def __init__(self, base_dir: str | pathlib.Path):
        self.root = pathlib.Path(base_dir)
        self.inbox = self.root / "inbox"
        self.outbox = self.root / "outbox"
        self.status_file = self.root / "world-status.json"
        self.inbox.mkdir(parents=True, exist_ok=True)

    # ---------- 发令 ----------

    def send(self, cmd: str, wait: bool = True, timeout: float = 10.0, **params):
        """发一条指令。params 原样并入请求体（如 companion/tool/args/message/command）。
        wait=True 阻塞到回执；wait=False 只回请求 id。"""
        rid = str(params.pop("id", None) or uuid.uuid4().hex[:12])
        req = {"id": rid, "cmd": cmd, **params}
        name = f"{int(time.time() * 1000)}-{_sanitize(rid)}.json"
        tmp = self.inbox / (name + ".tmp")
        final = self.inbox / name
        tmp.write_text(json.dumps(req, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, final)  # 原子落盘，服务端永远看不到半截请求
        if not wait:
            return rid
        return self.wait_reply(rid, timeout)

    def wait_reply(self, rid: str, timeout: float = 10.0) -> dict:
        out = self.outbox / f"{_sanitize(rid)}.json"
        deadline = time.time() + timeout
        while time.time() < deadline:
            if out.exists():
                return json.loads(out.read_text(encoding="utf-8"))
            time.sleep(0.2)
        raise TimeoutError(f"god-channel reply timeout: {rid}")

    # ---------- 读信标 ----------

    def status(self, max_age_s: float = 30.0) -> dict:
        """读世界信标（服务端每 5s 原子覆写）。max_age_s 内无更新视为服务端失联。"""
        data = json.loads(self.status_file.read_text(encoding="utf-8"))
        st = data.get("status", data)
        age = (time.time() * 1000 - st.get("ts", 0)) / 1000
        if age > max_age_s:
            raise ConnectionError(f"god-channel beacon stale ({age:.0f}s old) — server down?")
        return st


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 3:
        print("usage: python god_channel.py <channel_dir> <cmd> [json_params]")
        print('example: python god_channel.py ./data/god-channel exec \'{"command":"list"}\'')
        sys.exit(2)
    params = json.loads(sys.argv[3]) if len(sys.argv) > 3 else {}
    print(json.dumps(GodChannel(sys.argv[1]).send(sys.argv[2], **params),
                     ensure_ascii=False, indent=2))
