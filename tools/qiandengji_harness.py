"""Explicit operator launcher for a separate Qiandengji character; never manages Paper."""
from __future__ import annotations

import argparse
import json
import os
import re
import tempfile
import tomllib
from pathlib import Path


HARNESS_IDS = (
    "dsh", "pi", "qwen", "claude-code", "codex", "hermes", "opencode", "omp", "cline",
    "goose", "kilo", "kimi", "minimax", "grok", "aider", "openhands", "cheetahclaws",
    "agentzero", "mimo", "jcode", "opensquilla", "nanobot", "zeroclaw",
)


def model_alias(harness: str) -> str:
    return "qwen3.7-plus-messages" if harness == "claude-code" else "qwen3.7-plus-responses" if harness == "codex" else "qwen3.7-plus"


def select_harness(config: Path, harness: str, model: str | None = None) -> dict:
    """Replace only the final planner table; retain body, persona, journals and unknowns."""
    from agent_mc_autonomy.configuration import Settings
    from agent_mc_autonomy.harness_router import HarnessRouterConfig
    if harness not in HARNESS_IDS:
        raise ValueError("runtime_not_verified_in_this_deployment")
    source = config.read_text(encoding="utf-8-sig")
    before = tomllib.loads(source)
    settings = Settings.parse(before)
    planner = dict(before.get("planner", {}))
    if planner.pop("route", None) != "harnessrouter":
        raise ValueError("explicit_harnessrouter_profile_required")
    original = HarnessRouterConfig.parse(planner)
    planner.update(harness_id=harness, model=model if model is not None else model_alias(harness))
    selected = HarnessRouterConfig.parse(planner)
    table = re.search(r"(?m)^\[planner\][ \t]*\r?\n", source)
    if not table or re.search(r"(?m)^\[", source[table.end():]):
        raise ValueError("planner_must_be_the_last_table")
    values = {"route": "harnessrouter", **planner}
    updated = source[:table.start()] + "[planner]\n" + "".join(
        key + " = " + json.dumps(value, ensure_ascii=False, allow_nan=False) + "\n" for key, value in values.items())
    after = tomllib.loads(updated)
    if {k: v for k, v in before.items() if k != "planner"} != {k: v for k, v in after.items() if k != "planner"}:
        raise ValueError("non_planner_configuration_changed")
    if Settings.parse(after).identity != settings.identity:
        raise ValueError("account_binding_changed")
    if config.read_text(encoding="utf-8-sig") != source:
        raise ValueError("configuration_changed_during_selection")
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", newline="\n", dir=config.parent,
                                         prefix=".planner-", suffix=".tmp", delete=False) as output:
            temporary = Path(output.name)
            output.write(updated)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, config)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()
    return {"selected": harness, "model": selected.model, "previous": original.harness_id,
            "account_binding_preserved": True, "model_called": False, "game_connected": False}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["list", "select", "check", "harness-check", "run", "status", "stop", "receipt", "submit-goal", "agent-export"])
    parser.add_argument("--config", type=Path)
    parser.add_argument("--harness", choices=HARNESS_IDS)
    parser.add_argument("--model", help="Explicit integration model alias; selection otherwise uses this deployment's verified Qwen aliases")
    parser.add_argument("--key-file", type=Path, help="Private HarnessRouter JSON containing its key; never a model provider key")
    parser.add_argument("--entry", type=Path)
    parser.add_argument("--goal")
    parser.add_argument("--request-id")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(argv)
    if args.command == "list":
        print(json.dumps({"harnesses": [{"id": name, "model": model_alias(name)} for name in HARNESS_IDS],
                          "model_called": False, "game_connected": False}, ensure_ascii=False))
        return 0
    if args.config is None:
        parser.error("--config is required")
    if args.command == "select":
        if not args.harness:
            parser.error("select requires --harness")
        print(json.dumps(select_harness(args.config, args.harness, args.model), ensure_ascii=False))
        return 0
    from agent_mc_autonomy.cli import main as framework_main
    from agent_mc_autonomy.harness_router import HarnessRouterConfig
    raw = tomllib.loads(args.config.read_text(encoding="utf-8-sig"))
    if args.command in {"run", "harness-check"} and args.key_file is None:
        parser.error("an explicit --key-file is required for the hosted planning endpoint")
    forwarded = [args.command, "--config", str(args.config)]
    for key in ("entry", "goal", "request_id", "output"):
        value = getattr(args, key)
        if value is not None:
            forwarded.extend(["--" + key.replace("_", "-"), str(value)])
    variable = None
    previous = None
    try:
        if args.key_file is not None:
            planner = HarnessRouterConfig.parse({k: v for k, v in raw.get("planner", {}).items() if k != "route"})
            secret = json.loads(args.key_file.read_text(encoding="utf-8-sig")).get("key")
            if not isinstance(secret, str) or not 20 <= len(secret) <= 4096 or any(ord(c) < 33 for c in secret):
                raise ValueError("invalid_private_gateway_key")
            variable = planner.api_key_env
            previous = os.environ.get(variable)
            os.environ[variable] = secret
        return framework_main(forwarded)
    finally:
        if variable is not None:
            if previous is None:
                os.environ.pop(variable, None)
            else:
                os.environ[variable] = previous


if __name__ == "__main__":
    raise SystemExit(main())
