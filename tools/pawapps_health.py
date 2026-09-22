"""Read-only native PawApp readiness and source-bound browser evidence."""
import hashlib
import json
import math
from pathlib import Path, PurePosixPath
import re
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
APP_IDS = ('evolution-board', 'gods-eye')
REPORT = 'reports/pawapps-smoke.json'
SOURCES = ('world/ops/evolution_policy.py', 'world/ops/pawapp_bridge.py',
           'world/ops/install_pawapps.py', 'world/ops/pawapp_assets/evolution-board.html',
           'world/survival/coherence.py', 'world/survival/execution_evidence.py',
           'tools/pawapps_health.py', 'tests/test_pawapps_health.py')
REQUIRED_CHECKS = ('pawapps-native-discovery', 'pawapps-sdk-pages',
                   'evolution-board-live-data', 'evolution-board-current-roles',
                   'evolution-board-unknown-preserved', 'gods-eye-embedded-view',
                   'pawapps-no-browser-errors')
PATHS = ('/api/pawapps', *(f'/api/frontend_plugin/{app}/files/ui/index.js' for app in APP_IDS),
         '/api/evolution-board/board')
MAX_BYTES = 2 * 1024 * 1024
# Coherence publishes every 300 seconds; allow one minute for scheduling drift.
METRICS_MAX_AGE_SECONDS = 360


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def native_get(path):
    if path not in PATHS:
        raise ValueError('unsupported_pawapp_health_path')
    request = urllib.request.Request('http://127.0.0.1:18089' + path,
        method='GET', headers={'X-Agent-Id': 'qd-survivor'})
    with urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect()).open(
            request, timeout=15 if path == PATHS[-1] else 5) as response:
        raw = response.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise ValueError('pawapp_response_too_large')
    return raw


def _json(raw):
    def invalid_constant(value):
        raise ValueError('nonfinite_json')
    return json.loads(raw, parse_constant=invalid_constant)


def _file(root, name):
    path = root / name
    if (not path.resolve().is_relative_to(root.resolve()) or path.is_symlink()
            or any(p.is_symlink() for p in path.parents) or path.stat().st_size > MAX_BYTES):
        raise ValueError('invalid_pawapp_evidence_file')
    return path.read_bytes()


def _fresh(value, now):
    return (type(value) in (int, float) and math.isfinite(value)
            and type(now) in (int, float) and math.isfinite(now)
            and 0 <= now - value <= METRICS_MAX_AGE_SECONDS)


