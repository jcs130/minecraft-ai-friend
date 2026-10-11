"""Read-only mixed-login deployment checks; never reads/prints a password or logs in."""
import json
import tomllib
from urllib.request import urlopen
from society_lab import DEFAULT_ROOT
from mixed_auth_support import verify, NAME


def probe(root=DEFAULT_ROOT):
    checks = {}
    result = {'scope': 'mixed_login', 'checks': checks, 'worldActions': 0, 'modelRequests': 0}
    try:
        verify(root/'server/mods'/NAME); checks['pinned_auth_mod'] = True
        config = tomllib.loads((root/'server/world-life/serverconfig/mixauth-server.toml').read_text('utf-8'))
        checks['no_shared_ip_bypass'] = config['offline_login']['trusted_login_window_hours'] == 0
        checks['password_policy'] = config['offline_login']['min_password_length'] >= 8 and config['offline_login']['bcrypt_cost'] >= 12
        checks['private_auth_database'] = (root/'server/mixauth/mixauth.mv.db').is_file()
        checks['worker_credential_present'] = (root/'agents/maw-explorer/game-login.json').is_file()
        state = json.loads((root/'agents/maw-explorer/state.json').read_text('utf-8'))
        checks['resident_worker_authenticated'] = state.get('online') is True and state.get('authentication', {}).get('phase') == 'authenticated'
        with urlopen('http://127.0.0.1:28985/healthz', timeout=5) as response: main = json.load(response)
        checks['main_supervisor_healthy'] = main['healthy'] and not main['paused']
        with urlopen('http://127.0.0.1:28989/healthz', timeout=5) as response: numen = json.load(response)
        checks['server_resident_numen_ready'] = numen['serverResident'] and numen['ok']
    except Exception as error:
        result['error'] = type(error).__name__ + ': ' + str(error)
    result['ok'] = len(checks) == 8 and all(checks.values())
    return result


if __name__ == '__main__':
    value = probe(); print(json.dumps(value, ensure_ascii=False, indent=2)); raise SystemExit(0 if value['ok'] else 1)
