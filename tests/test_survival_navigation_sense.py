"""No game or model calls. Native identity/geometry evidence must remain advisory."""
import copy
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'world/survival'))
from navigation_sense import NavigationSense, PREFIX, CAPABILITY, supported_column_y
from numen_gateway import NumenGateway, write_json, read_json

BODY='d4ac9523-4962-43ed-98c5-19b49e104048'
DIM='minecraft:overworld';NOW=1800000000000


def sample(requested=None):
    row={'schema':1,'capability':CAPABILITY,'ok':True,'actorUuid':BODY,'dimension':DIM,
        'gameTime':1000,'bodyTickCount':800,'position':{'x':10.5,'y':64.,'z':10.5},'observedAt':NOW,
        'bodyControl':{'available':True,'code':'observed','kind':'reflex','name':'mob_defense',
            'nativeAvoidanceActive':True,'sample':'last_native_scheduler_selection'},'queuedTask':None}
    if requested is not None:
        row['destination']={'requested':requested,'available':True,'code':'target_body_collision',
            'targetBlock':'minecraft:crafting_table','requestedStanceClear':False,'requestedStanceSupported':False,
            'pathVerified':False,'destinationChanged':False,'examinedCells':125,'unloadedCells':0,
            'candidates':[{'x':requested['x']+1.5,'y':requested['y'],'z':requested['z']+.5,
                           'supportBlock':'minecraft:stone','pathVerified':False}]}
    return row


class NavigationSenseTests(unittest.TestCase):
    def setUp(self):
        self.request={'x':10.,'y':64.,'z':10.};self.row=sample(self.request);self.commands=[]
        def command(text):self.commands.append(text);return PREFIX+json.dumps(self.row)
        self.gateway=NumenGateway(rcon=SimpleNamespace(cmd=command),clock=lambda:NOW/1000)
        self.client=NavigationSense(self.gateway)

    def test_exact_native_reflex_current_sample_not_queued_task(self):
        self.row=sample();result=self.client.read(BODY,DIM)
        self.assertTrue(result['bodyControl']['nativeAvoidanceActive'])
        self.assertIsNone(result['queuedTask'])
        self.assertEqual(self.commands,['qdworld navigation_sense '+BODY])

    def test_destination_retains_original_and_candidates_are_not_routes(self):
        before=copy.deepcopy(self.request);result=self.client.read(BODY,DIM,self.request)
        self.assertTrue(result['ok']);self.assertEqual(before,self.request)
        self.assertEqual(result['destination']['requested'],before)
        self.assertFalse(result['destination']['destinationChanged'])
        self.assertFalse(result['destination']['pathVerified'])
        self.assertTrue(all(not c['pathVerified'] for c in result['destination']['candidates']))
        self.assertEqual(self.commands,['qdworld navigation_sense '+BODY+' 10.0 64.0 10.0'])

    def test_column_height_uses_only_the_requested_supported_cell(self):
        args = {'x': 10., 'z': 10.}
        self.assertIsNone(supported_column_y(self.row, args))
        self.row['destination']['candidates'][0].update(x=10.5, y=65., z=10.5)
        self.assertEqual(supported_column_y(self.row, args), 65)
        self.row['destination'].update(requestedStanceClear=True, requestedStanceSupported=True)
        self.assertEqual(supported_column_y(self.row, args), 64)

    def test_missing_bridge_and_timeout_are_unavailable_not_idle_or_defense(self):
        for raw in ('Unknown command',PREFIX+'{}'):
            self.gateway.rcon.cmd=lambda text:raw
            value=self.client.read(BODY,DIM)
            self.assertFalse(value['ok']);self.assertFalse(value['bodyControl']['available'])
            self.assertNotIn('kind',value['bodyControl'])
        self.gateway.rcon.cmd=lambda text:(_ for _ in ()).throw(TimeoutError('private transport detail'))
        self.assertNotIn('private',json.dumps(self.client.read(BODY,DIM)))

    def test_wrong_actor_dimension_old_sample_and_changed_request_rejected(self):
        for key,value in [('actorUuid','e5005711-be9f-44b7-aaad-6993c0ba5df4'),('dimension','minecraft:the_nether'),('observedAt',NOW-16000)]:
            self.row=sample(self.request);self.row[key]=value
            self.assertFalse(self.client.read(BODY,DIM,self.request)['ok'])
        self.row=sample({'x':11.,'y':64.,'z':10.})
        self.assertFalse(self.client.read(BODY,DIM,self.request)['ok'])

    def test_invented_reflex_and_unsafe_geometry_claims_rejected(self):
        for mutate in (lambda r:r['bodyControl'].update(kind='idle',nativeAvoidanceActive=True),
                       lambda r:r['destination'].update(pathVerified=True),
                       lambda r:r['destination'].update(destinationChanged=True),
                       lambda r:r['destination'].update(examinedCells=126),
                       lambda r:r['destination']['candidates'][0].update(x=5000),
                       lambda r:r['destination']['candidates'][0].update(y=float('nan'))):
            self.row=sample(self.request);mutate(self.row)
            self.assertFalse(self.client.read(BODY,DIM,self.request)['ok'])

    def test_xy_only_request_labels_y_inference_and_does_not_modify_args(self):
        args={'x':10.,'z':10.};body={'bodyUuid':BODY,'dimension':DIM,'position':{'x':9.,'y':64.,'z':9.}}
        result=self.client.for_destination(body,args)
        self.assertTrue(result['ok']);self.assertEqual(args,{'x':10.,'z':10.})
        self.assertEqual(result['requestArguments'],args);self.assertEqual(result['surveyYSource'],'current_body_height')

    def test_invalid_command_coordinates_never_dispatched(self):
        for point in ({'x':float('nan'),'y':64,'z':0},{'x':1,'y':-100,'z':0},{'x':30000000,'y':64,'z':0}):
            self.assertFalse(self.client.read(BODY,DIM,point)['ok'])
        self.assertEqual(self.commands,[])

    def test_failed_navigation_keeps_native_result_and_adds_current_evidence_once(self):
        with tempfile.TemporaryDirectory() as directory:
            state=Path(directory);client=NumenGateway(state,self.gateway.rcon,clock=lambda:NOW/1000)
            args={'x':10.,'y':64.,'z':10.};self.row=sample(args)
            body={'ok':True,'bodyUuid':BODY,'dimension':DIM,'position':{'x':10.5,'y':64.,'z':10.5},
                  'task':{'busy':False},'navigationEpoch':'epoch','bodyControl':self.row['bodyControl'],
                  'navigationResult':{'task_id':'t1','navigation_epoch':'epoch','success':False,'state':'failed','reason':'cannot reach table'}}
            row={'schema':2,'actionId':'a'*32,'turnId':'turn_'+'a'*24,'tool':'goto','args':args,'status':'in_flight',
                 'before':{'bodyUuid':BODY,'dimension':DIM,'navigationEpoch':'epoch'},'nativeTaskId':'t1'}
            write_json(state/'inflight-action.json',row)
            result=client._settle_inflight(body)
            self.assertEqual(result['status'],'failed');self.assertFalse(result['navigationOutcome']['success'])
            self.assertEqual(result['args'],args);self.assertEqual(result['navigationSense']['destination']['requested'],args)
            self.assertEqual(result['after']['bodyControl']['name'],'mob_defense')
            self.assertIsNone(client._settle_inflight(body));self.assertEqual(len(self.commands),1)


if __name__=='__main__':unittest.main()
