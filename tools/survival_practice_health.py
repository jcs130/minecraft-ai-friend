"""Read-only readiness and isolated evidence for the original survival practice ledger."""
from __future__ import annotations

import ast
import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
REPORT = 'reports/survival-practice-smoke.json'
TOOL = 'tools/smoke_survival_practice.py'
LIVE_SOURCES = (
    'world/survival/controller.py',
    'world/survival/mcp_server.py',
    'world/survival/practice.py',
    'world/survival/skill_library.py',
)
TEST_SOURCES = ('tests/test_survival_practice.py', 'tests/test_survival_practice_integration.py')
SOURCES = LIVE_SOURCES + (
    'world/survival/fast_execution.py',
    *TEST_SOURCES,
    'tools/survival_practice_health.py',
    'tests/test_survival_practice_health.py',
    TOOL,
)
REQUIRED_CHECKS = (
    'idempotent_run_storage', 'exact_step_receipts', 'unknown_not_success',
    'objective_immutable', 'observed_not_mastered', 'versioned_refinement',
    'original_loop_integration', 'read_only_health',
)
COUNTS = ('runCount', 'stepCount', 'receiptCount', 'refinementCount')
MAX_COUNT = 2**63 - 1


def _file(root, name, limit=4194304):
    if not isinstance(name, str) or not re.fullmatch(r'[A-Za-z0-9_./-]+', name):
        raise ValueError('invalid_practice_evidence_path')
    root, supplied = Path(root).resolve(), Path(name)
    target = root / supplied
    if (supplied.is_absolute() or '..' in supplied.parts
            or not target.resolve().is_relative_to(root)
            or any(path.is_symlink() or getattr(path, 'is_junction', lambda: False)()
                   for path in (target, *target.parents))
            or not target.is_file() or target.stat().st_size > limit):
        raise ValueError('invalid_practice_evidence_path')
    return target


def _digest(root, name):
    return hashlib.sha256(_file(root, name).read_bytes()).hexdigest()


def _hashes_match(root, hashes, required, *, exact=False):
    return (isinstance(hashes, dict) and len(required) <= len(hashes) <= 64
            and (set(hashes) == set(required) if exact else set(required) <= set(hashes))
            and all(isinstance(digest, str) and re.fullmatch('[a-f0-9]{64}', digest)
                    and _digest(root, name) == digest for name, digest in hashes.items()))


def adapter_health():
    """One fixed GET in the existing survivor container, without credentials or SQLite access."""
    script = (
        "import json,urllib.request; "
        "r=urllib.request.build_opener(urllib.request.ProxyHandler({})).open("
        "'http://127.0.0.1:8089/healthz',timeout=5); "
        "raw=r.read(16385); assert len(raw)<=16384; "
        "print(json.dumps(json.loads(raw),ensure_ascii=True))"
    )
    result = subprocess.run(
        ['docker', 'exec', 'qiandengji-survivor-1', 'python', '-c', script],
        capture_output=True, text=True, encoding='utf8', errors='replace', timeout=12,
        creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
    )
    if result.returncode != 0 or len(result.stdout.encode('utf8')) > 16384:
        raise ValueError('survival_practice_adapter_unavailable')
    value = json.loads(result.stdout)
    if not isinstance(value, dict):
        raise ValueError('survival_practice_adapter_shape')
    return value


def check(root=ROOT, fetch=adapter_health):
    """Zero runs can be healthy; aggregate rows never establish completed practice or mastery."""
    checks = dict.fromkeys(('adapter_ready', 'practice_available', 'protocol', 'valid_counts',
                            'public_projection', 'current_runtime_sources'), False)
    counts = dict.fromkeys(COUNTS)
    try:
        value = fetch()
        checks['adapter_ready'] = isinstance(value, dict) and value.get('ok') is True
        practice = value.get('practice') if isinstance(value, dict) else None
        if not isinstance(practice, dict):
            raise ValueError('survival_practice_projection_unavailable')
        checks['practice_available'] = practice.get('available') is True
        checks['protocol'] = type(practice.get('schema')) is int and practice['schema'] == 1
        checks['valid_counts'] = all(type(practice.get(key)) is int and 0 <= practice[key] <= MAX_COUNT
                                     for key in COUNTS)
        if checks['valid_counts']:
            counts = {key: practice[key] for key in COUNTS}
        checks['public_projection'] = set(practice) == {'available', 'schema', *COUNTS}
        checks['current_runtime_sources'] = _hashes_match(root, value.get('sources'), LIVE_SOURCES, exact=True)
    except (OSError, ValueError, TypeError, KeyError, subprocess.SubprocessError) as error:
        error_type = type(error).__name__
    else:
        error_type = None
    return {'ok': all(checks.values()), 'state': 'ready' if all(checks.values()) else 'unavailable',
            'checks': checks, 'counts': counts, 'errorType': error_type,
            'modelCalls': 0, 'worldActions': 0,
            'supervisedBy': 'Existing survivor Docker service; no extra process',
            'scope': 'Readiness and aggregate ledger counts only; neither a completed practice run '
                     'nor an improved skill is established.'}


