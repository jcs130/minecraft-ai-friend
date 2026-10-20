"""Pinned Harness2 adapter. NDJSON callbacks only; no game connection or model provider.

Upstream code is installed separately under its Apache-2.0 license. This adapter does
not copy its implementation. stdout is exclusively the RPC protocol; generated game
methods and bounded structured game lessons are the only model-authored artifacts.
"""
from __future__ import annotations

import contextlib
import importlib.metadata
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import threading
from concurrent.futures import Future
from urllib.parse import unquote, urlparse

REVISION = "1cfe254e8d25b15f37048c3730134686abe60335"
CODE = "skills/minecraft-method/scripts/run.js"
PARAMS = "skills/minecraft-method/scripts/params.json"
SKILL = "skills/minecraft-method/SKILL.md"
EDITABLE = frozenset((CODE, PARAMS, SKILL))
FRONT = "---\nname: minecraft-method\ndescription: Bounded Minecraft method for the supplied isolated fixture\n---\n"
OUT = sys.stdout


def verify_install() -> None:
    if sys.version_info < (3, 12) or os.name == "nt":
        raise RuntimeError("Harness2 requires Linux Python 3.12+ (WSL is supported)")
    dist = importlib.metadata.distribution("harness2")
    origin = json.loads(dist.read_text("direct_url.json") or "{}")
    commit = origin.get("vcs_info", {}).get("commit_id")
    if origin.get("dir_info", {}).get("editable"):
        source = Path(unquote(urlparse(origin["url"]).path))
        commit = subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip()
        subprocess.run(["git", "-C", str(source), "diff", "--ignore-cr-at-eol", "--quiet", "HEAD", "--", "harness2"], check=True)
    if commit != REVISION or dist.version != "0.1.0":
        raise RuntimeError("Install the exact Harness2 revision declared in requirements.txt")


class Rpc:
    def __init__(self):
        self.lock = threading.Lock()
        self.pending: dict[int, Future] = {}
        self.serial = 0
        self.stopped = False
        threading.Thread(target=self.read, daemon=True).start()

    def read(self):
        try:
            for line in sys.stdin:
                reply = json.loads(line)
                with self.lock:
                    future = self.pending.pop(reply["id"], None)
                if future is None:
                    raise ValueError("Unknown RPC response")
                future.set_result(reply["value"])
        finally:
            with self.lock:
                self.stopped = True
                for future in self.pending.values():
                    future.set_exception(RuntimeError("Host disconnected; never retry original effects"))
                self.pending.clear()

    def call(self, op, **values):
        with self.lock:
            if self.stopped:
                raise RuntimeError("Host disconnected")
            self.serial += 1
            serial = self.serial
            future = Future()
            self.pending[serial] = future
            OUT.write(json.dumps({"type": "rpc", "id": serial, "op": op, **values}, ensure_ascii=False) + "\n")
            OUT.flush()
        return future.result()


def bounded_text(value, limit=1600):
    if not isinstance(value, str) or len(value) > limit:
        raise ValueError("Invalid bounded game lesson")
    return re.sub(r"[\r\n<>]", " ", value).strip()


