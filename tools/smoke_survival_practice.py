"""Run isolated declared practice tests and record actual per-case evidence.

Intended invocation: a network-disabled disposable survivor image, repository
mounted read-only, and an output directory outside production state.
"""
import argparse
import hashlib
import importlib
import inspect
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
sys.path.insert(0, str(ROOT / 'tests'))
from survival_practice_health import SOURCES, TOOL

P = 'test_survival_practice.PracticeTests.'
I = 'test_survival_practice_integration.PracticeIntegrationTests.'
CHECK_TESTS = {
    'idempotent_run_storage': [P + 'test_deterministic_identity_and_existing_begin_preserve_initial_observation',
                              I + 'test_restart_during_program_retains_run_and_does_not_replay_step'],
    'exact_step_receipts': [P + 'test_wrong_version_body_turn_args_and_action_identity_are_rejected',
                           P + 'test_old_action_id_cannot_be_rebound_to_new_version_new_turn'],
    'unknown_not_success': [P + 'test_pending_unknown_missing_and_observed_end_cannot_claim_success',
                            I + 'test_unknown_action_does_not_become_success_and_never_replays'],
    'objective_immutable': [I + 'test_objective_copied_at_start_and_invalid_value_cannot_consume_lease'],
    'observed_not_mastered': [P + 'test_success_has_independent_objective_and_never_mastery',
                              P + 'test_done_and_existing_inventory_without_actions_are_not_success'],
    'versioned_refinement': [I + 'test_refinement_preserves_parent_version_and_requires_fresh_test'],
    'original_loop_integration': [I + 'test_real_program_runs_in_original_loop_and_next_model_sees_evidence'],
    'read_only_health': [I + 'test_health_route_is_read_only_and_keeps_mcp_authenticated',
                         P + 'test_missing_reads_do_not_create_directory_or_database'],
}


def hashes():
    names = (*SOURCES, 'world/ops/health/health_mon.py', 'world/survival/native_tools.py',
             'tests/test_survival_native_tools.py',
             'world/ops/skills/qd-survivor-practice/SKILL.md',
             'world/ops/skills/qd-survivor-practice/references/program-practice.md')
    return {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in names}


class EvidenceResult(unittest.TextTestResult):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.cases = {}

    def startTest(self, test):
        super().startTest(test)
        self.cases[test.id()] = 'running'

    def addSuccess(self, test):
        super().addSuccess(test)
        self.cases[test.id()] = 'passed'

    def addError(self, test, err):
        super().addError(test, err)
        self.cases[test.id()] = 'error'

    def addFailure(self, test, err):
        super().addFailure(test, err)
        self.cases[test.id()] = 'failed'

    def addSkip(self, test, reason):
        super().addSkip(test, reason)
        self.cases[test.id()] = 'skipped'

    def addSubTest(self, test, subtest, err):
        super().addSubTest(test, subtest, err)
        if err is not None:
            self.cases[test.id()] = 'failed'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    before = hashes()
    suite = unittest.TestSuite()
    for name in ('test_survival_practice', 'test_survival_practice_integration'):
        module = importlib.import_module(name)
        for _, cls in inspect.getmembers(module, inspect.isclass):
            if cls.__module__ != name or not issubclass(cls, unittest.TestCase):
                continue
            for method, function in sorted(cls.__dict__.items()):
                if method.startswith('test_') and callable(function):
                    suite.addTest(cls(method))
    result = unittest.TextTestRunner(verbosity=2, resultclass=EvidenceResult).run(suite)
    checks = {name: all(result.cases.get(test) == 'passed' for test in tests)
              for name, tests in CHECK_TESTS.items()}
    unchanged = before == hashes()
    report = {'schema': 1, 'kind': 'isolated_survival_practice',
              'ok': result.wasSuccessful() and unchanged and all(checks.values()),
              'sourceUnchangedDuringRun': unchanged,
              'modelCalls': 0, 'worldActions': 0, 'productionMutations': 0,
              'checks': checks, 'toolSha256': before[TOOL], 'sourceHashes': before,
              'execution': {'runner': 'unittest', 'caseSelection': 'declared_methods_only',
                            'testsRun': result.testsRun,
                            'tests': [{'id': name, 'outcome': outcome} for name, outcome in result.cases.items()]},
              'checkTests': CHECK_TESTS}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', 'utf8')
    return 0 if report['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
