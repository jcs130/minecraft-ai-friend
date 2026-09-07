"""External Agent stdio entry point for the independent Qiandengji Minecraft instance."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import runpy
import shutil
import sys

PROJECT = Path(__file__).resolve().parents[1]
WORLD = PROJECT / "world"
WORLD_DATA = PROJECT / "server" / "world-data"


def configure():
    companion = os.environ.get("NUMEN_COMPANION") or "QiandengAgent"
    if not re.fullmatch(r"[A-Za-z0-9_]{1,16}", companion):
        raise ValueError("NUMEN_COMPANION must be a 1-16 character Minecraft login name")
    secret = WORLD_DATA / "rcon-secret.txt"
    if not WORLD_DATA.is_dir() or not secret.is_file():
        raise ValueError("Prepare this project's independent server/world-data and RCON secret first")
    # Never inherit a production RCON credential, host, port or channel path.
    os.environ.pop("RCON_PASSWORD", None)
    os.environ.pop("RCON_PW", None)
    values = {
        "NUMEN_REPO_ROOT": str(WORLD), "MC_DATA_DIR": str(WORLD_DATA),
        "NUMEN_DATA_DIR": str(WORLD_DATA),
        "NUMEN_SKILLS_DIR": str(WORLD / "sidecar" / "guard" / "skills"),
        "MC_RCON_HOST": "127.0.0.1", "MC_RCON_PORT": "25577",
        "MC_RCON_SECRET": str(secret),
        "MC_HOST": "127.0.0.1", "MC_PORT": "25567", "RCON_PORT": "25577",
        "NUMEN_COMPANION": companion,
        "NUMEN_DISPLAY": os.environ.get("NUMEN_DISPLAY") or "千灯使者",
        "GUARD_RENDER_NAME": "QDRenderBot",
        "PYTHONIOENCODING": "utf-8",
    }
    os.environ.update(values)
    dependencies = Path(os.environ.get("NUMEN_NODE_MODULES") or WORLD / "node_modules").resolve()
    os.environ["NUMEN_NODE_MODULES"] = str(dependencies)
    os.environ["TSX_CLI"] = str(dependencies / "tsx" / "dist" / "cli.mjs")
    os.environ["NODE_EXE"] = os.environ.get("NODE_EXE") or shutil.which("node") or "node"
    return {"project": "qiandengji", "companion": companion,
            "rcon": "127.0.0.1:25577", "minecraft": "127.0.0.1:25567",
            "transport": "stdio", "renderLauncherPresent": Path(os.environ["TSX_CLI"]).is_file(),
            "visualRenderingTested": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Print paths/readiness only; no MCP, RCON or login")
    args = parser.parse_args()
    try:
        report = configure()
    except Exception as exc:
        print(f"Independent MCP setup failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1
    if args.check:
        print(json.dumps(report, ensure_ascii=False))
        return 0
    # The MCP server itself does not create a body. The operator binds an explicitly
    # prepared Numen body; loading/listing/reading local skill docs uses no RCON.
    runpy.run_path(str(WORLD / "sidecar" / "guard" / "mcp_numen.py"), run_name="__main__")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
