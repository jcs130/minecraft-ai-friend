"""Initialize only the isolated project's selected oracle profiles; never starts an agent.

Provider credentials are read once, re-encrypted with a new project key, and
stored exclusively under the ignored server/agents/secret directory.
"""
from __future__ import annotations

import argparse
import base64
from copy import deepcopy
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
from urllib.parse import urlsplit, urlunsplit

from cryptography.fernet import Fernet

PROJECT = Path(__file__).resolve().parents[1]
TARGET = PROJECT / "server" / "agents"
IMAGE = "qwenpaw-mc:2.1.1"
PROFILES = {"mc-god": "灯语女神 · 世界管理", "mc-herald": "灯语女神 · 玩家交流"}


def write_private(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    path.chmod(0o600)


def isolated_url(value: str) -> tuple[str, bool]:
    url = urlsplit(value)
    if url.scheme not in {"http", "https"} or not url.hostname or url.username or url.password:
        raise ValueError("Unsupported provider endpoint")
    local = url.hostname.lower() in {"localhost", "127.0.0.1", "::1"}
    if local:
        authority = "host.docker.internal" + (f":{url.port}" if url.port else "")
        return urlunsplit((url.scheme, authority, url.path, url.query, url.fragment)), True
    return value, False


def select_oracle_models(manifest, use_source_herald_model=False):
    """Choose providers without changing role identity or importing source tools."""
    result = deepcopy(manifest)
    profiles = {item['id']: item for item in result['profiles']}
    if set(profiles) != {'mc-god', 'mc-herald'}:
        raise ValueError('Both isolated oracle profiles must be selected')
    god, herald = profiles['mc-god'], profiles['mc-herald']
    herald['source_model_selection'] = {key: deepcopy(herald[key])
                                        for key in ('active_model', 'provider_kind', 'local_model')}
    if use_source_herald_model:
        result['model_policy'] = 'explicit-source-herald-model'
        return result
    if god['local_model']:
        raise ValueError('Default herald fallback requires a nonlocal mc-god provider')
    for key in ('active_model', 'provider_kind', 'local_model'):
        herald[key] = deepcopy(god[key])
    result['model_policy'] = 'herald-uses-god-cloud-provider'
    return result


def prepare(args):
    if TARGET.exists() and any(TARGET.iterdir()):
        raise ValueError("Isolated agents directory is not empty; refusing to reset existing runtime")
    source = Path(args.source_work).resolve()
    secret_source = Path(args.source_secret).resolve()
    master_hex = secrets.token_hex(32)
    cipher = Fernet(base64.urlsafe_b64encode(bytes.fromhex(master_hex)))
    source_cipher = None
    providers = {}
    manifest = {"project": "qiandengji", "profiles": []}
    for aid, label in PROFILES.items():
        # Only the model choice is read from the source agent; no tools or sessions.
        agent = json.loads((source / "workspaces" / aid / "agent.json").read_text(encoding="utf-8-sig"))
        active = agent["active_model"]
        pid, mid = active["provider_id"], active["model"]
        if not pid or not mid or Path(pid).name != pid or any(c in pid for c in "/\\:"):
            raise ValueError("Invalid selected model identifier")
        found = [(kind, secret_source / "providers" / kind / f"{pid}.json") for kind in ("builtin", "custom")]
        found = [(kind, path) for kind, path in found if path.is_file()]
        if len(found) != 1:
            raise ValueError("Selected provider must resolve to exactly one source file")
        kind, path = found[0]
        provider = json.loads(path.read_text(encoding="utf-8-sig"))
        endpoint, local = isolated_url(provider["base_url"])
        api_key = provider.get("api_key", "")
        if api_key.startswith("ENC:"):
            if source_cipher is None:
                source_key = (secret_source / ".master_key").read_text(encoding="ascii").strip()
                source_cipher = Fernet(base64.urlsafe_b64encode(bytes.fromhex(source_key)))
            api_key = source_cipher.decrypt(api_key[4:].encode()).decode()
        selected = {"id": pid, "name": provider.get("name") or pid,
                    "base_url": endpoint, "chat_model": "OpenAIChatModel",
                    "api_key": "ENC:" + cipher.encrypt(api_key.encode()).decode() if api_key else "",
                    "is_custom": kind == "custom", "is_local": local,
                    "require_api_key": bool(api_key), "support_model_discovery": False,
                    "extra_models": [{"id": mid, "name": mid}], "models": []}
        if provider.get("chat_model", "OpenAIChatModel") != "OpenAIChatModel":
            raise ValueError("Selected provider adapter needs a separate image compatibility review")
        # Keep only ordinary generation values, never custom headers or auth modes.
        kwargs = provider.get("generate_kwargs") or {}
        selected["generate_kwargs"] = {k: v for k, v in kwargs.items()
                                       if k in {"temperature", "top_p", "max_tokens"} and isinstance(v, (int, float))}
        providers[(kind, pid)] = selected
        manifest["profiles"].append({"id": aid, "name": label, "language": "zh",
                                     "active_model": {"provider_id": pid, "model": mid},
                                     "provider_kind": kind, "local_model": local})
    manifest = select_oracle_models(manifest, args.use_source_herald_model)
    # All source validation/decryption succeeds before any target state is written.
    target_secret = TARGET / "secret"
    target_secret.mkdir(parents=True)
    target_secret.chmod(0o700)
    (target_secret / ".master_key").write_text(master_hex, encoding="ascii")
    (target_secret / ".master_key").chmod(0o600)
    for (kind, pid), provider in providers.items():
        write_private(target_secret / "providers" / kind / f"{pid}.json", provider)
    write_private(TARGET / "init-manifest.json", manifest)
    command = ["docker", "run", "--rm", "--network", "none", "--entrypoint", "python",
               "-e", "HOME=/state/home", "-e", "QWENPAW_WORKING_DIR=/state/work",
               "-e", "COPAW_WORKING_DIR=/state/work", "-e", "QWENPAW_SECRET_DIR=/state/secret",
               "-e", "COPAW_SECRET_DIR=/state/secret", "-e", "QWENPAW_DISABLE_KEYRING=1",
               "-e", "QWENPAW_KEYRING_ACCOUNT=qiandengji",
               "-v", f"{TARGET.as_posix()}:/state",
               "-v", f"{(PROJECT / 'world' / 'ops').as_posix()}:/ops:ro",
               IMAGE, "/ops/init_qwenpaw_runtime.py"]
    result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", timeout=90)
    # Raw framework exceptions can echo secret fields; return only the helper's safe report.
    report = None
    for line in result.stdout.splitlines():
        try:
            item = json.loads(line)
            if item.get("project") == "qiandengji": report = item
        except (ValueError, AttributeError):
            pass
    if result.returncode or not report or not report.get("ok"):
        raise RuntimeError("Image initialization/zero-tool validation failed; isolated staging retained for review")
    print(json.dumps(report, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-work", default=str(Path.home() / ".copaw"))
    parser.add_argument("--source-secret", default=str(Path.home() / ".copaw.secret"))
    parser.add_argument("--use-source-herald-model", action="store_true",
                        help="Explicitly keep the source herald model; default uses mc-god's cloud model")
    args = parser.parse_args()
    try:
        prepare(args)
    except Exception as exc:
        # Never expose secret-containing validation inputs or external process output.
        print(json.dumps({"project": "qiandengji", "ok": False, "errorType": type(exc).__name__,
                          "error": "Initialization failed; no QwenPaw service was started"}), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
