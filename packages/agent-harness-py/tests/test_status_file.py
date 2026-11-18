import json
import os

import pytest

from agent_mc_harness import status_file


def test_windows_sharing_failure_retries_and_publishes_complete_snapshot(tmp_path, monkeypatch):
    status = status_file.StatusFile(tmp_path / "health.json")
    replace = os.replace
    attempts = 0

    def briefly_busy(source, target):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            failure = PermissionError("sharing conflict")
            failure.winerror = 32
            raise failure
        replace(source, target)

    monkeypatch.setattr(status_file.os, "replace", briefly_busy)
    assert status.publish({"pid": 42})
    assert attempts == 2
    assert json.loads(status.path.read_text()) == {"pid": 42}


@pytest.mark.skipif(os.name != "nt", reason="Windows reader handle denies rename")
def test_real_reader_does_not_break_publisher_or_partial_write(tmp_path):
    status = status_file.StatusFile(tmp_path / "supervisor.json")
    assert status.publish({"pid": 41})
    with status.path.open("rb") as reader:
        assert not status.publish({"pid": 42})
        assert json.load(reader) == {"pid": 41}
    assert json.loads(status.path.read_text()) == {"pid": 41}
    assert status.publish({"pid": 43})
    assert json.loads(status.path.read_text()) == {"pid": 43}


def test_nonsharing_error_is_reported_to_lifecycle(tmp_path, monkeypatch):
    status = status_file.StatusFile(tmp_path / "health.json")

    def unavailable(source, target):
        raise OSError("disk unavailable")

    monkeypatch.setattr(status_file.os, "replace", unavailable)
    with pytest.raises(OSError, match="disk unavailable"):
        status.publish({"pid": 41})
