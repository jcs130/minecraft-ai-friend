"""Explicit reference indexes are configuration, never personal memory or I/O."""

import pytest

from agent_mc_autonomy.configuration import Settings


def configured(raw=None):
    return Settings.parse({"server": {"host": "fixture.invalid", "username": "Alice"}, **(raw or {})})


def test_reference_index_is_omitted_by_default_and_does_not_change_identity(tmp_path):
    baseline = configured()
    assert "knowledge" not in baseline.client_config(tmp_path)["world"]
    index = tmp_path / "separate-reference.sqlite"
    settings = configured({"knowledge": {"minedojo_index_file": str(index), "retrieval": "hybrid"}})
    assert settings.client_config(tmp_path)["world"]["knowledge"] == {
        "minedojo": {"indexFile": str(index), "retrieval": "hybrid"}}
    assert settings.identity == baseline.identity
    assert settings.memory == baseline.memory
    assert not index.exists()


@pytest.mark.parametrize("mode", ["hybrid", "lexical", "local-vector"])
def test_only_explicit_local_retrieval_modes_are_forwarded(tmp_path, mode):
    settings = configured({"knowledge": {"minedojo_index_file": str(tmp_path / "wiki.sqlite"), "retrieval": mode}})
    assert settings.client_config(tmp_path)["world"]["knowledge"]["minedojo"]["retrieval"] == mode


@pytest.mark.parametrize("raw", [None, "wiki", {"minedojo_index_file": "relative/wiki.sqlite"},
    {"minedojo_index_file": "https://example.invalid/wiki.sqlite"}, {"minedojo_index_file": 7},
    {"retrieval": "semantic"}, {"retrieval": True}, {"embeddings": {"endpoint": "https://example.invalid"}}])
def test_invalid_or_remote_reference_configuration_is_rejected(raw):
    with pytest.raises(ValueError):
        configured({"knowledge": raw})


def test_blank_index_keeps_reference_source_unconfigured(tmp_path):
    settings = configured({"knowledge": {"minedojo_index_file": "", "retrieval": "local-vector"}})
    assert "knowledge" not in settings.client_config(tmp_path)["world"]
