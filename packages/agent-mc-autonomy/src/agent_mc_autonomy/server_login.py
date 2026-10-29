"""Prepare private references consumed by the core's existing scoped login client."""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

from .filesystem import verification_path


class CredentialProtectionError(ValueError):
    """Sanitized native failure; never fall back to a weaker credential format."""
    def __init__(self, winerror):
        self.winerror = winerror
        super().__init__(f'login_credential_write_failed: windows_dpapi_error_{winerror}')


def _protect(value: bytes) -> bytes:
    """Use the current Windows user's DPAPI; the core already reads this format."""
    import ctypes
    from ctypes import wintypes

    class Blob(ctypes.Structure):
        _fields_ = [('size', wintypes.DWORD), ('data', ctypes.POINTER(ctypes.c_ubyte))]

    crypt = ctypes.WinDLL('crypt32', use_last_error=True)
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    crypt.CryptProtectData.argtypes = [ctypes.POINTER(Blob), wintypes.LPCWSTR, ctypes.c_void_p,
                                      ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    crypt.CryptProtectData.restype = wintypes.BOOL
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p
    buffer = ctypes.create_string_buffer(value)
    source, result = Blob(len(value), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte))), Blob()
    try:
        if not crypt.CryptProtectData(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(result)):
            raise CredentialProtectionError(ctypes.get_last_error())
        return ctypes.string_at(result.data, result.size)
    finally:
        ctypes.memset(buffer, 0, len(buffer))
        if result.data:
            kernel.LocalFree(result.data)


def _directory(data, settings):
    return Path(data).resolve() / 'server-login' / settings.identity


def _account(settings):
    return {'server': f'{settings.host}:{settings.port}', 'username': settings.username,
            'credentialFile': 'credential.private', 'credentialFormat': 'dpapi' if os.name == 'nt' else 'file',
            'command': 'login'}


def _valid(path, settings):
    try:
        path = verification_path(path)
        if path.is_symlink() or path.parent.is_symlink():
            return False
        if not 0 < path.stat().st_size <= 32768:
            return False
        if json.loads(path.read_text('utf-8')) != {'enabled': True, 'accounts': [_account(settings)]}:
            return False
        credential = path.parent / 'credential.private'
        return (not credential.is_symlink() and credential.is_file() and 0 < credential.stat().st_size <= 16384
                and (os.name == 'nt' or not credential.stat().st_mode & 0o077))
    except (OSError, ValueError):
        return False


def public_login(data, settings):
    path = _directory(data, settings) / 'login.json'
    configured = bool(settings.login_config_file)
    managed = configured and Path(settings.login_config_file).absolute() == path
    return {'enabled': configured, 'managed': managed, 'configured': _valid(path, settings) if managed else configured}


def _write(path, value):
    path = verification_path(path)
    if path.is_symlink():
        raise ValueError('login_material_invalid')
    name = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix='.login-', delete=False) as output:
            name = output.name
            if os.name != 'nt':
                os.fchmod(output.fileno(), 0o600)
            output.write(value)
            output.flush()
            os.fsync(output.fileno())
        os.replace(name, path)
    finally:
        if name and os.path.exists(name):
            os.unlink(name)


def prepare_login(data, settings, password):
    settings.require_server()
    if not isinstance(password, str) or len(password) > 128 or any(c.isspace() or ord(c) < 32 or ord(c) == 127 for c in password):
        raise ValueError('login_password_invalid')
    directory = _directory(data, settings)
    path = directory / 'login.json'
    if not password:
        if not verification_path(path).exists():
            raise ValueError('login_password_required')
        if not _valid(path, settings):
            raise ValueError('login_material_invalid')
        return path
    try:
        target = verification_path(directory)
        if target.parent.is_symlink() or target.is_symlink():
            raise ValueError('login_material_invalid')
        target.mkdir(parents=True, exist_ok=True, mode=0o700)
        if os.name != 'nt':
            target.chmod(0o700)
        secret = _protect(password.encode('utf-8')) if os.name == 'nt' else (password + '\n').encode('utf-8')
        _write(directory / 'credential.private', secret)
        _write(path, (json.dumps({'enabled': True, 'accounts': [_account(settings)]}, indent=2) + '\n').encode('utf-8'))
        return path
    except OSError:
        raise ValueError('login_credential_write_failed') from None
