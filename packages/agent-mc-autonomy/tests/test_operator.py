import json

import pytest

from agent_mc_autonomy.configuration import Settings


def test_operator_is_opt_in_and_uses_account_scoped_native_binding(tmp_path):
    raw = {"server": {"host": "fixture.test", "username": "Alice"}}
    default = Settings.parse(raw)
    settings = Settings.parse({**raw, "operator": {"port": 28986}})
    assert default.console_port == 0
    assert settings.console_port == 28986
    native = settings.client_config(tmp_path)
    assert native["operatorIdentity"] == settings.identity
    assert native["consolePort"] == 28986
    assert settings.identity == default.identity
    assert "operatorIdentity" not in default.client_config(tmp_path)
    other = Settings.parse({"server": {"host": "fixture.test", "username": "Bob", "auth": "microsoft"}})
    assert other.identity != settings.identity
    assert other.client_config(tmp_path)["world"]["profilesFolder"] != native["world"]["profilesFolder"]


@pytest.mark.parametrize("operator", [{"port": True}, {"port": -1}, {"port": 65536}, {"port": 80}, {"url": "http://evil.test"}, {"token": "secret"}])
def test_operator_rejects_proxy_and_secret_configuration(operator):
    with pytest.raises(ValueError):
        Settings.parse({"operator": operator})


def test_operator_link_is_only_from_owned_descriptor(tmp_path):
    from agent_mc_autonomy.operator import operator_link

    settings = Settings.parse({"server": {"host": "fixture.test", "username": "Alice"}, "operator": {"port": 28986}})
    assert not operator_link(settings, tmp_path)["available"]
    directory = tmp_path / "sessions" / settings.identity / "client"
    directory.mkdir(parents=True)
    path = directory / "operator.json"
    descriptor = {"schema": "minecraft-operator-binding/v1", "identity": settings.identity, "instanceId": "a" * 64, "port": 28986}
    path.write_text(json.dumps(descriptor))
    result = operator_link(settings, tmp_path)
    assert result == {"available": True, "url": "http://127.0.0.1:28986/account/" + "a" * 64, "live_verified": False}
    for patch in [{"identity": "other"}, {"instanceId": "../../bad"}, {"port": 3000}, {"url": "https://evil.test"}]:
        path.write_text(json.dumps({**descriptor, **patch}))
        assert not operator_link(settings, tmp_path)["available"]
    path.write_text("x" * 5000)
    assert not operator_link(settings, tmp_path)["available"]


def test_connection_modes_keep_generic_default_and_infer_existing_remote_config():
    assert Settings.parse({}).connection_type == "local"
    assert Settings.parse({"server": {"host": "fixture.test"}}).connection_type == "custom"
    with pytest.raises(ValueError):
        Settings.parse({"server": {"connection_type": "local", "host": "fixture.test"}})
    with pytest.raises(ValueError):
        Settings.parse({"server": {"connection_type": "guessed"}})
