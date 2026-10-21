from pathlib import Path
import json,tempfile,unittest
from rebind_fom_numen_gateway import state_identity,channel_identity

class RegistryTests(unittest.TestCase):
    def states(self,a,b):
        with tempfile.TemporaryDirectory() as tmp:
            x,y=Path(tmp)/'a.jsonl',Path(tmp)/'b.jsonl'
            for p,rows in ((x,a),(y,b)):p.write_text(''.join(json.dumps(r)+'\n' for r in rows))
            return state_identity(x,y)
    def row(self,**changes):return {'stateId':1,'name':'create:shaft','properties':{'axis':'x'},'occlusionBoxes':[[0,0,.0625,1,1,.9375]],**changes}
    def test_actual_network_identity_is_exact_while_original_shape_last_bit_is_labelled(self):
        a=self.row();b=self.row(occlusionBoxes=[[0,0,.06250000000000006,1,1,.9375]])
        r=self.states([a],[b]);self.assertTrue(r['networkIdsAndPropertiesExact']);self.assertEqual(r['originalShapeRoundoffRows'],1);self.assertGreater(r['maxOriginalShapeRoundoff'],0)
    def test_name_ids_properties_and_non_roundoff_geometry_must_rebuild(self):
        for row in [self.row(stateId=2),self.row(name='other:block'),self.row(properties={'axis':'z'}),self.row(occlusionBoxes=[[0,0,.1,1,1,.9375]])]:
            with self.assertRaises(ValueError):self.states([self.row()],[row])
        with self.assertRaises(ValueError):self.states([self.row()],[])
    def test_existing_channels_cannot_drift_and_numen_must_be_optional(self):
        old={'protocols':{'4':[{'id':'mod:existing','version':'1','optional':False}]}}
        extra={'id':'numen_api:request_state','version':'1','optional':True}
        good={'protocols':{'4':old['protocols']['4']+[extra]}}
        self.assertEqual(channel_identity(old,good)['additionalOptionalNumenChannels'],1)
        for new in [{'protocols':{'4':[extra]}},{'protocols':{'4':old['protocols']['4']+[{**extra,'optional':False}]}},{'protocols':{'4':old['protocols']['4']+[{**extra,'id':'other:channel'}]}}]:
            with self.assertRaises(ValueError):channel_identity(old,new)

if __name__=='__main__':unittest.main()