def _declared_tests(root):
    """Inspect local test declarations without importing or executing their code."""
    names = set()
    for source in TEST_SOURCES:
        module = Path(source).stem
        tree = ast.parse(_file(root, source).read_text('utf8'))
        for cls in tree.body:
            if not isinstance(cls, ast.ClassDef):
                continue
            for method in cls.body:
                if isinstance(method, (ast.FunctionDef, ast.AsyncFunctionDef)) and method.name.startswith('test_'):
                    names.add(module + '.' + cls.name + '.' + method.name)
    return names


def _execution_matches(root, report):
    execution, mapping = report.get('execution'), report.get('checkTests')
    if (not isinstance(execution, dict) or execution.get('runner') != 'unittest'
            or execution.get('caseSelection') != 'declared_methods_only'
            or type(execution.get('testsRun')) is not int or not 1 <= execution['testsRun'] <= 512
            or not isinstance(mapping, dict) or set(mapping) != set(REQUIRED_CHECKS)):
        return False
    cases = execution.get('tests')
    if not isinstance(cases, list) or len(cases) != execution['testsRun']:
        return False
    ids = []
    for case in cases:
        if (not isinstance(case, dict) or not isinstance(case.get('id'), str)
                or case.get('outcome') != 'passed'):
            return False
        ids.append(case['id'])
    executed = set(ids)
    if len(executed) != len(ids) or not executed <= _declared_tests(root):
        return False
    return all(isinstance(ids, list) and 1 <= len(ids) <= 512
               and all(isinstance(test, str) and test in executed for test in ids)
               and len(set(ids)) == len(ids) for ids in mapping.values())


def behavior(root=ROOT):
    """Validate this feature's separate actual test report without writing or rerunning anything."""
    checks = dict.fromkeys(('isolated_report', 'zero_external_effects', 'required_behavior',
                            'recorded_test_execution', 'current_sources', 'current_smoke_tool'), False)
    try:
        report = json.loads(_file(root, REPORT, 1048576).read_text('utf-8-sig'))
        if not isinstance(report, dict):
            raise ValueError('invalid_practice_report')
        checks['isolated_report'] = (type(report.get('schema')) is int and report['schema'] == 1
            and report.get('kind') == 'isolated_survival_practice' and report.get('ok') is True
            and report.get('sourceUnchangedDuringRun') is True)
        checks['zero_external_effects'] = all(type(report.get(key)) is int and report[key] == 0
            for key in ('modelCalls', 'worldActions', 'productionMutations'))
        rows = report.get('checks')
        checks['required_behavior'] = isinstance(rows, dict) and all(rows.get(name) is True for name in REQUIRED_CHECKS)
        checks['recorded_test_execution'] = _execution_matches(root, report)
        checks['current_sources'] = _hashes_match(root, report.get('sourceHashes'), SOURCES)
        checks['current_smoke_tool'] = (isinstance(report.get('toolSha256'), str)
            and re.fullmatch('[a-f0-9]{64}', report['toolSha256']) is not None
            and report['toolSha256'] == _digest(root, TOOL))
    except (OSError, ValueError, TypeError, KeyError, AttributeError, SyntaxError):
        pass
    return {'ok': all(checks.values()), 'checks': checks, 'report': REPORT,
            'modelCalls': 0, 'worldActions': 0,
            'scope': 'Separate isolated practice-ledger tests against current sources; '
                     'not evidence of a production game goal, mastered skill or autonomous improvement.'}


if __name__ == '__main__':
    result = check()
    print(json.dumps(result, ensure_ascii=True))
    raise SystemExit(0 if result['ok'] else 1)
