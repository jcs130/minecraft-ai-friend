"""Manage only the isolated QiandengJi Docker project."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import secrets
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def docker(*args, check=True, capture=False):
    return subprocess.run(["docker", "compose", "--project-directory", str(ROOT),
                           "-f", str(ROOT / "compose.yml"), *args], cwd=ROOT,
                          check=check, capture_output=capture, text=True, encoding="utf-8", errors="replace")


def setup():
    env = ROOT / ".env"
    values = {}
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.startswith("#"):
                key, val = line.split("=", 1)
                values[key] = val
    password = values.get("QIANDENG_RCON_PASSWORD")
    if not password:
        password = secrets.token_hex(24)
        with env.open("a", encoding="utf-8") as out:
            out.write("\nQIANDENG_RCON_PASSWORD=" + password + "\n")
    data = ROOT / "server" / "world-data"
    data.mkdir(parents=True, exist_ok=True)
    (data / "rcon-secret.txt").write_text(password, encoding="utf-8")
    # Static fallback definitions only; the imported player's progression wins.
    for source in (ROOT / "world" / "data").glob("*.json"):
        target = data / source.name
        if not target.exists():
            target.write_bytes(source.read_bytes())
    print("Local runtime configured. Credentials are stored only in ignored local files.")


def main():
    if sys.argv[1:2]==['ops']:
        from operations import main as operations_main
        return operations_main(sys.argv[2:])
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("action", choices=("setup", "start", "stop", "status", "logs", "rcon", "ops"))
    ap.add_argument("extra", nargs="*")
    args = ap.parse_args()
    if args.action == "setup":
        setup()
    elif args.action == "start":
        if not (ROOT / "server" / "mc" / "shadow" / "level.dat").is_file():
            ap.error("No imported shadow save. Import the existing save before starting.")
        setup()
        docker("up", "-d", *(args.extra or ["tts", "mc", "world", "gate", "npc", "resources", "qwenpaw", "voice", "asr", "control", "panel"]))
    elif args.action == "stop":
        docker("stop", *args.extra)
    elif args.action == "status":
        docker("ps", "-a")
    elif args.action == "logs":
        docker("logs", "--tail", "80", *(args.extra or ["mc", "world"]))
    elif args.action == "rcon":
        if not args.extra:
            ap.error("rcon requires a command")
        docker("exec", "-T", "mc", "rcon-cli", " ".join(args.extra))
    return 0


if __name__ == "__main__":
    sys.exit(main())
