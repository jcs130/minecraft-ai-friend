"""Validate the proposed operations-team inventory without importing or starting it.

Only reads public plan/config/prompt/script paths. Provider files are checked for
existence only. Never loads credentials, executes scripts, contacts a model, or
changes files, world state, services or containers. Optional Docker image inspect
checks a local image ID; it does not pull or run anything.
"""
from __future__ import annotations

import argparse
import ast
import hashlib
import json
from pathlib import Path
import re
import subprocess
from typing import Any


def _load(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(value, dict):
        raise ValueError("object_required")
    return value


def _hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def check_operations_team_plan(plan_path: str | Path | None = None,
                               project_root: str | Path | None = None,
                               inspect_image: bool = False) -> dict[str, Any]:
    root = (Path(project_root) if project_root else Path(__file__).resolve().parents[1]).resolve()
    path = Path(plan_path) if plan_path else root / "config/operations-team-plan.json"
    result: dict[str, Any] = {"schema": 1, "ok": False, "readyForActivation": False,
                              "readOnly": True, "plan": str(path), "checks": [], "issues": []}

    def issue(code: str, severity: str, detail: str) -> None:
        result["issues"].append({"code": code, "severity": severity, "detail": detail})

    def check(name: str, valid: bool, detail: str = "") -> None:
        result["checks"].append({"name": name, "ok": bool(valid)})
        if not valid:
            issue(name, "error", detail or name)

    try:
        plan = _load(path)
    except (OSError, ValueError):
        issue("plan_unreadable", "error", "Public plan is missing or invalid JSON.")
        return result
    target = plan.get("target", {})
    protected = plan.get("preserve", {})
    pause = plan.get("pausePolicy", {})
    check("proposal_only", plan.get("schema") == 1 and plan.get("status") == "proposal_only"
          and plan.get("runtimeChangesPerformed") is False)
    check("separate_runtime", target.get("service") == "qwenpaw-ops"
          and target.get("composeProfile") == "operations"
          and target.get("normalServerStartIncludesOperations") is False)
    state = (root / target.get("stateRoot", "")).resolve()
    existing = (root / protected.get("currentStateRoot", "server/agents")).resolve()
    check("separate_target_state", state.is_relative_to(root / "server")
          and state != existing and not state.is_relative_to(existing)
          and not existing.is_relative_to(state), "Operations state must not overlap current chat-agent state.")
    check("local_authenticated_console", target.get("bindAddress") == "127.0.0.1"
          and target.get("hostPort") not in (18088, 18089)
          and target.get("consoleAuthRequired") is True)
    check("game_chat_unchanged", protected.get("mustRemainToolFree") is True
          and protected.get("doNotChangeWorldProviderUrl") is True
          and protected.get("noExistingCharacterUuidChanges") is True)
    check("target_schema_pinned", target.get("expectedPackageVersion") == "2.1.0"
          and target.get("image") == "qwenpaw-mc:2.1.1"
          and bool(re.fullmatch(r"sha256:[0-9a-f]{64}", target.get("imageId", ""))))

    off = ["rootAndPerAgentHeartbeatEnabled", "allJobsEnabled"]
    on = ["allImportedProfilesDisabled", "acpAllDisabled", "mcpAllDisabled",
          "builtinToolsInitiallyDisabled", "pluginsEmpty", "externalChannelsDisabled"]
    check("initial_autonomy_paused", all(pause.get(k) is False for k in off)
          and all(pause.get(k) is True for k in on))
    memory = pause.get("memoryOverrides", {})
    memory_flags = ["inbox_push_enabled", "auto_memory_inbox_push_enabled", "auto_dream_inbox_push_enabled",
                    "daily_paper_inbox_push_enabled", "dream_cron_enabled", "daily_paper_cron_enabled",
                    "memory_search_enabled", "auto_memory_search_config.enabled"]
    check("internal_memory_tasks_paused", all(memory.get(k) is False for k in memory_flags)
          and memory.get("auto_memory_interval") == 0)

    roles = plan.get("roles", [])
    ids = [r.get("id") for r in roles]
    expected = {"mc-god", "default", "mc-herald", "mc-priest", "mc-guard-kirito", "mc-guard-naruto"}
    check("six_distinct_roles", len(ids) == len(expected) and set(ids) == expected)
    for role in roles:
        ident = role.get("id", "")
        if not isinstance(ident, str) or not re.fullmatch(r"[A-Za-z0-9_.-]+", ident) or ident in (".", ".."):
            check("safe_role_id", False)
            continue
        source = role.get("source", {})
        destination = role.get("target", {})
        base_name = source.get("runtime")
        source_root = Path(plan.get("sourceRoots", {}).get(base_name, "__missing_source__")).resolve()
        workspace = Path(source.get("workspace", "__missing_workspace__")).resolve()
        config = Path(source.get("agentConfig", "__missing_agent__")).resolve()
        confined = workspace == source_root / "workspaces" / ident and config == workspace / "agent.json"
        check(f"{ident}_source_confined", confined)
        check(f"{ident}_target_confined", (root / destination.get("workspace", "")).resolve()
              == state / "work/workspaces" / ident and destination.get("enabledOnImport") is False)
        check(f"{ident}_reporting_line", role.get("reportsTo") in expected | {"creator"})
        if not confined:
            continue
        check(f"{ident}_source_config_exists", config.is_file())
        if config.is_file():
            if _hash(config) != source.get("agentConfigSha256"):
                issue(f"{ident}_source_changed", "warning", "Source profile changed since planning; re-audit selected public fields before import.")
            current = _load(config)
            check(f"{ident}_model_selection_current", current.get("active_model") == role.get("modelSelection"))
        for name in source.get("promptFiles", []):
            if name not in {"AGENTS.md", "SOUL.md", "PROFILE.md"}:
                check(f"{ident}_safe_prompt_name", False)
            elif not (workspace / name).is_file():
                issue(f"{ident}_missing_{name}", "warning", "Source prompt file is absent; preserve documented identity through reviewed adaptation, not an invented copied file.")
        if base_name == "host":
            check(f"{ident}_host_field_allowlist", ident == "mc-god"
                  and set(role.get("importFields", [])) <= {"id", "name", "description", "active_model", "language"})
            issue("host_2_2_selective_import", "warning", "Host mc-god is 2.2.0; construct a fresh 2.1.0 profile and copy only the selected public identity/model fields.")

    for dependency in plan.get("dependencies", []):
        dep = Path(dependency["path"])
        dep = dep if dep.is_absolute() else root / dep
        exists = dep.is_dir() if dependency.get("kind") == "directory" else dep.is_file()
        if dependency.get("requiredNow"):
            check("dependency_" + dependency["id"], exists, f"Required source dependency missing: {dependency['id']}")
        elif not exists:
            issue("pending_" + dependency["id"], "warning", "Planned integration file has not been implemented; its feature must remain disabled.")
        if exists and dependency.get("kind") == "script" and dep.suffix == ".py":
            try:
                ast.parse(dep.read_text(encoding="utf-8-sig"), filename=dep.name)
                check("syntax_" + dependency["id"], True)
            except (OSError, SyntaxError, UnicodeError):
                check("syntax_" + dependency["id"], False)

    private = plan.get("privateProviderMigration", {})
    check("independent_private_store", private.get("required") is True
          and (root / private.get("targetSecretRoot", "")).resolve() == state / "secret")
    for provider in private.get("sourceSelections", []):
        ident = provider.get("providerId", "")
        if not re.fullmatch(r"[A-Za-z0-9_.-]+", ident):
            check("safe_provider_id", False)
            continue
        secret_root = Path(provider["sourceSecretRoot"])
        # Exists only. Absolutely no provider/key/auth contents are read here.
        found = [secret_root / "providers" / kind / f"{ident}.json" for kind in ("builtin", "custom")]
        check("provider_definition_exists_" + ident, sum(p.is_file() for p in found) == 1)

    if inspect_image:
        try:
            observed = subprocess.run(["docker", "image", "inspect", target["image"], "--format", "{{.Id}}"],
                                      capture_output=True, text=True, timeout=8, check=False)
            check("local_image_matches_pin", observed.returncode == 0 and observed.stdout.strip() == target["imageId"])
        except (OSError, subprocess.TimeoutExpired):
            check("local_image_matches_pin", False)
    else:
        issue("image_not_rechecked", "info", "Use --inspect-image for read-only local Docker image identity verification; no container is started.")

    issue("activation_not_performed", "blocked", "This is a migration plan, not an imported runtime. Schema roundtrip, private re-encryption, tool scope, actor identity, D receipts and scheduler ownership still require the explicit activation gates.")
    issue("legacy_admin_mcp_quarantined", "blocked", "Legacy god_exec/god_send permit administrator commands; do not activate merely by changing file paths.")
    issue("character_identity_mapping_pending", "blocked", "Original Kirito/Naruto names have multiple persistent records; choose and validate existing UUID bindings separately without summons or renames.")
    result["ok"] = not any(x["severity"] == "error" for x in result["issues"])
    result["summary"] = {"passedChecks": sum(x["ok"] for x in result["checks"]),
                         "failedChecks": sum(not x["ok"] for x in result["checks"]),
                         "warnings": sum(x["severity"] == "warning" for x in result["issues"])}
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", type=Path)
    parser.add_argument("--root", type=Path)
    parser.add_argument("--inspect-image", action="store_true")
    args = parser.parse_args()
    report = check_operations_team_plan(args.plan, args.root, args.inspect_image)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    raise SystemExit(0 if report["ok"] else 1)
