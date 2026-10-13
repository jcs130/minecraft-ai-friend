"""One autonomous runtime shared by standalone and desktop frontends."""

from __future__ import annotations

import asyncio
import json
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path

from .bridge import MinecraftBridge
from .configuration import Settings
from .controller import Controller
from .fast import FastPolicy, SystemOne
from .mailbox import Mailbox
from .ownership import session_lease
from .planner import Planner
from .review import ReviewPort
from .viewer import ViewerWindow


def validate_start(settings: Settings, goal: str):
    if not settings.enabled:
        raise ValueError("autonomy_disabled")
    settings.require_server()
    if not isinstance(goal, str) or not goal.strip() or len(goal) > 4000:
        raise ValueError("invalid_goal")


async def run_session(settings: Settings, entry: Path, data_root: Path, planner: Planner | None, goal: str,
                      publish, stopped, *, bridge_factory=MinecraftBridge, viewer_opener=None, viewer_entry=None):
    """Own the injected planner, lease, config, controller and all cleanup."""
    state = {"phase": "starting", "game_connected": False, "autonomy_running": False, "standing_goal": goal}
    directory = data_root / "sessions" / settings.identity / "host"
    system_one = None
    viewer = ViewerWindow(settings.external_viewer_url, settings.viewer_auto_open, opener=viewer_opener)
    viewer_task = None
    viewer_session = str(uuid.uuid4())
    reviews = ReviewPort(directory)

    async def open_viewer():
        result = await viewer.connected()
        if result:
            update(viewer_window=result)

    def update(**values):
        nonlocal viewer_task
        state.update(values)
        if settings.viewer_renderer_directory:
            try:
                current = json.loads((directory / "viewer-state.json").read_text(encoding="utf-8"))
                if current.get("session") == viewer_session:
                    state["viewer"] = current
                    viewer.url = current.get("url", "") if current.get("available") else ""
            except (OSError, ValueError):
                pass
        state.update(updated_at=datetime.now(timezone.utc).isoformat(), owner_pid=os.getpid())
        try:
            reviews.observe(state)
            state.pop("review_error", None)
        except (sqlite3.Error, OSError):
            # An unavailable optional frontend mailbox must not kill native gameplay.
            state["review_error"] = "review_store_unavailable"
        temporary = directory / "status.tmp"
        temporary.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
        temporary.replace(directory / "status.json")
        publish(**state)
        if state.get("game_connected") is True and viewer_task is None and settings.viewer_auto_open and viewer.url:
            viewer_task = asyncio.create_task(open_viewer())

    try:
        validate_start(settings, goal)
        if stopped():
            return
        with session_lease(directory):
            commands = Mailbox(directory)
            commands.check_uncertain()
            config = directory / "client.json"
            client_config = settings.client_config(data_root)
            if settings.viewer_renderer_directory:
                client_config["viewerIntegration"] = {
                    "packageDirectory": str(entry.parent.parent), "rendererDirectory": settings.viewer_renderer_directory,
                    "catalogFile": settings.viewer_catalog_file, "port": settings.viewer_listen_port,
                    "stateFile": str(directory / "viewer-state.json"), "session": viewer_session,
                }
                entry = Path(viewer_entry) if viewer_entry else Path(__file__).parent / "integrations" / "viewer-stdio.mjs"
            config.write_text(json.dumps(client_config, ensure_ascii=False), encoding="utf-8")
            update()
            bridge = bridge_factory(settings.node, entry, config, directory / "backend.log")
            try:
                if settings.fast.mode == "system_one" and planner:
                    system_one = SystemOne(settings.fast)
                selector = system_one.select if system_one else getattr(planner, "select_fast", None) if settings.fast.mode == "host" else None
                policy = FastPolicy(settings.fast, selector)
                await Controller(bridge, planner.decide if planner else None, settings, directory, update, stopped, commands, policy).run(goal.strip())
            except asyncio.CancelledError:
                commands.stop_queued()
                update(phase="stopped")
                raise
            except Exception as error:
                update(phase="failed", error=type(error).__name__)
                raise
            finally:
                update(game_connected=False, autonomy_running=False)
    finally:
        if viewer_task:
            await viewer_task
        if system_one:
            await system_one.aclose()
        if planner:
            await planner.aclose()
