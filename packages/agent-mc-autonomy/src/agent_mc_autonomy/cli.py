"""Foreground standalone framework: passive checks, native queue and optional brain."""

from __future__ import annotations

import argparse
import asyncio
import json
import signal
import threading
import tomllib
from pathlib import Path

from .configuration import Settings
from .mailbox import Mailbox, observation
from .planner import HttpPlanner, HttpPlannerConfig
from .review import ReviewPolicy, ReviewPort
from .runner import run_session, validate_start


async def play(settings, entry, data, brain_config, goal, viewer_entry=None):
    stopped = threading.Event()
    task = asyncio.current_task()
    loop = asyncio.get_running_loop()

    def stop(*_):
        if not stopped.is_set():
            stopped.set()
            loop.call_soon_threadsafe(task.cancel)

    previous = {sig: signal.signal(sig, stop) for sig in (signal.SIGINT, signal.SIGTERM)}
    try:
        brain = HttpPlanner(brain_config, settings.max_output_tokens, settings.model_timeout_seconds) if brain_config else None
        try:
            await run_session(settings, entry, data, brain, goal, lambda **_: None, stopped.is_set, viewer_entry=viewer_entry)
        except asyncio.CancelledError:
            if not stopped.is_set():
                raise
    finally:
        for sig, handler in previous.items():
            signal.signal(sig, handler)


def main(argv=None, *, entry_resolver=None, viewer_entry=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["check", "status", "run", "submit-goal", "feedback", "submit", "receipt", "stop",
                                            "model-config", "model-list", "model-check", "auth-login", "auth-forget"])
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--entry", type=Path, help="Explicit built agent-mc-world MCP entry; no host checkout is required")
    parser.add_argument("--viewer-entry", type=Path, help="Optional separately installed viewer adapter entry")
    parser.add_argument("--data", type=Path, help="Same data root as the observer; overrides runtime.data_directory")
    parser.add_argument("--queue-only", action="store_true", help="Execute native tasks without invoking a model")
    parser.add_argument("--goal", default="survive")
    parser.add_argument("--request-id", default="", help="UUID; retries must use the same value")
    parser.add_argument("--steps-file", type=Path, help="JSON array of native mc_do steps")
    parser.add_argument("--queue", choices=["append", "afterCheckpoint", "now"], default="append")
    parser.add_argument("--mode", choices=["insert", "replace"], help="Required for feedback: insert then resume, or explicitly cancel old work")
    args = parser.parse_args(argv)
    try:
        raw = tomllib.loads(args.config.read_text(encoding="utf-8-sig"))
        if args.command in {"model-config", "model-list", "model-check", "auth-login", "auth-forget"}:
            config = HttpPlannerConfig.parse({k: v for k, v in raw.get("planner", {}).items() if k != "route"},
                                             require_model=args.command in {"model-config", "model-check"})
            budget = Settings.parse(raw).max_output_tokens
            if args.command in {"model-config", "model-check"}:
                config.validate_budget(budget)
            if args.command == "model-config":
                result = {"configuration_valid": True, "provider": config.provider, "protocol": config.protocol,
                          "auth_mode": config.auth.mode, "network_called": False}
            elif args.command == "auth-login":
                from .model_auth import login
                result = login(config)
            elif args.command == "auth-forget":
                from .model_auth import CredentialStore
                from .ownership import session_lease
                store = CredentialStore(config)
                with session_lease(store.lock_path):
                    store.delete()
                result = {"local_credentials_removed": True, "remote_revocation_verified": False}
            else:
                from .model_admin import check_model, list_models
                result = asyncio.run(list_models(config) if args.command == "model-list" else check_model(config, max_output_tokens=budget))
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return 0
        settings = Settings.parse(raw)
        data = args.data.resolve() if args.data else settings.data_root(Path("runtime").resolve())
        directory = data / "sessions" / settings.identity / "host"
        mailbox = Mailbox(directory)
        if args.command == "status":
            result = observation(directory)
        elif args.command == "receipt":
            result = {"command": mailbox.get(args.request_id)}
        elif args.command in {"submit-goal", "feedback", "submit", "stop"}:
            if args.command == "stop":
                settings.require_server()
            else:
                validate_start(settings, args.goal)
            if args.command == "submit" and args.steps_file is None:
                raise ValueError("steps_file_required")
            if args.command == "feedback":
                result = mailbox.submit("feedback", {"goal": args.goal, "mode": args.mode}, args.request_id)
            elif args.command == "submit-goal":
                result = mailbox.submit("goal", {"goal": args.goal}, args.request_id)
            else:
                payload = {"steps": json.loads(args.steps_file.read_text(encoding="utf-8-sig")), "queue": args.queue} if args.command == "submit" else {}
                result = mailbox.submit("steps" if args.command == "submit" else "stop", payload, args.request_id)
        else:
            settings.require_server()
            entry = entry_resolver(settings.runtime_directory(Path("local").resolve())) if entry_resolver else args.entry
            if entry is None or not entry.is_file():
                raise ValueError("explicit_core_entry_required")
            config = None if args.queue_only else HttpPlannerConfig.parse({k: v for k, v in raw.get("planner", {}).items() if k != "route"})
            if config:
                config.key()  # Validation only. Never print the key or call a provider.
                config.validate_budget(settings.max_output_tokens)
            if args.command == "check":
                result = {"configuration_valid": True, "enabled": settings.enabled, "minecraft_version": settings.version,
                          "mode": "queue_only" if config is None else "autonomous", "network_called": False}
            else:
                validate_start(settings, args.goal)
                if "review" in raw:
                    ReviewPort(directory).configure(ReviewPolicy.parse(raw["review"]))
                asyncio.run(play(settings, entry, data, config, args.goal, viewer_entry=args.viewer_entry or viewer_entry))
                result = observation(directory)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (OSError, ValueError, RuntimeError) as error:
        # Raw provider bodies and credentials never enter frontend output.
        print(json.dumps({"error": type(error).__name__, "message": str(error).split(":", 1)[0]}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
