"""Retirement failure recovery stays bounded; all Docker and report I/O is fake."""
from contextlib import ExitStack
import importlib.util
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch


ROOT=Path(__file__).resolve().parents[1]
with patch.object(sys,'path',[str(ROOT/'tools'),*sys.path]):
    spec=importlib.util.spec_from_file_location('tested_retirement',ROOT/'tools/retire_legacy_consumers.py')
    retire=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(retire)
IDS=list(retire.TARGETS.values())


def observed(ident,state='running'):
    return {'fixture-name':{'Id':ident,'State':{'Status':state}}}


class RetirementRollbackTests(unittest.TestCase):
    def test_first_start_failure_does_not_skip_later_target(self):
        calls=[]
        def start(args,timeout):
            calls.append(args)
            if args[-1]==IDS[0]:raise OSError('PRIVATE_START_DETAIL')
        def inspect(names):return observed(names[0],'exited' if names[0]==IDS[0] else 'running')
        with patch.object(retire,'command',side_effect=start),patch.object(retire,'inspect',side_effect=inspect):
            rows=retire.rollback_stopped(IDS[:2])
        self.assertEqual(calls,[['docker','start',ident] for ident in IDS[:2]])
        self.assertFalse(rows[0]['restored']);self.assertEqual(rows[0]['startErrorType'],'OSError')
        self.assertTrue(rows[1]['restored']);self.assertTrue(rows[1]['startCommandOk'])
        self.assertNotIn('PRIVATE_START_DETAIL',json.dumps(rows))

    def test_every_start_and_verification_failure_is_recorded_without_short_circuit(self):
        with patch.object(retire,'command',side_effect=TimeoutError('PRIVATE_START')) as start, \
             patch.object(retire,'inspect',side_effect=OSError('PRIVATE_INSPECT')) as inspect:
            rows=retire.rollback_stopped(IDS)
        self.assertEqual(start.call_count,3);self.assertEqual(inspect.call_count,3)
        for row in rows:
            self.assertTrue(row['attempted']);self.assertFalse(row['restored'])
            self.assertFalse(row['stateVerified']);self.assertEqual(row['finalState'],'unknown')
            self.assertEqual(row['startErrorType'],'TimeoutError');self.assertEqual(row['verifyErrorType'],'OSError')
        self.assertNotIn('PRIVATE_',json.dumps(rows))

    def test_unacknowledged_start_can_be_observed_restored_without_hiding_error(self):
        with patch.object(retire,'command',side_effect=TimeoutError('ack lost')), \
             patch.object(retire,'inspect',return_value=observed(IDS[0])):
            row=retire.rollback_stopped(IDS[:1])[0]
        self.assertFalse(row['startCommandOk']);self.assertEqual(row['startErrorType'],'TimeoutError')
        self.assertTrue(row['stateVerified']);self.assertTrue(row['restored'])

    def test_successful_start_is_not_recovery_when_container_exited_or_identity_unknown(self):
        samples=[observed(IDS[0],'exited'),observed('different-id'),observed(IDS[0],'not-a-state')]
        with patch.object(retire,'command',return_value=''):
            for sample in samples:
                with self.subTest(sample=sample),patch.object(retire,'inspect',return_value=sample):
                    row=retire.rollback_stopped(IDS[:1])[0]
                self.assertTrue(row['startCommandOk']);self.assertFalse(row['restored'])
        with patch.object(retire,'command') as start,patch.object(retire,'inspect') as inspect:
            row=retire.rollback_stopped(['unregistered-id'])[0]
        start.assert_not_called();inspect.assert_not_called()
        self.assertFalse(row['attempted']);self.assertFalse(row['restored'])

    def test_main_preserves_original_failure_and_records_partial_rollback(self):
        safe=[{'name':name,'id':ident,'state':'running','project':'shadow','restart':'unless-stopped'}
              for name,ident in retire.TARGETS.items()]
        calls=[];written=[]
        failure=ValueError('PRIVATE_ORIGINAL_STOP_FAILURE')
        def command(args,timeout=40):
            calls.append(args)
            if args[1]=='stop' and args[2]==IDS[2]:raise failure
            if args[1]=='start' and args[2]==IDS[0]:raise OSError('PRIVATE_ROLLBACK_FAILURE')
            return ''
        def inspect(names):
            key=names[0]
            if key in retire.TARGETS:return {key:{'Id':retire.TARGETS[key]}}
            return observed(key,'exited' if key==IDS[0] else 'running')
        with ExitStack() as stack:
            stack.enter_context(patch.object(retire,'preflight',return_value=(safe,{})))
            stack.enter_context(patch.object(retire,'command',side_effect=command))
            stack.enter_context(patch.object(retire,'inspect',side_effect=inspect))
            stack.enter_context(patch.object(retire,'inspect_containers',side_effect=AssertionError('Unexpected real collection')))
            stack.enter_context(patch.object(retire,'probe_shared_tts',side_effect=AssertionError('No HTTP')))
            stack.enter_context(patch.object(Path,'write_text',side_effect=lambda raw,**kw:written.append(json.loads(raw))))
            stack.enter_context(patch.object(sys,'argv',['retire_legacy_consumers.py','--execute','qiandengji']))
            with self.assertRaises(ValueError) as error:retire.main()
        self.assertIs(error.exception,failure)
        self.assertEqual([args for args in calls if args[1]=='start'],[['docker','start',ident] for ident in IDS[:2]])
        self.assertEqual(len(written),1);record=written[0]
        self.assertFalse(record['ok']);self.assertEqual(record['errorType'],'ValueError')
        self.assertTrue(record['rollbackAttempted']);self.assertFalse(record['rollbackComplete'])
        self.assertEqual(len(record['rollbackResults']),2)
        self.assertFalse(record['rollbackResults'][0]['restored']);self.assertTrue(record['rollbackResults'][1]['restored'])
        self.assertNotIn(IDS[2],[row['id'] for row in record['rollbackResults']])
        self.assertIn('finishedAt',record);self.assertNotIn('PRIVATE_',json.dumps(record))


if __name__=='__main__':unittest.main()
