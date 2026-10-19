import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from agent_mc_autonomy.controller import Controller


def state_host(tmp_path, value):
    path = tmp_path / "host-state.json"
    path.write_text(json.dumps(value), encoding="utf-8")
    return SimpleNamespace(data=tmp_path, state_path=path)


def test_dispatch_state_is_flushed_before_publication(tmp_path, monkeypatch):
    previous = {"stopped": False, "uncertain": True, "pending": ["task-1"]}
    host = state_host(tmp_path, previous)
    calls = []
    replace = Path.replace

    def sync(fd):
        assert fd >= 0
        assert json.loads(host.state_path.read_text()) == previous
        assert json.loads(host.state_path.with_suffix(".tmp").read_text())["inflight_request"] == "request-2"
        calls.append("fsync")

    def publish(path, target):
        assert calls == ["fsync"]
        calls.append("replace")
        return replace(path, target)

    monkeypatch.setattr("agent_mc_autonomy.controller.os.fsync", sync)
    monkeypatch.setattr(Path, "replace", publish)
    Controller.persist(host, inflight_request="request-2")
    assert calls == ["fsync", "replace"]
    assert json.loads(host.state_path.read_text()) == {**previous, "inflight_request": "request-2"}


def test_failed_flush_keeps_previous_unknown_state(tmp_path, monkeypatch):
    previous = {"stopped": True, "uncertain": True, "pending": ["task-1"]}
    host = state_host(tmp_path, previous)
    original = host.state_path.read_bytes()

    def fail(_):
        raise OSError("fixture: writeback failed")

    monkeypatch.setattr("agent_mc_autonomy.controller.os.fsync", fail)
    with pytest.raises(OSError, match="writeback failed"):
        Controller.persist(host, uncertain=False)
    assert host.state_path.read_bytes() == original


def test_corrupt_state_is_preserved_and_never_reset(tmp_path):
    host = state_host(tmp_path, {})
    original = b"\0" * 72
    host.state_path.write_bytes(original)
    with pytest.raises(json.JSONDecodeError):
        Controller.persist(host, stopped=False, uncertain=False, pending=[])
    assert host.state_path.read_bytes() == original
    assert not host.state_path.with_suffix(".tmp").exists()
