"""Read-only topic recall through the server's scoped MC notebook."""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
import subprocess

from ..social import identifier, read_json


class CompanionRecall:
    def __init__(self, settings: dict, journal: Path, realm: str) -> None:
        self.node, self.script, self.config, self.token = (
            Path(settings[key]) for key in ("node", "script", "config", "tokenFile")
        )
        if any(not path.is_absolute() for path in (self.node, self.script, self.config, self.token)):
            raise ValueError("absolute_dialogue_memory_paths_required")
        config = read_json(self.config)
        if (not config or config.get("schema") != 1 or config.get("realm") != realm
                or Path(config.get("journalRoot", "")).resolve() != journal.resolve()
                or not isinstance(config.get("npcs"), list)):
            raise ValueError("dialogue_memory_authority_mismatch")
        self.remotes = {}
        for row in config["npcs"]:
            memory = row.get("memory", {})
            body, env = identifier(row.get("maidId")), memory.get("apiKeyEnv")
            if body and memory.get("mode") == "remote" and memory.get("provider") == "powercontext":
                if not isinstance(env, str) or not env.isascii() or not env.isidentifier() or not memory.get("scopeId"):
                    raise ValueError("dedicated_dialogue_memory_scope_required")
                self.remotes[body] = env
        self.capacity = asyncio.Semaphore(2)

    async def search(self, body: str, request: str) -> tuple[tuple[str, ...], str]:
        env_name = self.remotes.get(body)
        if not env_name:
            return (), "local"
        async with self.capacity:
            try:
                token = await asyncio.to_thread(lambda: self.token.read_text(encoding="utf-8-sig").strip())
                if not token:
                    return (), "local_fallback"
                options = {"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}
                process = await asyncio.create_subprocess_exec(
                    str(self.node), "--experimental-transform-types", str(self.script), str(self.config),
                    "--recall", body, request, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
                    env=os.environ | {env_name: token}, **options,
                )
                try:
                    output, _ = await asyncio.wait_for(process.communicate(), timeout=3)
                finally:
                    if process.returncode is None:
                        try:
                            process.kill()
                        except ProcessLookupError:
                            pass
                        await process.wait()
                if process.returncode or len(output) > 1024:
                    return (), "local_fallback"
                result = json.loads(output)
                if not isinstance(result, dict) or result.get("mode") != "hybrid":
                    return (), "local_fallback"
                ids = result.get("sourceRequestIds")
                if not isinstance(ids, list) or len(ids) > 8 or any(not isinstance(value, str) or identifier(value) != value for value in ids):
                    return (), "local_fallback"
                return tuple(dict.fromkeys(ids)), "hybrid"
            except (OSError, ValueError, TimeoutError):
                return (), "local_fallback"