def _roles(config, root):
    profiles = config['agents']['profiles']
    if not isinstance(profiles, dict):
        raise ValueError('invalid_project_profiles')
    expected = set()
    for role, profile in profiles.items():
        if (not isinstance(profile, dict) or profile.get('enabled') is not True
                or role == 'default' or role.startswith('QwenPaw_QA_')
                or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', role)):
            continue
        folder = profile.get('workspace_dir')
        if not isinstance(folder, str):
            continue
        if (PurePosixPath(folder).as_posix() == '/state/work/workspaces/' + role
                or Path(folder).resolve() == (root/'server/agents/work/workspaces'/role).resolve()):
            expected.add(role)
    if not expected:
        raise ValueError('empty_project_profiles')
    return expected


def _nulls_preserved(source, projection):
    """Only compare unavailable values, not mutable counts from another read instant."""
    if source is None:
        return projection is None
    if isinstance(source, dict):
        return (isinstance(projection, dict) and all(k in projection and _nulls_preserved(v, projection[k])
                for k, v in source.items()))
    if isinstance(source, list):
        # Trend buckets may roll between the HTTP and local file reads.
        return isinstance(projection, list)
    return True


def behavior(root=ROOT):
    root = Path(root)
    checks = {'recorded_ui': False, 'current_sources': False}
    try:
        report = _json(_file(root, REPORT))
        rows = report.get('checks')
        checks['recorded_ui'] = (type(report.get('schema')) is int and report['schema'] == 1
            and report.get('ok') is True and type(report.get('modelCalls')) is int and report['modelCalls'] == 0
            and type(report.get('worldActions')) is int and report['worldActions'] == 0
            and isinstance(rows, list) and len(rows) == len(REQUIRED_CHECKS)
            and all(isinstance(r, dict) and r.get('ok') is True for r in rows)
            and {r.get('name') for r in rows} == set(REQUIRED_CHECKS))
        hashes = report.get('sourceHashes')
        checks['current_sources'] = (isinstance(hashes, dict) and set(hashes) == set(SOURCES)
            and all(hashes[name] == hashlib.sha256(_file(root, name)).hexdigest() for name in SOURCES))
    except (OSError, ValueError, TypeError, KeyError, AttributeError):
        pass
    return {'ok': all(checks.values()), 'checks': checks, 'report': REPORT}


def check(root=ROOT, fetch=native_get, clock=time.time):
    root = Path(root)
    checks = dict.fromkeys(('native_discovery', 'sdk_pages', 'board_schema', 'current_generation',
                           'fresh_metrics', 'runtime_visible', 'current_roles', 'unknown_preserved'), False)
    errors = {}
    runtime = None
    role_count = None
    def get(path):
        raw = fetch(path)
        if not isinstance(raw, bytes) or len(raw) > MAX_BYTES:
            raise ValueError('invalid_native_pawapp_response')
        return raw
    try:
        apps = _json(get(PATHS[0]))['apps']
        checks['native_discovery'] = (isinstance(apps, list)
            and all(len([a for a in apps if isinstance(a, dict) and a.get('id') == app]) == 1
                and next(a for a in apps if isinstance(a, dict) and a.get('id') == app).get('entry_page') == '/apps/' + app
                and next(a for a in apps if isinstance(a, dict) and a.get('id') == app).get('status') == 'installed'
                for app in APP_IDS))
    except (OSError, ValueError, TypeError, KeyError, AttributeError) as error:
        errors['native_discovery'] = type(error).__name__
    sdk = []
    for app in APP_IDS:
        try:
            text = get(f'/api/frontend_plugin/{app}/files/ui/index.js').decode('utf8')
            config = re.search(r'const config = (\{[^\n]+\});', text)
            sdk.append(bool(config and _json(config.group(1)).get('id') == app
                and 'host.paw.forApp(config.id).ui.registerPage(' in text
                and 'const path = "/apps/" + config.id;' in text))
        except (OSError, ValueError, TypeError, KeyError, AttributeError) as error:
            sdk.append(False); errors['sdk:' + app] = type(error).__name__
    checks['sdk_pages'] = all(sdk)
    try:
        board = _json(get(PATHS[-1]))
        metrics = board['metrics']['survival']
        local = _json(_file(root, 'server/panel-state/survival-metrics.json'))
        settings = _json(_file(root, 'server/survival-agent-state/survival/settings.json'))
        config = _json(_file(root, 'server/agents/work/config.json'))
        checks['board_schema'] = (type(board.get('schema')) is int and board['schema'] == 2
            and type(metrics.get('schema')) is int and metrics['schema'] == 2)
        epoch = settings.get('memoryEpoch'); generation = metrics.get('generation') or {}
        checks['current_generation'] = (isinstance(epoch, str) and bool(epoch)
            and generation.get('status') == 'current' and generation.get('memoryEpoch') == epoch
            and (local.get('generation') or {}).get('memoryEpoch') == epoch)
        now = clock()
        checks['fresh_metrics'] = _fresh(board.get('generatedAt'), now) and _fresh(metrics.get('at'), now)
        run = metrics.get('runtime')
        checks['runtime_visible'] = (isinstance(run, dict) and isinstance(run.get('status'), str)
            and bool(run['status']) and 'pauseReason' in run)
        if checks['runtime_visible']:
            runtime = {k:run.get(k) for k in ('status', 'pauseReason', 'enabled')}
        roles = board.get('roles'); expected = _roles(config, root)
        checks['current_roles'] = (isinstance(roles, list) and len(roles) == len(expected)
            and all(isinstance(r, dict) and isinstance(r.get('role'), str) for r in roles)
            and {r['role'] for r in roles} == expected)
        role_count = len(expected)
        fields = ('generation', 'runtime', 'evidence', 'closedLoop', 'repeats',
                  'decisionGaps', 'stalledGoals', 'noOutputSignals', 'noActionReviews')
        checks['unknown_preserved'] = all(k in metrics and _nulls_preserved(local[k], metrics[k])
            for k in fields if k in local)
        # No receipts or incomplete coverage cannot become a zero success rate.
        closed = metrics.get('closedLoop') or {}
        if closed.get('sampled') == 0 or (metrics.get('evidence') or {}).get('errors'):
            checks['unknown_preserved'] &= 'rate' in closed and closed['rate'] is None
    except (OSError, ValueError, TypeError, KeyError, AttributeError) as error:
        errors['board'] = type(error).__name__
    proof = behavior(root)
    return {'ok': all(checks.values()) and proof['ok'], 'checks': checks, 'behavior': proof,
            'runtime': runtime, 'expectedRoleCount': role_count, 'errors': errors,
            'modelCalls': 0, 'worldActions': 0,
            'scope': 'Native PawApp pages and fresh current-generation evidence; a displayed pause is valid, '
                     'and readiness does not establish game-goal success or RSI benefit.'}


if __name__ == '__main__':
    result = check()
    print(json.dumps(result, ensure_ascii=False))
    raise SystemExit(0 if result['ok'] else 1)