def main():
    os.umask(0o077)
    initial = json.loads(sys.stdin.readline())
    if initial.get("revision") != REVISION:
        raise ValueError("Bridge revision mismatch")
    verify_install()
    from harness2.core import tree
    from harness2.core.library import Library
    from harness2.core.proposer import Proposer, Reply
    from harness2.core.schedule import run_task
    from harness2.core.spec import BenchSpec, BenchPrompts, ChannelSpec
    from harness2.substrate.opencode import OpencodeSubstrate

    job = initial["job"]
    root = Path(initial["workspace"]).expanduser().resolve() / initial["jobHash"]
    root.mkdir(parents=True, exist_ok=True)
    rpc = Rpc()
    substrate = OpencodeSubstrate()
    surface = substrate.surface()
    channel = ChannelSpec("opencode", "host/injected")  # No provider CLI is ever invoked.
    base = {rel: "" for rel in surface.always_on}
    base["systemprompt.md"] = "For the supplied Minecraft fixture, use the minecraft-method skill.\n"
    base["guardrails.md"] = "Only the host may execute methods in the isolated practice binding. No production adoption.\n"
    base["LongTermMEMORY.md"] = json.dumps(job.get("lessons", []), ensure_ascii=False)
    base["tool_descriptions/tool_guidance.md"] = (
        "run.js is a JavaScript function body in the existing Minecraft MethodRunner sandbox. "
        "Use the supplied mc/bot API only. Await every bot call; release held controls in finally. "
        "The executor passes params.json as params. No imports, files, network, process or provider access."
    )
    base.update({CODE: job["baseline"]["code"], PARAMS: json.dumps(job["baseline"]["params"], ensure_ascii=False),
                 SKILL: FRONT + job["baseline"]["guidance"]})

    def candidate(harness):
        params = json.loads(harness[PARAMS])
        if not isinstance(params, dict) or len(json.dumps(params)) > 4096:
            raise ValueError("params.json must contain one bounded object")
        if not harness[SKILL].startswith(FRONT) or len(harness[SKILL]) - len(FRONT) > 4000:
            raise ValueError("Preserve method skill frontmatter and bounded guidance")
        if not harness[CODE].strip() or len(harness[CODE]) > 12000:
            raise ValueError("run.js must be a bounded MethodRunner function body")
        return {"code": harness[CODE], "params": params, "guidance": harness[SKILL][len(FRONT):]}

    class Adapter:
        def __init__(self):
            self.substrate = substrate
            self.spec = BenchSpec(name="minecraft", runs_root=root / "runs", install_mode="workspace_config",
                prompts=BenchPrompts(work="complete the supplied Minecraft task using bounded methods in an isolated practice world",
                    yardstick="Use observed positions, inventory changes and health; missing observations remain unknown.",
                    selection_checks="Compare actual method results. A completed program alone does not establish its objective."),
                channels={"proposer": channel, "selector": channel}, allow_subagents=False)
            tree.write_tree(surface, base, self.base_harness(), stubs=False)

        def tasks(self, split="all"): return [job["id"]]
        def domain_of(self, task_id): return "minecraft-methods"
        def task_prompt(self, task_id): return job["task"]
        def task_files(self, task_id): return None
        def base_harness(self): return root / "base"

        def validate_tree(self, harness):
            if set(harness) != set(base):
                raise ValueError("Only the declared three method files may be edited")
            if any(harness[rel] != value for rel, value in base.items() if rel not in EDITABLE):
                raise ValueError("Host, safety, tool declarations and memory are immutable")
            candidate(harness)

        def execute(self, task_id, harness_dir, run_id, *, timeout=None):
            harness = tree.read_tree(surface, harness_dir or self.base_harness())
            self.validate_tree(harness)
            value = rpc.call("trial", runId=run_id, candidate=candidate(harness))
            directory = root / "executions" / run_id
            directory.mkdir(parents=True, exist_ok=True)
            # Structured observed metadata, not the method's narrative or host conversation.
            (directory / "evidence.json").write_text(json.dumps(value), encoding="utf-8")
            return directory

        def delivered(self, run_dir): return (run_dir / "evidence.json").is_file()
        def trajectory(self, run_dir, *, obs_trunc): return (run_dir / "evidence.json").read_text(encoding="utf-8")
        def deliverable_text(self, run_dir): return self.trajectory(run_dir, obs_trunc=50000)
        def deliverable_files(self, run_dir): return {"evidence.json": self.deliverable_text(run_dir)}

    adapter = Adapter()

    class HostProposer(Proposer):
        def call(self, mission, context_dir, label, **kwargs):
            context = Path(context_dir)
            files = {}
            size = len(mission.encode("utf-8"))
            for path in sorted(context.rglob("*")):
                if path.is_symlink(): raise ValueError("Symlinks are outside the practice context")
                if not path.is_file(): continue
                size += path.stat().st_size
                if size > job["budget"]["contextBytes"]:
                    raise ValueError("Evidence exceeds context budget; no silent truncation")
                files[path.relative_to(context).as_posix()] = path.read_text(encoding="utf-8")
            reply = rpc.call("model", label=label, mission=mission, files=files)
            workspace = None
            if label.startswith("select."):
                choice = reply.get("choice", "")
                if not re.fullmatch(r"[A-Z]+", choice): raise ValueError("Selector must choose an existing anonymous ID")
                text = f"<why>Host-selected from measured practice evidence.</why>\n```choice\n{choice}\n```"
            elif label.startswith("experience."):
                lesson = reply.get("experience")
                if lesson and all(lesson.get(k) for k in ("cue", "lesson", "evidence")):
                    fields = {k: bounded_text(lesson.get(k, "")) for k in ("cue", "lesson", "evidence", "confidence")}
                    text = "<experience>\n" + "\n".join(f"{k}: {v}" for k, v in fields.items()) + "\n</experience>"
                else:
                    text = "NO_ENTRY"
            else:
                workspace = context / "harness"
                changed = reply.get("files", {})
                if (not isinstance(changed, dict) or set(changed) - EDITABLE
                        or any(not isinstance(v, str) for v in changed.values())):
                    # No off-surface path is written. Let the upstream's bounded stage
                    # retry/fallback handle a rejected proposal; never retry physical work.
                    workspace = None
                    text = "<notes>Rejected a patch outside the three declared UTF-8 method files.</notes>"
                else:
                    harness = tree.read_tree(surface, workspace)
                    harness.update(changed)
                    tree.write_tree(surface, harness, workspace, stubs=False)
                    # Upstream _accept_tree calls our strict validator BEFORE any probe.
                    # Invalid params/source/frontmatter become its ordinary bounded retry.
                    text = "<notes>Proposed bounded game-method patch; validate before probing.</notes>"
            value = Reply(label=label, text=text, ok=True, attempts=1, workspace=workspace)
            self._calls.append(value)
            return value

    prop = HostProposer(channel)
    mode = "agg" if job["mode"] == "parallel" else "seq"
    # Derivative optimizer scratch only. Canonical methods/reviews live in the host-supplied MethodLibrary.
    library = Library(root / "library", "minecraft-methods", surface)
    with contextlib.redirect_stdout(sys.stderr):
        result = run_task(job["id"], job["k"], adapter=adapter, prop=prop, runs_root=root / "runs",
                          modes=[mode], libraries={mode: library})
    selection = result.selections.get(mode) or {}
    if not selection.get("ok") or selection.get("fallback"):
        raise ValueError("No reliable selected candidate; retain the original method")
    harness_path = selection.get("chosen_harness_dir")
    # Upstream persists the exact selected directory as harness_dir (0.1.0).
    harness_path = harness_path or selection.get("harness_dir")
    if not harness_path:
        from harness2.core.schedule import Namespace
        harness_path = Namespace(adapter.spec.name, substrate.name, mode, job["k"]).task_dir(root / "runs", job["id"]) / "harnesses" / selection["chosen_label"]
    selected = tree.read_tree(surface, Path(harness_path))
    adapter.validate_tree(selected)
    output = {"upstreamRevision": REVISION, "selectedRunId": selection["chosen_run_id"],
              "candidate": candidate(selected), "experience": selection.get("experience") or None}
    OUT.write(json.dumps({"type": "done", "result": output}, ensure_ascii=False) + "\n")
    OUT.flush()


if __name__ == "__main__":
    if "--check" in sys.argv:
        verify_install()
        print(json.dumps({"ready": True, "upstreamRevision": REVISION}))
    else:
        try:
            main()
        except Exception as exc:
            # Raw provider/user text never becomes a diagnostic artifact.
            import traceback
            frames = traceback.extract_tb(exc.__traceback__)
            print("Harness2 bridge failed: " + type(exc).__name__ + " at " + ",".join(f"{Path(f.filename).name}:{f.lineno}" for f in frames[-3:]), file=sys.stderr)
            sys.exit(1)
