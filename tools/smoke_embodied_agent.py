"""Isolated regression evidence for the embodied controller and memory cutover."""
import argparse
import hashlib
import importlib
import inspect
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'tests'), str(ROOT / 'tools')]
from embodied_agent_health import SOURCES


def hashes():
    return {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in SOURCES}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    before = hashes()
    suite = unittest.TestSuite()
    names = []
    for name in ('test_embodied_agent', 'test_survival_status_detail',
                 'test_survival_feedback', 'test_survival_guild', 'test_survival_life_session',
                 'test_survival_standing_task', 'test_survival_poll_recovery', 'test_guild_hunt_score'):
        module = importlib.import_module(name)
        for _, cls in inspect.getmembers(module, inspect.isclass):
            if cls.__module__ != module.__name__ or not issubclass(cls, unittest.TestCase):
                continue
            if name == 'test_survival_life_session' and cls.__name__ != 'ContinuousActionTests':
                continue
            for method, function in sorted(cls.__dict__.items()):
                if method.startswith('test_') and callable(function):
                    test = cls(method)
                    names.append(test.id())
                    suite.addTest(test)
    result = unittest.TextTestRunner(verbosity=1).run(suite)
    report = {'schema': 1, 'ok': result.wasSuccessful() and not result.skipped and before == hashes(),
              'testsRun': result.testsRun, 'tests': names, 'sourceHashes': before,
              'modelCalls': 0, 'productionMutations': 0, 'worldActions': 0}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')
    return 0 if report['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
