import dataclasses
import json
import os
from pathlib import Path
from types import SimpleNamespace

import pytest
from test_controller import Bridge, choose

from agent_mc_autonomy import runner


def denied(code=5):
    error = PermissionError(13, "fixture denied")
    error.winerror = code
    return error


class Clock:
    def __init__(self, overshoot=0):
        self.now, self.overshoot, self.waits = 0, overshoot, []

    def monotonic(self):
        return self.now

    def sleep(self, delay):
        self.waits.append(delay)
        self.now += delay + self.overshoot


class Prepared:
    def __init__(self, clock, failures):
        self.clock, self.failures, self.attempts = clock, iter(failures), []

    def replace(self, destination):
        self.attempts.append((self.clock.now, destination))
        error = next(self.failures, None)
        if error is not None:
            raise error


def setup(monkeypatch, failures, platform="nt", overshoot=0):
    clock = Clock(overshoot)
    monkeypatch.setattr(runner, "time", clock, raising=False)
    monkeypatch.setattr(runner, "os", SimpleNamespace(name=platform, getpid=os.getpid))
    return clock, Prepared(clock, failures)


@pytest.mark.parametrize("code", [5, 32])
def test_transient_candidate_replaces_same_prepared_snapshot(monkeypatch, code):
    clock, prepared = setup(monkeypatch, [denied(code), denied(code)])
    runner._replace_status(prepared, "status.json")
    assert clock.waits == [.005, .010]
    assert prepared.attempts == [(0, "status.json"), (.005, "status.json"), (.015, "status.json")]


def test_persistent_denial_raises_first_object_with_original_trace(monkeypatch):
    first = denied()
    clock, prepared = setup(monkeypatch, [first, *[denied(32) for _ in range(6)]])
    with pytest.raises(PermissionError) as raised:
        runner._replace_status(prepared, "status.json")
    assert raised.value is first
    assert clock.waits == [.005, .010, .020, .040, .080, .080]
    assert len(prepared.attempts) == 7 and clock.now == pytest.approx(.235)
    trace = raised.value.__traceback__
    assert sum(frame.tb_frame.f_code.co_name == "replace" for frame in traceback_frames(trace)) == 1


def traceback_frames(trace):
    while trace:
        yield trace
        trace = trace.tb_next


def test_scheduler_overshoot_does_not_issue_an_attempt_after_deadline(monkeypatch):
    first = denied()
    clock, prepared = setup(monkeypatch, [first], overshoot=.260)
    with pytest.raises(PermissionError) as raised:
        runner._replace_status(prepared, "status.json")
    assert raised.value is first
    assert len(prepared.attempts) == 1 and clock.waits == [.005]


def test_later_different_error_propagates_first_without_more_wait(monkeypatch):
    first, later = denied(), OSError(28, "fixture disk")
    clock, prepared = setup(monkeypatch, [first, later])
    with pytest.raises(PermissionError) as raised:
        runner._replace_status(prepared, "status.json")
    assert raised.value is first
    assert len(prepared.attempts) == 2 and clock.waits == [.005]


@pytest.mark.parametrize("error", [PermissionError(13, "errno alone"), denied(2), OSError(28, "disk")])
def test_other_errors_are_immediate(monkeypatch, error):
    clock, prepared = setup(monkeypatch, [error])
    with pytest.raises(OSError) as raised:
        runner._replace_status(prepared, "status.json")
    assert raised.value is error and len(prepared.attempts) == 1 and not clock.waits


def test_non_windows_is_immediate(monkeypatch):
    first = denied()
    clock, prepared = setup(monkeypatch, [first], platform="posix")
    with pytest.raises(PermissionError) as raised:
        runner._replace_status(prepared, "status.json")
    assert raised.value is first and len(prepared.attempts) == 1 and not clock.waits


