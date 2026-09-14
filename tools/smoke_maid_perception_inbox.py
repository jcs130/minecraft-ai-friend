"""Run declared inbox fixture tests and publish separate, attributable evidence.

No production services are contacted. The suite uses temporary SQLite files,
fake Qwen transports and its own loopback HTTP server. Java/game delivery is
deliberately outside this report. Use Python -X utf8 on Windows.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import importlib
import io
import json
from pathlib import Path
import sys
import time
import unittest

from maid_perception_health import BEHAVIOR_TESTS, REPORT, REQUIRED_SOURCES

ROOT = Path(__file__).resolve().parents[1]
TEST_CLASSES = ('InboxTests', 'SignedQueueTests', 'PerceptionLifeTests')
SOURCES = tuple(dict.fromkeys((*REQUIRED_SOURCES,
    'tests/test_party_life.py', 'tests/test_maid_perception_health.py',
    'world/sidecar/maid_identity.py', 'world/sidecar/maid_registry.py',
    'world/sidecar/qwen_tasks.py', 'world/sidecar/party_messages.py',
    'world/sidecar/party_config.py', 'world/sidecar/party_world.py',
    'world/ops/party_life_schedule.py', 'world/ops/party_role_capabilities.py',
    'world/ops/health/health_mon.py')))


def source_hashes():
    return {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in SOURCES}


class RecordedResult(unittest.TextTestResult):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.rows, self.started = {}, {}

    def startTest(self, test):
        self.started[test.id()] = time.perf_counter()
        self.rows[test.id()] = {'id': test.id(), 'outcome': 'running'}
        super().startTest(test)

    def stopTest(self, test):
        self.rows[test.id()]['elapsedSeconds'] = round(time.perf_counter() - self.started[test.id()], 6)
        super().stopTest(test)

    def addSuccess(self, test):
        self.rows[test.id()]['outcome'] = 'passed'
        super().addSuccess(test)

    def addError(self, test, error):
        self.rows[test.id()].update(outcome='error', errorType=error[0].__name__)
        super().addError(test, error)

    def addFailure(self, test, error):
        self.rows[test.id()].update(outcome='failed', errorType=error[0].__name__)
        super().addFailure(test, error)

    def addSkip(self, test, reason):
        self.rows[test.id()]['outcome'] = 'skipped'
        super().addSkip(test, reason)

    def addExpectedFailure(self, test, error):
        self.rows[test.id()]['outcome'] = 'expected_failure'
        super().addExpectedFailure(test, error)

    def addUnexpectedSuccess(self, test):
        self.rows[test.id()]['outcome'] = 'unexpected_success'
        super().addUnexpectedSuccess(test)

    def addSubTest(self, test, subtest, error):
        if error is not None:
            self.rows[test.id()].update(outcome='failed_subtest', errorType=error[0].__name__)
        super().addSubTest(test, subtest, error)


def run_suite():
    started = datetime.now(timezone.utc).isoformat()
    before = source_hashes()
    sys.path[:0] = [str(ROOT / 'tests'), str(ROOT / 'world/sidecar'), str(ROOT / 'world/ops')]
    tests = importlib.import_module('test_maid_perception_inbox')
    declared = {}
    for name in TEST_CLASSES:
        cls = getattr(tests, name)
        # Inherited PartyLife regressions remain useful but are not counted as
        # newly exercised inbox cases in this report.
        for method, value in sorted(cls.__dict__.items()):
            if method.startswith('test_') and callable(value):
                case = cls(method)
                declared[case.id()] = case
    required = {name for names in BEHAVIOR_TESTS.values() for name in names}
    if not required <= set(declared):
        raise ValueError('required_declared_inbox_tests_missing: ' + ', '.join(sorted(required - set(declared))))
    stream = io.StringIO()
    result = unittest.TextTestRunner(stream=stream, verbosity=2, resultclass=RecordedResult).run(
        unittest.TestSuite(declared.values()))
    checks = {name: all(result.rows.get(test, {}).get('outcome') == 'passed' for test in names)
              for name, names in BEHAVIOR_TESTS.items()}
    after = source_hashes()
    source_unchanged = before == after
    passed = (result.wasSuccessful() and result.testsRun == len(declared)
              and all(row.get('outcome') == 'passed' for row in result.rows.values()))
    report = {'schema': 1, 'kind': 'isolated_maid_perception_inbox',
        'ok': passed and all(checks.values()) and source_unchanged,
        'startedAt': started, 'finishedAt': datetime.now(timezone.utc).isoformat(),
        'modelCalls': 0, 'worldActions': 0, 'productionMutations': 0,
        'checks': checks, 'checkTests': {name: list(names) for name, names in BEHAVIOR_TESTS.items()},
        'sourceHashes': before, 'sourceUnchangedDuringRun': source_unchanged,
        'execution': {'runner': 'unittest', 'caseSelection': 'declared_methods_only',
            'testsRun': result.testsRun, 'tests': list(result.rows.values()),
            'fixtureState': 'temporary_directories', 'qwenTransport': 'fake',
            'http': 'suite_owned_loopback_server', 'javaExecuted': False,
            'inGameDeliveryVerified': False},
        'scope': 'Actual isolated Python inbox and adapter tests; no inherited old cases counted, '
                 'no Java runtime or live player speech asserted.'}
    if not source_unchanged:
        report['sourceHashesAfter'] = after
    return report, stream.getvalue()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--publish', action='store_true', help='Publish only a successful new report; archive prior bytes.')
    args = parser.parse_args()
    if sys.platform == 'win32' and not sys.flags.utf8_mode:
        raise SystemExit('Run with Python -X utf8 so existing fixture reads preserve Chinese text.')
    report, log = run_suite()
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    folder = ROOT / 'runtime/maid-dialogue-queue-20260914/smoke' / stamp
    folder.mkdir(parents=True, exist_ok=False)
    raw = (json.dumps(report, ensure_ascii=False, indent=2) + '\n').encode('utf8')
    (folder / 'report.json').write_bytes(raw)
    (folder / 'unittest.txt').write_text(log, 'utf8')
    published = False
    if args.publish and report['ok']:
        target = ROOT / REPORT
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.is_symlink():
            raise ValueError('linked_inbox_report')
        if target.exists():
            old = target.read_bytes()
            (folder / 'previous-report.json').write_bytes(old)
            if (folder / 'previous-report.json').read_bytes() != old:
                raise ValueError('inbox_report_archive_mismatch')
        temporary = folder / 'publish.json'
        temporary.write_bytes(raw)
        temporary.replace(target)
        published = True
    print(json.dumps({'ok': report['ok'], 'testsRun': report['execution']['testsRun'],
        'checks': report['checks'], 'sourceUnchangedDuringRun': report['sourceUnchangedDuringRun'],
        'report': str(folder / 'report.json'), 'published': published,
        'modelCalls': 0, 'worldActions': 0, 'productionMutations': 0}, ensure_ascii=True))
    return 0 if report['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
