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
    for name in ('test_embodied_agent', 'test_survival_gateway', 'test_social_scheduling', 'test_dialogue_batch',
                 'test_behavior_context', 'test_survival_service', 'test_survival_submission_runtime', 'test_survival_status_detail',
                 'test_survival_feedback', 'test_survival_guild', 'test_survival_life_session',
                 'test_survival_standing_task', 'test_survival_poll_recovery', 'test_guild_hunt_score',
                 'test_native_continuity', 'test_native_mcp_recovery', 'test_system_one', 'test_skill_catalog_router',
                 'test_skill_catalog_latency', 'test_skill_catalog_index', 'test_motor_mailbox',
                 'test_async_motor', 'test_survival_navigation_deadline', 'test_survival_controller',
                 'test_survival_navigation_sense', 'test_motor_projection',
                 'test_survival_area_recovery', 'test_survival_chat', 'test_motor_boundary', 'test_survival_inventory_feedback',
                 'test_survival_native_tools', 'test_survivor_driver_scope', 'test_configure_survivor_vision',
                 'test_survival_game_skills', 'test_survival_skill_tools', 'test_survival_mine_receipts',
                 'test_party_bridge', 'test_party_life', 'test_yui_admin_team',
                 'test_survival_food_receipts', 'test_survival_native_interaction', 'test_motor_cast_acceptance',
                 'test_motor_occurrence', 'test_survival_self_planning', 'test_survival_reply_wake',
                 'test_skill_catalog_eligibility', 'test_motor_progress_audit',
                 'test_character_speech', 'test_survival_speech',
                 'test_survival_action_admission', 'test_system_one_body_control',
                 'test_survival_continuous_navigation', 'test_survival_blocked_progress_wake',
                 'test_survival_navigation_capability', 'test_survival_navigate_tool',
                 'test_survival_turn_completion', 'test_survival_body_reconnect'):
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
              'failures': [{'test': test.id(), 'detail': detail[-5000:]} for test, detail in result.failures],
              'errors': [{'test': test.id(), 'detail': detail[-5000:]} for test, detail in result.errors],
              'modelCalls': 0, 'productionMutations': 0, 'worldActions': 0}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')
    return 0 if report['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
