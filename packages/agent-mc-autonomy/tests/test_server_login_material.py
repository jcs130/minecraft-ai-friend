import json
import os

import pytest

from agent_mc_autonomy.configuration import Settings
from agent_mc_autonomy.server_login import prepare_login, public_login, _protect as native_protect


@pytest.fixture(autouse=True)
def isolated_credential_protection(monkeypatch):
    # These tests check scoped files and identity binding, not this host's RPC/
    # DPAPI policy. The native adapter's fail-closed behavior is tested below.
    import hashlib
    from agent_mc_autonomy import server_login
    monkeypatch.setattr(server_login, '_protect', lambda value: b'fixture-protected:' + hashlib.sha256(value).digest())


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


def test_native_protection_denial_has_a_sanitized_code_and_writes_no_credentials(tmp_path, monkeypatch):
    from agent_mc_autonomy import server_login
    def denied(_):
        raise server_login.CredentialProtectionError(5)
    monkeypatch.setattr(server_login, '_protect', denied)
    if os.name != 'nt':
        pytest.skip('Windows DPAPI preparation contract')
    with pytest.raises(server_login.CredentialProtectionError) as caught:
        prepare_login(tmp_path, settings(), 'never-echo-this-fixture')
    assert caught.value.winerror == 5
    assert str(caught.value) == 'login_credential_write_failed: windows_dpapi_error_5'
    assert not list(tmp_path.rglob('credential.private'))
    assert not list(tmp_path.rglob('login.json'))


@pytest.mark.skipif(os.name != 'nt', reason='Windows native API adapter')
def test_dpapi_adapter_preserves_user_scope_and_reports_access_denial(monkeypatch):
    import ctypes
    from types import SimpleNamespace
    from agent_mc_autonomy.server_login import CredentialProtectionError
    calls = []
    class Function:
        def __call__(self, *args):
            calls.append(args)
            return False
    native = Function()
    monkeypatch.setattr(ctypes, 'WinDLL', lambda name, **_: SimpleNamespace(
        CryptProtectData=native, LocalFree=Function()))
    monkeypatch.setattr(ctypes, 'get_last_error', lambda: 5)
    with pytest.raises(CredentialProtectionError, match='windows_dpapi_error_5'):
        native_protect(b'fixture-only-private')
    assert len(calls) == 1 and calls[0][5] == 1  # UI_FORBIDDEN, never LOCAL_MACHINE
    assert calls[0][1:5] == (None, None, None, None)


@pytest.mark.skipif(os.name != 'nt', reason='Windows native API adapter')
def test_dpapi_adapter_copies_native_output_and_wipes_input(monkeypatch):
    import ctypes
    from types import SimpleNamespace
    output = ctypes.create_string_buffer(b'fixture-encrypted-by-native-port')
    wiped, freed = [], []
    memset = ctypes.memset
    class Function:
        def __init__(self, fn): self.fn = fn
        def __call__(self, *args): return self.fn(*args)
    def protect(source, description, entropy, reserved, prompt, flags, destination):
        destination._obj.size = len(output.value)
        destination._obj.data = ctypes.cast(output, ctypes.POINTER(ctypes.c_ubyte))
        return True
    def wipe(address, value, length):
        result = memset(address, value, length)
        wiped.append(ctypes.string_at(address, length))
        return result
    monkeypatch.setattr(ctypes, 'WinDLL', lambda name, **_: SimpleNamespace(
        CryptProtectData=Function(protect), LocalFree=Function(lambda pointer: freed.append(True))))
    monkeypatch.setattr(ctypes, 'memset', wipe)
    assert native_protect(b'fixture-only-private') == output.value
    assert wiped == [b'\x00' * 21] and freed == [True]
