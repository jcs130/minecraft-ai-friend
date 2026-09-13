"""Manage only the isolated QiandengJi Docker project."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import secrets
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SERVICES = ("tts", "mc", "world", "gate", "npc", "resources", "qwenpaw",
                    "voice", "asr", "control", "panel", "survivor", "inventory")


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
    secret = data / "rcon-secret.txt"
    if secret.exists() and secret.read_text(encoding="utf8").strip() != password:
        raise ValueError("Existing RCON credential differs from .env; reconcile without overwriting it")
    if not secret.exists():
        secret.write_text(password, encoding="utf-8")
    # Static fallback definitions only; the imported player's progression wins.
    for source in (ROOT / "world" / "data").glob("*.json"):
        target = data / source.name
        if not target.exists():
            target.write_bytes(source.read_bytes())
    print("Local runtime configured. Credentials are stored only in ignored local files.")


def preflight(selected):
    """Refuse missing images/binds before Docker can create empty data paths."""
    config = json.loads(docker("config", "--format", "json", capture=True).stdout)
    services = config["services"]
    if not selected or any(name not in services or name not in DEFAULT_SERVICES for name in selected):
        raise ValueError("Choose current game services; archived operations is not a startup target")
    required = set(selected)
    pending = list(selected)
    while pending:
        for dependency in services[pending.pop()].get("depends_on", {}):
            if dependency not in required:
                required.add(dependency)
                pending.append(dependency)
    missing = []
    for name in sorted(required):
        service = services[name]
        image = subprocess.run(["docker", "image", "inspect", service["image"], "--format", "{{.Id}}"],
                               capture_output=True, timeout=20,
                               creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        if image.returncode:
            missing.append(name + ": image " + service["image"])
        for mount in service.get("volumes", []):
            source = mount.get("source", "")
            if source == "/var/run/docker.sock" and mount.get("target") == source:
                continue
            path = Path(source)
            if mount.get("type") != "bind" or not path.resolve().is_relative_to(ROOT.resolve()) or not path.exists():
                missing.append(name + ": missing or external bind " + source)
    if missing:
        raise ValueError("Game startup prerequisites are incomplete:\n" + "\n".join(missing))
    return selected


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
        selected = preflight(args.extra or list(DEFAULT_SERVICES))
        setup()
        docker("up", "-d", "--wait", "--wait-timeout", "600", *selected)
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
