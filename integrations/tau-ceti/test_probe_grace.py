import unittest
from probe_grace import ProbeGrace


class ProbeGraceTests(unittest.TestCase):
    def test_startup_never_claims_a_successful_probe(self):
        policy=ProbeGrace()
        self.assertFalse(policy.transient(1))
        self.assertFalse(policy.transient(100))

    def test_grace_ends_at_the_original_success_deadline(self):
        policy=ProbeGrace();policy.success(10)
        self.assertTrue(policy.transient(11))
        self.assertTrue(policy.transient(39.99))
        self.assertFalse(policy.transient(40))
        self.assertFalse(policy.transient(50))
        self.assertEqual(policy.last_success,10)

    def test_recovery_and_new_process_are_independent(self):
        policy=ProbeGrace();policy.success(10);policy.transient(12)
        policy.success(20);self.assertEqual(policy.failures,0)
        self.assertTrue(policy.transient(49))
        policy.reset();self.assertFalse(policy.transient(50))


if __name__=='__main__':unittest.main()
