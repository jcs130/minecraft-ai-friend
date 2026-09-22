"""Fixed offline checks for the engineering candidate; no game or model calls."""
import argparse
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
TEAM_PREFIXES = ('test_world_team', 'test_world_content', 'test_world_admin',
                 'test_world_health', 'test_world_epoch_tracking', 'test_world_npc_health_probe_contract')
EMBODIED_MODULES = ('test_embodied_agent', 'test_behavior_context', 'test_survival_practice',
                    'test_survival_practice_integration', 'test_survival_native_tools',
                    'test_survival_fast_execution', 'test_execution_evidence', 'test_survival_status_detail')
# Imports provide real controller fixtures, even when their own suites are not selected.
FIXTURES = ('test_survival_life_session', 'test_survival_controller', 'test_survival_gateway')
EXCLUDED = {'test_execution_evidence.AuditTests.test_panel_renders_unknown_and_legacy_schema_honestly':
            'Independent Node UI check is outside this Python engineering plan.'}


def modules(root=ROOT, suite='combined'):
    team = sorted(path.stem for path in (root / 'tests').glob('test_*.py')
                  if path.stem.startswith(TEAM_PREFIXES))
    if not team:
        raise ValueError('engineering_team_checks_missing')
    names = team + (list(EMBODIED_MODULES) if suite == 'combined' else [])
    if any(not (root / 'tests' / (name + '.py')).is_file() for name in names):
        raise ValueError('engineering_fixed_check_missing')
    return names


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--suite', choices=('team', 'combined'), default='combined')
    args = parser.parse_args()
    sys.path.insert(0, str(ROOT / 'tests'))
    names = modules(suite=args.suite)
    suite = unittest.defaultTestLoader.loadTestsFromNames(names)
    def selected(item):
        if isinstance(item, unittest.TestSuite):
            return unittest.TestSuite(selected(child) for child in item)
        if item.id() in EXCLUDED:
            print('Excluded '+item.id()+': '+EXCLUDED[item.id()], file=sys.stderr)
            return unittest.TestSuite()
        return item
    suite = selected(suite)
    if suite.countTestCases() == 0:
        raise ValueError('engineering_no_checks_discovered')
    result = unittest.TextTestRunner(verbosity=1).run(suite)
    return 0 if result.wasSuccessful() else 1


if __name__ == '__main__':
    raise SystemExit(main())
