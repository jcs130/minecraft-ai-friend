"""One autonomous runtime shared by standalone and desktop frontends."""

from __future__ import annotations

import asyncio
import json
import os
import sqlite3
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from .bridge import MinecraftBridge
from .configuration import Settings
from .controller import Controller
from .failure_diagnostics import FailureDiagnostics, current
from .fast import FastPolicy, SystemOne
from .mailbox import Mailbox
from .observations import runtime_error_code
from .ownership import session_lease
from .planner import Planner
from .review import ReviewPort
from .viewer import ViewerWindow
from .viewer_public import record_playback, viewer_projection


def _replace_status(temporary: Path, destination: Path):
    """Brief Windows reader contention only; authoritative persistence is separate."""
    # Real Windows readers (including status observers) may retain a handle for
    # longer than the former 35 ms schedule. Retry the SAME prepared bytes for
    # at most 250 ms; never repeat a body action or hide persistent ACL/disk errors.
    deadline = time.monotonic() + .250
    failures = []
    first_trace = None
    for delay in (0, .005, .010, .020, .040, .080, .080):
        if delay:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            time.sleep(min(delay, remaining))
            if time.monotonic() >= deadline:
                break
        try:
            temporary.replace(destination)
            return
        except OSError as error:
            candidate = os.name == "nt" and getattr(error, "winerror", None) in {5, 32}
            if not failures and not candidate:
                raise
            if not failures:
                first_trace = error.__traceback__
            failures.append(error)
            if not candidate:
                break
    # Recovered retries are not fatal diagnostics. Exhaustion retains the first
    # object/trace and any later failure, including a different cleanup fault.
    diagnostics = current.get()
    if diagnostics is not None:
        for error in failures:
            diagnostics.capture(error, "status.publish")
    raise failures[0].with_traceback(first_trace)


def validate_start(settings: Settings, goal: str):
    if not settings.enabled:
        raise ValueError("autonomy_disabled")
    settings.require_server()
    if not isinstance(goal, str) or not goal.strip() or len(goal) > 4000:
        raise ValueError("invalid_goal")


async def run_session(settings: Settings, entry: Path, data_root: Path, planner: Planner | None, goal: str,
                      publish, stopped, *, bridge_factory=MinecraftBridge, viewer_opener=None, viewer_entry=None,
                      context_counter=None, host_context_provider=None, recent_context_provider=None):
    """Own the injected planner, lease, config, controller and all cleanup."""
    runtime_session = str(uuid.uuid4())
    state = {"phase": "starting", "game_connected": False, "autonomy_running": False, "standing_goal": goal,
             "runtime_session": runtime_session, "settings_identity": settings.identity}
    directory = data_root / "sessions" / settings.identity / "host"
    diagnostics = FailureDiagnostics(directory, runtime_session)
    diagnostic_context = current.set(diagnostics)
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
        try:
            if diagnostics.first is not None:
                values.update(diagnostics.reference())
            _update(**values)
        except Exception as error:
            diagnostics.capture(error, "status.publish")
            raise

    def _update(**values):
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
        _replace_status(temporary, directory / "status.json")
        publish(**state)
        if state.get("game_connected") is True and viewer_task is None and settings.viewer_auto_open and viewer.url:
            viewer_task = asyncio.create_task(open_viewer())

    try:
        validate_start(settings, goal)
        bundle_env = {}
        if settings.bundle_root:
            from .runtime_bundle import verify_settings_runtime
            bundle_env = verify_settings_runtime(settings)
            from .core_distribution.install import runtime_entry
            if entry.resolve() != runtime_entry(Path(settings.backend_directory)).resolve():
                raise ValueError("runtime_bundle_core_entry_mismatch")
        validate_profiles=getattr(planner,'validate_profiles',None)
        if validate_profiles:
            validate_profiles(settings.decision_policy)
        if stopped():
            return
        with session_lease(directory):
            commands = Mailbox(directory)
            commands.check_uncertain()
            from .recovery import require_no_pending_acknowledgement
            require_no_pending_acknowledgement(directory)
            config = directory / "client.json"
            client_config = settings.client_config(data_root)
            if settings.viewer_renderer_directory:
                client_config["viewerIntegration"] = {
                    "packageDirectory": str(entry.parent.parent), "rendererDirectory": settings.viewer_renderer_directory,
                    "catalogFile": settings.viewer_catalog_file, "port": settings.viewer_listen_port,
                    "bundledAppearanceCatalogFile": settings.viewer_bundled_appearance_catalog_file,
                    "defaultAppearance": settings.viewer_default_appearance,
                    "selectionScope": settings.identity,
                    "presentationModule": settings.server_presentation_module,
                    "presentationSha256": settings.server_presentation_sha256,
                    "stateFile": str(directory / "viewer-state.json"), "session": viewer_session,
                    "agentStateFile": str(directory / "viewer-agent.json"),
                }
                entry = Path(viewer_entry) if viewer_entry else Path(__file__).parent / "integrations" / "viewer-stdio.mjs"
            config.write_text(json.dumps(client_config, ensure_ascii=False), encoding="utf-8")
            update()
            memory_env = {**bundle_env, **settings.memory.environment()}
            bridge = bridge_factory(settings.node, entry, config, directory / "backend.log", **({"env": memory_env} if memory_env else {}))
            try:
                if settings.fast.mode == "system_one" and planner:
                    system_one = SystemOne(settings.fast)
                selector = system_one.select if system_one else getattr(planner, "select_fast", None) if settings.fast.mode == "host" else None
                policy = FastPolicy(settings.fast, selector)
                counter = context_counter if context_counter is not None else getattr(planner, "context_counter", None)
                counter_options = {"context_counter": counter} if counter is not None else {}
                counter_options["runtime_session"] = runtime_session
                schema_profile = getattr(getattr(planner, "config", None), "tool_schema_profile", "default")
                if schema_profile != "default":
                    counter_options["tool_schema_profile"] = schema_profile
                if host_context_provider is not None:
                    counter_options["host_context_provider"] = host_context_provider
                if recent_context_provider is not None:
                    counter_options["recent_context_provider"] = recent_context_provider
                if settings.decision_policy.enabled and callable(getattr(planner,'decide_profile',None)):
                    counter_options['profile_decide']=planner.decide_profile
                await Controller(bridge, planner.decide if planner else None, settings, directory, update, stopped,
                                 commands, policy, **counter_options).run(goal.strip())
            except asyncio.CancelledError:
                commands.stop_queued()
                update(phase="stopped")
                raise
            except Exception as error:
                diagnostics.capture(error, "controller.run")
                update(phase="failed", error=runtime_error_code(error))
                raise
            finally:
                update(game_connected=False, autonomy_running=False)
    except Exception as error:
        diagnostics.capture(error, "session.run")
        raise
    finally:
        try:
            for operation, cleanup in (("viewer.close", (lambda: viewer_task) if viewer_task else None),
                                       ("system_one.close", system_one.aclose if system_one else None),
                                       ("planner.close", planner.aclose if planner else None)):
                if cleanup is not None:
                    try:
                        await cleanup()
                    except Exception as error:
                        diagnostics.capture(error, operation)
        finally:
            current.reset(diagnostic_context)
        if diagnostics.first is not None:
            raise diagnostics.first
