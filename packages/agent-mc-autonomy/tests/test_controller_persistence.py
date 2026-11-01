import ctypes
import json
import os
import threading
from ctypes import wintypes
from pathlib import Path

import pytest

from agent_mc_autonomy import controller as controller_module
from agent_mc_autonomy.filesystem import replace_prepared
from agent_mc_autonomy.controller import Controller


def controller(tmp_path):
    value = Controller.__new__(Controller)
    value.data = tmp_path
    value.state_path = tmp_path / "host-state.json"
    value.state_path.write_text(json.dumps({"inflight_request": "fixture", "uncertain": True,
                                          "stopped": True, "pending": []}), encoding="utf-8")
    return value


@pytest.mark.skipif(os.name != "nt", reason="Windows reader sharing semantics")
def test_reader_handle_released_after_100ms_does_not_abort_persistence(tmp_path):
    value = controller(tmp_path)
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p,
                                  wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
    kernel.CreateFileW.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = kernel.CreateFileW(str(value.state_path), 0x80000000, 3, None, 3, 0, None)
    assert handle != ctypes.c_void_p(-1).value
    release = threading.Timer(.100, lambda: kernel.CloseHandle(handle))
    release.start()
    try:
        value.persist(inflight_request=None, uncertain=False)
        assert json.loads(value.state_path.read_text()) == {
            "inflight_request": None, "uncertain": False, "stopped": True, "pending": []}
        assert list(tmp_path.iterdir()) == [value.state_path]
    finally:
        release.join(timeout=1)


def denied(code=5):
    error = PermissionError(13, "fixture replacement denied")
    error.winerror = code
    return error


@pytest.fixture
def windows_replace(monkeypatch):
    monkeypatch.setattr(controller_module, "replace_prepared",
                        lambda source, destination: replace_prepared(source, destination, platform="nt"))


def test_retry_reuses_one_fsynced_candidate_and_preserves_state(tmp_path, monkeypatch, windows_replace):
    value = controller(tmp_path)
    replace, sync = Path.replace, os.fsync
    attempts, synced = [], []

    def move(path, target):
        attempts.append((path, path.read_bytes(), json.loads(Path(target).read_text())))
        if len(attempts) < 3:
            raise denied()
        return replace(path, target)

    def fsync(fd):
        synced.append(fd)
        sync(fd)

    monkeypatch.setattr(Path, "replace", move)
    monkeypatch.setattr(os, "fsync", fsync)
    value.persist(pending=[{"request_id": "known-receipt"}])
    assert len(attempts) == 3 and len(synced) == 1
    assert attempts[0] == attempts[1] == attempts[2]
    saved = json.loads(value.state_path.read_text())
    assert saved["inflight_request"] == "fixture" and saved["uncertain"] is True
    assert saved["pending"] == [{"request_id": "known-receipt"}]
    assert list(tmp_path.iterdir()) == [value.state_path]


def test_persistent_denial_keeps_prior_unknown_guard_and_is_bounded(tmp_path, monkeypatch, windows_replace):
    value = controller(tmp_path)
    prior = value.state_path.read_bytes()
    attempts = []

    def move(path, target):
        attempts.append(path)
        raise denied()

    monkeypatch.setattr(Path, "replace", move)
    with pytest.raises(PermissionError):
        value.persist(inflight_request=None, uncertain=False)
    assert 1 < len(attempts) <= 7
    assert value.state_path.read_bytes() == prior
    assert list(tmp_path.iterdir()) == [value.state_path]


def test_disk_failure_is_not_retried_or_committed(tmp_path, monkeypatch):
    value = controller(tmp_path)
    prior = value.state_path.read_bytes()
    attempts = []

    def move(path, target):
        attempts.append(path)
        raise OSError(28, "fixture disk full")

    monkeypatch.setattr(Path, "replace", move)
    with pytest.raises(OSError, match="disk full"):
        value.persist(uncertain=False)
    assert len(attempts) == 1 and value.state_path.read_bytes() == prior
    assert list(tmp_path.iterdir()) == [value.state_path]
