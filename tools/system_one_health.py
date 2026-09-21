"""Read provider readiness from the deployed body's actual configuration; no inference."""
import json
import subprocess


def check():
    try:
        reply = subprocess.run(['docker', 'exec', 'qiandengji-survivor-1', 'python',
            '/survival/system_one.py', '--health'], capture_output=True, text=True,
            encoding='utf8', timeout=12, check=False)
        if len(reply.stdout) > 8192:
            raise ValueError('oversized_health')
        result = json.loads(reply.stdout)
        if not isinstance(result, dict) or result.get('modelCalls') != 0 or result.get('worldActions') != 0:
            raise ValueError('invalid_health')
        result['ok'] = reply.returncode == 0 and result.get('ok') is True
        return result
    except (OSError, ValueError, TypeError, subprocess.SubprocessError):
        return {'ok': False, 'error': 'policy_readiness_unavailable', 'modelCalls': 0, 'worldActions': 0}
