"""Human-only native console discovery. Never fetch account state through host tools."""

import json
import re


def operator_link(settings, data_root):
    """A link is not liveness proof; the native page verifies its per-process instance.

    Only the selected account's private native data directory is read. No URLs,
    tokens, credentials or device codes are accepted from descriptors/config.
    """
    unavailable = {"available": False, "reason": "operator_unavailable",
                   "guidance": "启用本机账户端口并显式启动匹配的执行器；外部运行需在 standalone 配置启用。Java 客户端请使用其自身登录入口。"}
    if not settings.console_port or settings.body_provider != "mineflayer":
        return unavailable
    path = data_root / "sessions" / settings.identity / "client" / "operator.json"
    try:
        with path.open("rb") as source:
            raw = source.read(4097)
        if len(raw) > 4096:
            return unavailable
        row = json.loads(raw)
        if (not isinstance(row, dict) or set(row) != {"schema", "identity", "instanceId", "port"}
                or row["schema"] != "minecraft-operator-binding/v1" or row["identity"] != settings.identity
                or type(row["port"]) is not int or row["port"] != settings.console_port
                or not isinstance(row["instanceId"], str) or not re.fullmatch(r"[a-f0-9]{64}", row["instanceId"])):
            return unavailable
        return {"available": True, "url": f"http://127.0.0.1:{row['port']}/account/{row['instanceId']}", "live_verified": False}
    except (OSError, ValueError):
        return unavailable