def test_slow_attempt_does_not_start_another_after_deadline(monkeypatch):
    first = denied()
    clock, prepared = setup(monkeypatch, [first])
    replace = prepared.replace

    def slow(destination):
        try:
            replace(destination)
        finally:
            clock.now += .260

    prepared.replace = slow
    with pytest.raises(PermissionError) as raised:
        runner._replace_status(prepared, "status.json")
    assert raised.value is first and len(prepared.attempts) == 1 and not clock.waits


class Planner:
    def __init__(self):
        self.calls = 0

    async def decide(self, *_):
        self.calls += 1
        return choose()

    async def aclose(self):
        pass


@pytest.mark.skipif(os.name != "nt", reason="Windows file sharing semantics")
def test_real_reader_lock_longer_than_short_retry_window_recovers(tmp_path):
    import ctypes
    import threading
    from ctypes import wintypes

    destination, temporary = tmp_path / "status.json", tmp_path / "status.tmp"
    destination.write_text('old', encoding='utf-8')
    temporary.write_text('complete new snapshot', encoding='utf-8')
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p,
                                  wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
    kernel.CreateFileW.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = kernel.CreateFileW(str(destination), 0x80000000, 3, None, 3, 0, None)
    assert handle != ctypes.c_void_p(-1).value
    release = threading.Timer(.100, lambda: kernel.CloseHandle(handle))
    release.start()
    try:
        runner._replace_status(temporary, destination)
        assert destination.read_text('utf-8') == 'complete new snapshot'
        assert not temporary.exists()
    finally:
        release.join(timeout=1)


def test_retry_does_not_rewrite_freshness_repeat_callbacks_or_dispatch(tmp_path, monkeypatch, run_async):
    settings = dataclasses.replace(runner.Settings(), enabled=True, host="example.test", username="Fixture", max_decisions=1)
    monkeypatch.setattr(runner, "os", SimpleNamespace(name="nt", getpid=os.getpid))
    body, planner, published, writes, attempts = Bridge(), Planner(), [], [], []
    write_text, replace = Path.write_text, Path.replace

    def write(path, text, *args, **kwargs):
        if path.name == "status.tmp":
            writes.append(text)
        return write_text(path, text, *args, **kwargs)

    def move(path, target):
        if Path(target).name == "status.json":
            attempts.append(path.read_bytes())
            if len(attempts) <= 2:
                raise denied()
        return replace(path, target)

    monkeypatch.setattr(Path, "write_text", write)
    monkeypatch.setattr(Path, "replace", move)
    run_async(runner.run_session(settings, tmp_path / "fake", tmp_path, planner, "fixture",
                                lambda **state: published.append(state), lambda: False, bridge_factory=lambda *_: body))
    assert attempts[0] == attempts[1] == attempts[2] == writes[0].encode()
    assert len(attempts) == len(writes) + 2 and len(published) == len(writes)
    assert planner.calls == 1 and sum(call[0] == "mc_do" for call in body.calls) == 1
    assert not list(tmp_path.rglob("runtime-diagnostics/*.json"))


def test_temporary_write_denial_is_not_retried(tmp_path, monkeypatch, run_async):
    settings = dataclasses.replace(runner.Settings(), enabled=True, host="example.test", username="Fixture")
    first, writes, published = denied(), [], []
    write_text = Path.write_text

    def write(path, text, *args, **kwargs):
        if path.name == "status.tmp":
            writes.append(text)
            raise first
        return write_text(path, text, *args, **kwargs)

    monkeypatch.setattr(Path, "write_text", write)
    with pytest.raises(PermissionError) as raised:
        run_async(runner.run_session(settings, tmp_path / "fake", tmp_path, Planner(), "fixture",
                                    lambda **state: published.append(state), lambda: False, bridge_factory=lambda *_: Bridge()))
    assert raised.value is first and len(writes) == 1 and not published
    diagnostic = json.loads(next(tmp_path.rglob("runtime-diagnostics/*.json")).read_text())
    assert diagnostic["exceptions"][0]["operation"] == "status.publish"
