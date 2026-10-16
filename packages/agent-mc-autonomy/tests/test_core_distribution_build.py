"""The actual Git exporter must retain blob bytes under Windows checkout settings."""

import json
import subprocess

import pytest

from agent_mc_autonomy.core_distribution import build as builder

GIT_POPEN = subprocess.Popen

@pytest.mark.parametrize("autocrlf", ["true", "false"])
def test_actual_git_export_is_raw_lf(tmp_path, monkeypatch, autocrlf):
    repo = tmp_path / "repo"
    repo.mkdir()
    def isolated_git(command, **kwargs):
        assert command[:3] == ["git", "-C", str(repo)]
        assert not kwargs.get("shell")
        assert command[3] in {"init", "config", "add", "commit", "show", "-c"}
        return GIT_POPEN(command, **kwargs)
    monkeypatch.setattr(subprocess, "Popen", isolated_git)
    real_run, real_output = subprocess.run, subprocess.check_output
    def git(*args):
        return real_run(["git", "-C", str(repo), *args], check=True, capture_output=True)
    git("init")
    git("config", "core.autocrlf", autocrlf)
    git("config", "user.name", "Fixture")
    git("config", "user.email", "fixture@example.invalid")
    (repo / "engine").mkdir()
    (repo / "engine/source.js").write_bytes(b"export const value = 1;\n// second line\n")
    git("add", ".")
    git("commit", "-m", "fixture")
    original = real_output(["git", "-C", str(repo), "show", "HEAD:engine/source.js"])
    pins = tmp_path / "pins"
    pins.mkdir()
    (pins / "source.json").write_text(json.dumps({"source_revision": "HEAD", "source_path": "engine", "archive": "unused.tgz"}))
    monkeypatch.setattr(builder, "HERE", pins)
    monkeypatch.setattr(builder.shutil, "which", lambda name: name)
    calls = []
    def run(command, **kwargs):
        calls.append(command)
        if command[0] == "git":
            return real_run(command, **kwargs)
        return subprocess.CompletedProcess(command, 0)
    monkeypatch.setattr(subprocess, "run", run)
    monkeypatch.setattr(subprocess, "check_output", lambda *args, **kwargs: "11.5.0\n")
    output = tmp_path / "output"
    builder.build(repo, output)
    assert (output / "source.js").read_bytes() == original
    assert b"\r" not in original
    assert calls[0][3:7] == ["-c", "core.autocrlf=false", "-c", "core.eol=lf"]
