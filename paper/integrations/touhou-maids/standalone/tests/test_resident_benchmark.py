"""Inference failures stop bounded QA; partial business progress never means goal success."""
import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('resident_online',Path(__file__).with_name('resident-online-stage.py'))
online=importlib.util.module_from_spec(spec)
spec.loader.exec_module(online)


def outcome(status,reason):
    return {'receipt':{'status':status,'reason':reason}}


class BenchmarkBudget(unittest.TestCase):
    def test_repeated_unavailable_stops_after_three(self):
        failed=outcome('failed','model_unavailable')
        self.assertIsNone(online.repeated_failure([failed,failed]))
        self.assertEqual(online.repeated_failure([failed]*3),'repeated_model_unavailable')

    def test_a_success_resets_failure_streak(self):
        self.assertIsNone(online.repeated_failure([outcome('failed','model_unavailable')]*2+[outcome('completed','observed')]))

    def test_changed_error_requires_separate_diagnosis(self):
        self.assertIsNone(online.repeated_failure([outcome('failed','model_unavailable'),outcome('rejected','invalid_model_action'),outcome('failed','model_unavailable')]))

    def test_business_refusal_is_not_provider_failure(self):
        self.assertIsNone(online.repeated_failure([outcome('blocked','verification_throttled')]*3))


if __name__=='__main__':unittest.main()
