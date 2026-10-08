"""Checked, reversible overlays for two pinned upstream repositories.

Preview by default. Only explicit --apply writes files. No dependency installation,
process restart, model call or Minecraft action is performed by this installer.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "world/src/neko-adapter"
NEKO_REV = "23f5971203e3f4d15ef416ff8e5cc67965845d82"
PROJECT_REV = "fb2a2e731a8c954478d08678b0c8cf40e8145a54"


def replace_once(text: str, old: str, new: str) -> str:
    if text.count(old) != 1:
        raise ValueError(f"upstream anchor count is {text.count(old)}: {old[:90]!r}")
    return text.replace(old, new, 1)


def original(repo: Path, revision: str, name: str) -> str:
    head = subprocess.check_output(["git", "-C", str(repo), "rev-parse", "HEAD"], text=True).strip()
    if head != revision:
        raise ValueError(f"upstream revision changed: {repo}: {head}")
    return subprocess.check_output(["git", "-C", str(repo), "show", f"{revision}:{name}"]).decode("utf-8").replace("\r\n", "\n")


def plan_neko(repo: Path) -> dict[str, tuple[str | None, str]]:
    planned: dict[str, tuple[str | None, str]] = {}

    def patch(name: str, replacements: list[tuple[str, str]]) -> None:
        before = original(repo, NEKO_REV, name)
        after = before
        for old, new in replacements:
            after = replace_once(after, old, new)
        planned[name] = (before, after)

    patch("src/utils/mcdata.js", [
        ("import minecraftData from 'minecraft-data';", "import { attachNative } from '../integrations/maw_native.js';\nimport minecraftData from 'minecraft-data';"),
        ("const bot = createBot(options);", "const bot = createBot(options);\n    attachNative(bot, username); // Same player's connection, before login/spawn."),
    ])
    patch("src/agent/commands/queries.js", [
        ("import * as world from '../library/world.js';", "import { nativeQueries } from '../../integrations/maw_native.js';\nimport * as world from '../library/world.js';"),
        ("export const queryList = [", "export const queryList = [\n    ...nativeQueries,"),
    ])
    patch("src/agent/commands/actions.js", [
        ("import * as skills from '../library/skills.js';", "import { nativeActions } from '../../integrations/maw_native.js';\nimport * as skills from '../library/skills.js';"),
        ("export const actionsList = [", "export const actionsList = [\n    ...nativeActions,"),
    ])
    name = "src/agent/commands/index.js"
    before = original(repo, NEKO_REV, name)
    after = before
    # Preserve the existing command grammar, adding escaped JSON string support.
    old_string = r'"[^"]*"'
    new_string = r'"(?:[^"\\]|\\.)*"'
    for line in [line for line in before.splitlines() if line.startswith(("const commandRegex =", "const argRegex ="))]:
        after = replace_once(after, line, line.replace(old_string, new_string))
    after = replace_once(after, "arg = arg.substring(1, arg.length-1);", "try { arg = arg.startsWith('\"') ? JSON.parse(arg) : arg.substring(1, arg.length-1); }\n            catch { return `Error: Param '${paramNames[i]}' contains an invalid JSON string.`; }")
    after = replace_once(after, "console.log('parsed command:', parsed);", "console.log('parsed command:', parsed.commandName.startsWith('!mod') ? {commandName: parsed.commandName, argsBytes: Buffer.byteLength(JSON.stringify(parsed.args || []), 'utf8')} : parsed);")
    planned[name] = (before, after)
    patch("src/agent/action_manager.js", [
        ("export class ActionManager {", "import { assertNativeBodyAvailable } from '../integrations/maw_native.js';\n\nexport class ActionManager {"),
        ("async runAction(actionLabel, actionFn, { timeout, resume = false } = {}) {", "async runAction(actionLabel, actionFn, { timeout, resume = false } = {}) {\n        assertNativeBodyAvailable(this.agent);"),
    ])
    patch("src/agent/modes.js", [
        ("async function execute(mode, agent, func, timeout=-1) {", "async function execute(mode, agent, func, timeout=-1) {\n    if (agent?.bot?.mawNative?.bodyBlocked()) return; // Native item transaction or unresolved write owns the hand."),
    ])
    patch("src/websocket/ws_server.js", [
        ("import { WebSocketServer } from 'ws';", "import { handleNativeMessage } from '../integrations/maw_native.js';\nimport { WebSocketServer } from 'ws';"),
        ("this.wss = new WebSocketServer({ port: this.port, host: '0.0.0.0' });", "this.wss = new WebSocketServer({ port: this.port, host: process.env.NEKO_PLUGIN_WS_HOST || '127.0.0.1', maxPayload: 70000 });"),
        ("ws://0.0.0.0:${this.port}", "ws://${process.env.NEKO_PLUGIN_WS_HOST || '127.0.0.1'}:${this.port}"),
        ("this.handleMessage(JSON.parse(data.toString()));", "this.handleMessage(JSON.parse(data.toString()), ws);"),
        ("handleMessage(data) {", "handleMessage(data, socket) {\n        if (data?.type === 'native_mod') {\n            void handleNativeMessage(this.agent, socket, data).catch(() => {});\n            return;\n        }\n        if (['task', 'run_skill'].includes(data?.type) && this.agent?.bot?.mawNative?.bodyBlocked()) {\n            if (socket?.readyState === 1) socket.send(JSON.stringify({type: 'error', code: 'native_body_reserved_or_unknown', retryAutomatically: false}));\n            return;\n        }"),
    ])
    before = original(repo, NEKO_REV, "package.json")
    package = json.loads(before)
    for name, version in {"mineflayer": "4.37.1", "minecraft-data": "3.112.0", "minecraft-protocol": "1.66.2",
                          "prismarine-chunk": "1.41.0", "vec3": "0.2.0"}.items():
        package["dependencies"][name] = version
    package["overrides"].update({"minecraft-data": "3.112.0", "minecraft-protocol": "1.66.2",
                                 "prismarine-chunk": "1.41.0", "vec3": "0.2.0"})
    planned["package.json"] = (before, json.dumps(package, ensure_ascii=False, indent=4) + "\n")
    planned["src/integrations/maw_native.js"] = (None, (SOURCE / "neko-native.js").read_text(encoding="utf-8"))
    planned["package-lock.json"] = (None, (SOURCE / "mc-agent-neko.package-lock.json").read_text(encoding="utf-8"))
    return planned


PLUGIN = "plugin/plugins/game_agent_minecraft/"


def plan_project(repo: Path) -> dict[str, tuple[str | None, str]]:
    planned: dict[str, tuple[str | None, str]] = {}

    def patch(name: str, replacements: list[tuple[str, str]]) -> None:
        name = PLUGIN + name
        before = original(repo, PROJECT_REV, name)
        after = before
        for old, new in replacements:
            after = replace_once(after, old, new)
        planned[name] = (before, after)

    patch("client.py", [
        ("import websockets\n", "from .native_mod import NativeModRequests\n\nimport websockets\n"),
        ("self._background_callbacks: set[asyncio.Task[None]] = set()", "self._background_callbacks: set[asyncio.Task[None]] = set()\n        self.native_mod = NativeModRequests()"),
        ("self.is_connected = True\n", "self.is_connected = True\n                self.native_mod.connected(self._ws)\n"),
        ("await self._listen()", "try:\n                    await self._listen()\n                finally:\n                    self.native_mod.disconnected(self._ws)"),
        ("self._running = False\n        self.is_connected = False\n        ws = self._ws", "self._running = False\n        self.is_connected = False\n        self.native_mod.disconnected(self._ws)\n        ws = self._ws"),
        ("msg_type = data.get(\"type\", \"\")", "if self.native_mod.receive(ws, data):\n                    continue\n                msg_type = data.get(\"type\", \"\")"),
    ])
    patch("__init__.py", [
        ("from . import prompts", "from .native_mod import NATIVE_MOD_DESCRIPTION, NATIVE_MOD_SCHEMA\nfrom . import prompts"),
        ("    @ui.action(id=\"game_agent_status\", label=\"刷新状态\")", '''    @llm_tool(name="minecraft_mod", description=NATIVE_MOD_DESCRIPTION,
              parameters=NATIVE_MOD_SCHEMA, timeout=15.0)
    async def minecraft_mod(self, operation: str, id: str | None = None,
                            args: dict | None = None, callId: str | None = None, **_):
        """Private structured native operations, on the same account as minecraft_task."""
        if not await self._ensure_service_started():
            return Ok({"ok": False, "code": "native_transport_not_connected", "retryAutomatically": False})
        client = self._service._client
        result = await client.native_mod.request(client._ws, operation=operation, id=id, args=args, callId=callId)
        return Ok(result)

    @ui.action(id="game_agent_status", label="刷新状态")'''),
    ])
    planned[PLUGIN + "native_mod.py"] = (None, (SOURCE / "project-neko/native_mod.py").read_text(encoding="utf-8"))
    planned[PLUGIN + "MY_AGENT_WORLD.md"] = (None, (SOURCE / "project-neko/MY_AGENT_WORLD.md").read_text(encoding="utf-8"))
    return planned


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--neko", type=Path, required=True)
    parser.add_argument("--project-neko", type=Path, required=True)
    parser.add_argument("--backup-root", type=Path)
    parser.add_argument("--record", type=Path, help="Write the verified installation hash manifest outside source repositories")
    parser.add_argument("--apply", action="store_true")
    options = parser.parse_args()
    targets = [(options.neko.resolve(), plan_neko(options.neko)), (options.project_neko.resolve(), plan_project(options.project_neko))]
    changes = []
    for repo, files in targets:
        for name, (before, after) in files.items():
            target = repo / name
            current = target.read_text(encoding="utf-8") if target.exists() else None
            # npm normalizes package.json indentation; that is not a local semantic edit.
            package_equivalent = name == "package.json" and current is not None and json.loads(current) == json.loads(after)
            if current == after or package_equivalent:
                continue
            if current != before:
                raise ValueError(f"local change conflict, preserved: {target}")
            changes.append((repo, name, target, current, after))
    print(json.dumps({"mode": "apply" if options.apply else "preview", "changes": [str(c[2]) for c in changes]}, ensure_ascii=False))
    if options.record and not options.apply:
        raise ValueError("--record requires --apply; preview never writes")
    if not options.apply:
        return
    if changes and (options.backup_root is None or not options.backup_root.is_absolute()):
        raise ValueError("--backup-root must be an absolute path outside both upstream repositories")
    if options.record and (not options.record.is_absolute() or any(repo == options.record.resolve() or repo in options.record.resolve().parents for repo, _ in targets)):
        raise ValueError("--record must be absolute and outside upstream repositories")
    if options.record and options.record.exists():
        old_record = json.loads(options.record.read_text(encoding="utf-8"))
        if old_record.get("schemaVersion") != 1 or old_record.get("tool") != "minecraft_mod":
            raise ValueError("preserving an unrecognized installation record")
    backup = None
    if changes:
        backup = options.backup_root.resolve()
        if any(backup == repo or repo in backup.parents for repo, _ in targets):
            raise ValueError("backup must be outside upstream repositories")
        backup.mkdir(parents=True, exist_ok=False)
        receipt = {"schemaVersion": 1, "at": datetime.now(timezone.utc).isoformat(), "nekoRevision": NEKO_REV,
                   "projectRevision": PROJECT_REV, "files": []}
        for repo, name, target, current, after in changes:
            copy = backup / repo.name / name
            if current is not None:
                copy.parent.mkdir(parents=True, exist_ok=True)
                copy.write_bytes(target.read_bytes())
            receipt["files"].append({"path": str(target), "created": current is None,
                                     "sha256": hashlib.sha256(after.encode("utf-8")).hexdigest()})
        (backup / "overlay.json").write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding="utf-8")
        for _, _, target, _, after in changes:
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open("w", encoding="utf-8", newline="\n") as stream:
                stream.write(after)
    if options.record:
        installed = [repo / name for repo, planned in targets for name in planned]
        owned = [SOURCE / name for name in ("native-runtime.cjs", "neko-native.js", "project-neko/native_mod.py", "mc-agent-neko.package-lock.json")]
        owned += [Path(__file__).resolve(), ROOT / "world/src/neoforge-handshake/mod-agent-client.cjs",
                  ROOT / "world/src/neoforge-handshake/mod-call-client.cjs", ROOT / "world/src/society-agent/action-deadline.cjs"]
        record = {"schemaVersion": 1, "at": datetime.now(timezone.utc).isoformat(),
                  "mcAgentNekoRevision": NEKO_REV, "projectNekoRevision": PROJECT_REV,
                  "tool": "minecraft_mod", "operationCount": 48, "samePlayerConnection": True,
                  "automaticReplay": False, "pluginMessageBroadcast": False,
                  "runtimeObservation": "not_checked", "allModsVerified": False, "publicAccessReady": False,
                  "files": [{"path": str(p), "sha256": hashlib.sha256(p.read_bytes()).hexdigest()} for p in installed + owned]}
        options.record.parent.mkdir(parents=True, exist_ok=True)
        options.record.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"ok": True, "written": len(changes), "backup": str(backup) if backup else None,
                      "record": str(options.record) if options.record else None}, ensure_ascii=False))


if __name__ == "__main__":
    main()
