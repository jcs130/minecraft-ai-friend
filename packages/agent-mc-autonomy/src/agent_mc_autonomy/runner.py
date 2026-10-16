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
from .observations import runtime_error_code
from .ownership import session_lease
from .planner import Planner
from .review import ReviewPort
from .viewer import ViewerWindow
from .viewer_public import record_playback, viewer_projection


def validate_start(settings: Settings, goal: str):
    if not settings.enabled:
        raise ValueError("autonomy_disabled")
    settings.require_server()
    if not isinstance(goal, str) or not goal.strip() or len(goal) > 4000:
        raise ValueError("invalid_goal")


async def run_session(settings: Settings, entry: Path, data_root: Path, planner: Planner | None, goal: str,
                      publish, stopped, *, bridge_factory=MinecraftBridge, viewer_opener=None, viewer_entry=None,
                      context_counter=None):
    """Own the injected planner, lease, config, controller and all cleanup."""
    state = {"phase": "starting", "game_connected": False, "autonomy_running": False, "standing_goal": goal}
    directory = data_root / "sessions" / settings.identity / "host"
    system_one = None
    viewer = ViewerWindow(settings.external_viewer_url, settings.viewer_auto_open, opener=viewer_opener)
    viewer_task = None
    viewer_session = str(uuid.uuid4())
    reviews = ReviewPort(directory)

    async def open_viewer():
        # Existing pages reconnect to the same owned viewer after a handover.
        # Give those streams time to attach without delaying the game loop.
        existing = (lambda: (state.get("viewer") or {}).get("active_viewers")) if settings.viewer_renderer_directory else None
        result = await viewer.connected(existing_viewers=existing)
        if result:
            update(viewer_window=result)

    def update(**values):
        nonlocal viewer_task
        record_playback(state, values)
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
        if settings.viewer_renderer_directory:
            try:
                public_file = directory / "viewer-agent.json"
                public_tmp = public_file.with_suffix(".tmp")
                public_tmp.write_text(json.dumps(viewer_projection(state, settings.username, viewer_session), ensure_ascii=False), encoding="utf-8")
                public_tmp.replace(public_file)
            except OSError:
                pass  # Optional playback telemetry cannot stop the game owner.
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
        validate_profiles=getattr(planner,'validate_profiles',None)
        if validate_profiles:
            validate_profiles(settings.decision_policy)
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
                    "bundledAppearanceCatalogFile": settings.viewer_bundled_appearance_catalog_file,
                    "defaultAppearance": settings.viewer_default_appearance,
                    "selectionScope": settings.identity,
                    "stateFile": str(directory / "viewer-state.json"), "session": viewer_session,
                    "agentStateFile": str(directory / "viewer-agent.json"),
                }
                entry = Path(viewer_entry) if viewer_entry else Path(__file__).parent / "integrations" / "viewer-stdio.mjs"
            config.write_text(json.dumps(client_config, ensure_ascii=False), encoding="utf-8")
            update()
            memory_env = settings.memory.environment()
            bridge = bridge_factory(settings.node, entry, config, directory / "backend.log", **({"env": memory_env} if memory_env else {}))
            try:
                if settings.fast.mode == "system_one" and planner:
                    system_one = SystemOne(settings.fast)
                selector = system_one.select if system_one else getattr(planner, "select_fast", None) if settings.fast.mode == "host" else None
                policy = FastPolicy(settings.fast, selector)
                counter = context_counter if context_counter is not None else getattr(planner, "context_counter", None)
                counter_options = {"context_counter": counter} if counter is not None else {}
                if settings.decision_policy.enabled and callable(getattr(planner,'decide_profile',None)):
                    counter_options['profile_decide']=planner.decide_profile
                await Controller(bridge, planner.decide if planner else None, settings, directory, update, stopped,
                                 commands, policy, **counter_options).run(goal.strip())
            except asyncio.CancelledError:
                commands.stop_queued()
                update(phase="stopped")
                raise
            except Exception as error:
                update(phase="failed", error=runtime_error_code(error))
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
