import importlib
import json
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest


def test_runner_forwards_local_appearance_only_to_optional_viewer(framework_module, tmp_path, run_async, monkeypatch):
    runner = importlib.import_module("agent_mc_autonomy.runner")
    settings = framework_module.Settings.parse({"autonomy": {"enabled": True},
        "server": {"host": "fixture.test", "username": "Alice"},
        "viewer": {"renderer_directory": "renderer", "catalog_file": "catalog.json",
                   "default_appearance": "bundled:yui-ysm", "auto_open": False}})
    configurations = []

    def bridge_factory(_node, _entry, config, _log):
        configurations.append(json.loads(config.read_text(encoding="utf-8")))
        return object()

    class Controller:
        def __init__(self, *_args, **_kwargs):
            pass

        async def run(self, _goal):
            pass

    monkeypatch.setattr(runner, "Controller", Controller)
    # Same viewer URL and offline username (hence same UUID), different server.
    # A same-account restart can use a different build without changing scope.
    for current in [settings, replace(settings, host="other-fixture.test"), replace(settings, backend_directory="new-build")]:
        run_async(runner.run_session(current, Path("core/bin/mcp.mjs"), tmp_path, None, "fixture",
                                    lambda **_values: None, lambda: False, bridge_factory=bridge_factory))
    config, other, restarted = configurations
    assert config["viewerIntegration"]["defaultAppearance"] == "bundled:yui-ysm"
    assert config["viewerIntegration"]["selectionScope"] == settings.identity
    assert config["viewerIntegration"]["selectionScope"] != other["viewerIntegration"]["selectionScope"]
    assert config["viewerIntegration"]["selectionScope"] == restarted["viewerIntegration"]["selectionScope"]
    assert "defaultAppearance" not in config["world"]
    assert config["world"]["username"] == "Alice" and config["world"]["version"] == "1.21.1"


@pytest.mark.parametrize("url,enabled,calls", [("", True, 0), ("https://viewer.test/", False, 0), ("https://viewer.test/", True, 1)])
def test_browser_opens_once_and_only_after_connection(framework_module, run_async, url, enabled, calls):
    module = importlib.import_module("agent_mc_autonomy.viewer")
    opened = []
    viewer = module.ViewerWindow(url, enabled, opener=lambda url, **kw: opened.append((url, kw)) or True)
    assert not opened
    run_async(viewer.connected())
    run_async(viewer.connected())  # Status refreshes/reconnects cannot open again.
    assert len(opened) == calls


def test_browser_failure_does_not_break_game_or_retry(framework_module, run_async):
    module = importlib.import_module("agent_mc_autonomy.viewer")

    def unavailable(*_, **__):
        raise OSError("private environment details")

    viewer = module.ViewerWindow("https://viewer.test/", opener=unavailable)
    assert run_async(viewer.connected()) == "manual_open_required"
    assert run_async(viewer.connected()) is None


def test_existing_viewer_reconnects_during_handover_without_another_tab(framework_module, run_async, monkeypatch):
    module = importlib.import_module("agent_mc_autonomy.viewer")
    opened, pauses = [], []

    async def pause(seconds):
        pauses.append(seconds)

    monkeypatch.setattr(module.asyncio, "sleep", pause)
    viewer = module.ViewerWindow("https://viewer.test/", opener=lambda *a, **kw: opened.append(a) or True)
    result = run_async(viewer.connected(existing_viewers=lambda: 1 if len(pauses) >= 2 else 0))
    assert result == "already_attached" and not opened and pauses == [0.25, 0.25]
    assert run_async(viewer.connected()) is None


def test_no_existing_viewer_still_opens_once_after_bounded_grace(framework_module, run_async, monkeypatch):
    module = importlib.import_module("agent_mc_autonomy.viewer")
    opened, pauses = [], []

    async def pause(seconds):
        pauses.append(seconds)

    monkeypatch.setattr(module.asyncio, "sleep", pause)
    viewer = module.ViewerWindow("https://viewer.test/", opener=lambda *a, **kw: opened.append(a) or True)
    assert run_async(viewer.connected(existing_viewers=lambda: False)) == "requested"
    assert len(opened) == 1 and len(pauses) == 16 and sum(pauses) == 4


def test_viewer_binding_requires_fresh_matching_identity(framework_module):
    module = importlib.import_module("agent_mc_autonomy.viewer")
    settings = framework_module.Settings.parse({"server": {"host": "localhost", "username": "ag_NEKO"}})
    now = datetime.now(timezone.utc)
    state = {"game_connected": True, "viewer": {"available": True, "updated_at": now.isoformat(),
             "url": "http://127.0.0.1:28985/3dview/", "player": {"uuid": "same-player"},
             "status": {"identity": {"confirmed": True, "player": "ag_NEKO", "playerUuid": "same-player"}}}}
    assert module.viewer_observation(settings, state)["viewer_body_binding_verified"]
    state["viewer"]["status"]["identity"]["playerUuid"] = "other-player"
    assert not module.viewer_observation(settings, state)["viewer_body_binding_verified"]
    state["viewer"]["status"]["identity"]["playerUuid"] = "same-player"
    state["viewer"]["updated_at"] = (now - timedelta(minutes=1)).isoformat()
    assert module.viewer_observation(settings, state) == {"viewer_url": "", "viewer_body_binding_verified": False}


def test_optional_viewer_configuration_is_atomic(framework_module):
    with pytest.raises(ValueError, match="renderer_catalog_pair_required"):
        framework_module.Settings.parse({"viewer": {"renderer_directory": "/renderer"}})
    settings = framework_module.Settings.parse({"viewer": {"renderer_directory": "/renderer", "catalog_file": "/catalog.json"}})
    assert not settings.enabled and settings.viewer_listen_port == 28985
