import json
import os

import pytest

from agent_mc_autonomy.configuration import Settings
from agent_mc_autonomy.server_login import prepare_login, public_login


def settings(**server):
    return Settings.parse({'server': {'host': 'fixture.test', 'port': 25565, 'username': 'Alice', **server}})


def test_private_login_material_uses_the_native_scoped_contract(tmp_path):
    selected = settings()
    path = prepare_login(tmp_path, selected, 'test-only-password')
    raw = json.loads(path.read_text('utf-8'))
    account, = raw['accounts']
    assert raw['enabled'] is True
    assert account['server'] == 'fixture.test:25565' and account['username'] == 'Alice'
    assert account['command'] == 'login' and 'repeatPassword' not in account
    assert 'test-only-password' not in path.read_text('utf-8')
    if os.name != 'nt':
        assert account['credentialFormat'] == 'file'
        credential = path.parent / account['credentialFile']
        assert credential.read_text('utf-8') == 'test-only-password\n'
        assert credential.stat().st_mode & 0o077 == 0
    assert 'password' not in json.dumps(public_login(tmp_path, selected))


def test_empty_password_preserves_material_but_never_reuses_another_identity(tmp_path):
    selected = settings()
    path = prepare_login(tmp_path, selected, 'test-only-password')
    before = {p.name: p.read_bytes() for p in path.parent.iterdir()}
    assert prepare_login(tmp_path, selected, '') == path
    assert before == {p.name: p.read_bytes() for p in path.parent.iterdir()}
    with pytest.raises(ValueError, match='login_password_required'):
        prepare_login(tmp_path, settings(username='Bob'), '')


@pytest.mark.parametrize('secret', ['with space', 'line\nbreak', '\x00secret', 'x' * 129, 123])
def test_invalid_credentials_are_rejected_without_echoing_them(tmp_path, secret):
    with pytest.raises(ValueError, match='login_password_invalid') as error:
        prepare_login(tmp_path, settings(), secret)
    assert str(secret) not in str(error.value)


def test_login_binding_does_not_modify_a_user_supplied_login_file(tmp_path):
    custom = tmp_path / 'custom.json'
    custom.write_text('preserved', encoding='utf-8')
    selected = settings(login_config_file=str(custom))
    state = public_login(tmp_path, selected)
    assert state == {'enabled': True, 'managed': False, 'configured': True}
    assert custom.read_text('utf-8') == 'preserved'


def test_missing_or_changed_managed_material_is_not_reported_as_saved(tmp_path):
    path = prepare_login(tmp_path, settings(), 'test-only-password')
    selected = settings(login_config_file=str(path))
    assert public_login(tmp_path, selected) == {'enabled': True, 'managed': True, 'configured': True}
    raw = json.loads(path.read_text('utf-8'))
    raw['accounts'][0]['username'] = 'Bob'
    path.write_text(json.dumps(raw), encoding='utf-8')
    assert public_login(tmp_path, selected)['configured'] is False
    with pytest.raises(ValueError, match='login_material_invalid'):
        prepare_login(tmp_path, selected, '')


def test_private_credential_preparation_supports_a_deep_windows_data_directory(tmp_path):
    from agent_mc_autonomy.filesystem import verification_path
    data = tmp_path.joinpath(*['中文 data directory' for _ in range(16)])
    path = prepare_login(data, settings(), 'fixture-only-secret')
    assert len(str(path)) > 300
    assert json.loads(verification_path(path).read_text('utf-8'))['accounts'][0]['command'] == 'login'
    assert prepare_login(data, settings(), '') == path
