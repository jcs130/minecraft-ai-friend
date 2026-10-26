import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('evolution', Path(__file__).with_name('goddess-evolution.py'))
g = importlib.util.module_from_spec(spec); spec.loader.exec_module(g)


class EvolutionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.ledger = g.Ledger(self.root / 'state')
        self.proof = self.root / 'proof.json'
        self.proof.write_text('{"actual":"fixture"}')

    def tearDown(self):
        self.tmp.cleanup()

    def req(self, phase='planned', revision=0):
        return {'request_id': f'test-{revision}', 'project_id': 'npc-path', 'category': 'npc',
                'phase': phase, 'expected_revision': revision, 'title': '村民通行', 'next_action': '核查原实体',
                'evidence': [{'path': str(self.proof), 'sha256': g.digest(self.proof.read_bytes())}]}

    def test_same_id_dedup_and_conflict(self):
        req = self.req(); self.ledger.submit(req)
        self.assertTrue(self.ledger.submit(req)['replayed'])
        self.assertEqual(self.ledger.read()['revision'], 1)
        with self.assertRaises(g.Conflict): self.ledger.submit(dict(req, title='changed'))

    def test_revision_conflict_preserves_state(self):
        self.ledger.submit(self.req())
        before = self.ledger.path.read_bytes()
        with self.assertRaises(g.Conflict): self.ledger.submit(dict(self.req('surveyed'), request_id='other'))
        self.assertEqual(before, self.ledger.path.read_bytes())

    def test_cannot_claim_plan_as_completed(self):
        with self.assertRaises(ValueError): self.ledger.submit(self.req('verified'))
        self.ledger.submit(self.req())
        with self.assertRaises(ValueError): self.ledger.submit(self.req('verified', 1))

    def test_evidence_hash_checked(self):
        req = self.req(); self.proof.write_text('changed')
        with self.assertRaises(g.Conflict): self.ledger.submit(req)

    def test_phase_needs_receipt(self):
        self.ledger.submit(self.req())
        with self.assertRaises(ValueError): self.ledger.submit(dict(self.req('surveyed', 1), evidence=[]))

    def test_verified_requires_real_check_fields(self):
        for rev, phase in enumerate(['planned', 'surveyed', 'staged', 'applied']): self.ledger.submit(self.req(phase, rev))
        req = self.req('verified', 4)
        with self.assertRaises(ValueError): self.ledger.submit(req)
        req['checks'] = [{'name': 'walk', 'observed_at': g.now(), 'expected': 'reachable', 'actual': 'reachable', 'passed': True, 'evidence_index': 0}]
        out = self.ledger.submit(req)
        self.assertFalse(out['gameExecuted'])
        self.assertIn('not_independent', out['verification'])
        with self.assertRaises(ValueError): self.ledger.submit(dict(self.req('reviewed', 5), checks=req['checks']))
        self.ledger.submit(dict(self.req('reviewed', 5), checks=req['checks'], outcome={'sample': 0, 'uptake': 'not yet observed'}))
        self.assertEqual(len(self.ledger.read()['projects']['npc-path']['history']), 6)

    def test_unknown_not_success_and_requires_reason(self):
        for rev, phase in enumerate(['planned', 'surveyed', 'staged', 'applied']): self.ledger.submit(self.req(phase, rev))
        with self.assertRaises(ValueError): self.ledger.submit(self.req('unknown', 4))
        self.ledger.submit(dict(self.req('unknown', 4), reason='timeout; inspect original action receipt'))
        self.assertEqual(self.ledger.read()['projects']['npc-path']['phase'], 'unknown')

    def test_lease_survives_restart_and_not_stolen(self):
        self.ledger.lease('run-one')
        restarted = g.Ledger(self.ledger.root)
        with self.assertRaises(g.Conflict): restarted.lease('run-two')
        with self.assertRaises(g.Conflict): restarted.lease('run-two', True)
        restarted.lease('run-one', True)
        self.assertEqual(restarted.lease('run-two')['lease']['owner'], 'run-two')

    def test_lock_preserved_if_busy(self):
        self.ledger.root.mkdir(); lock = self.ledger.root / 'ledger.lock'; lock.write_text('someone')
        with self.assertRaises(g.Conflict): self.ledger.submit(self.req())
        self.assertEqual(lock.read_text(), 'someone')

    def test_invalid_inputs_do_not_create_record(self):
        for value in [[], None, "planned"]:
            with self.assertRaises(ValueError): self.ledger.submit(value)
        for changes in [{'project_id': '../x'}, {'expected_revision': True}, {'category': 'anything'}, {'title': ''}]:
            with self.assertRaises(ValueError): self.ledger.submit(dict(self.req(), **changes))
        self.assertEqual(self.ledger.read()['revision'], 0)

    def test_same_phase_update_records_real_progress_without_advancing(self):
        self.ledger.submit(self.req())
        self.ledger.submit(dict(self.req('planned', 1), next_action='核对新的路径候选'))
        self.assertEqual(self.ledger.read()['projects']['npc-path']['phase'], 'planned')
        self.assertEqual(self.ledger.read()['revision'], 2)

    def test_blocked_cannot_skip_unfinished_steps(self):
        self.ledger.submit(self.req())
        self.ledger.submit(dict(self.req('blocked', 1), reason='Need current coordinates'))
        with self.assertRaises(ValueError): self.ledger.submit(self.req('applied', 2))
        with self.assertRaises(ValueError): self.ledger.submit(self.req('surveyed', 2))
        self.ledger.submit(self.req('planned', 2))
        self.ledger.submit(self.req('surveyed', 3))

    def test_uncertain_write_is_recordable_before_claiming_application(self):
        for rev, phase in enumerate(['planned', 'surveyed', 'staged']): self.ledger.submit(self.req(phase, rev))
        self.ledger.submit(dict(self.req('unknown', 3), reason='Original action ID pending; read its receipt'))
        with self.assertRaises(ValueError): self.ledger.submit(self.req('verified', 4))
        self.ledger.submit(dict(self.req('blocked', 4), reason='Service unavailable'))
        with self.assertRaises(ValueError): self.ledger.submit(self.req('applied', 5))
        self.ledger.submit(dict(self.req('unknown', 5), reason='Resume original receipt query'))
        self.ledger.submit(self.req('staged', 6)) # readback proves the write was not applied

    def test_applied_unknown_cannot_be_reset_to_unexecuted(self):
        for rev, phase in enumerate(['planned', 'surveyed', 'staged', 'applied']): self.ledger.submit(self.req(phase, rev))
        self.ledger.submit(dict(self.req('unknown', 4), reason='Post-check uncertain; read current state'))
        with self.assertRaises(ValueError): self.ledger.submit(self.req('staged', 5))
        self.ledger.submit(self.req('applied', 5))

    def test_contract_example_is_accepted_and_read_only(self):
        c = g.contract()
        self.assertEqual(self.ledger.submit(c['minimal_example'])['phase'], 'planned')
        self.assertEqual(c['sideEffects'], 'local_ledger_only')
        self.assertEqual(set(c['transitions']), set(g.PHASES))

    def test_snapshot_fixed_read_commands_and_no_chat_export(self):
        server = self.root / 'server'; (server / 'logs').mkdir(parents=True)
        (server / 'logs/latest.log').write_text('[12:00:00 INFO]: player issued server command: /login secret\n[12:00:01 WARN]: warning\n')
        class Reply:
            returncode = 0; stdout = 'fixture reply'
        with patch.object(g.subprocess, 'run', return_value=Reply()) as run:
            out = g.snapshot(server, self.root, 'node')
        self.assertEqual(run.call_count, len(g.LIVE_READS))
        self.assertEqual([c.args[0][-1] for c in run.call_args_list], g.LIVE_READS)
        self.assertNotIn('secret', json.dumps(out))
        self.assertEqual(out['activity']['counts']['warnings'], 0) # logger fixture is not /WARN format

    def test_snapshot_unknown_not_empty_success(self):
        with patch.object(g.subprocess, 'run', side_effect=g.subprocess.TimeoutExpired('node', 15)):
            out = g.snapshot(self.root, self.root, 'node')
        self.assertFalse(out['complete'])
        self.assertTrue(all(r['status'] == 'unknown' for r in out['reads']))


if __name__ == '__main__': unittest.main()
