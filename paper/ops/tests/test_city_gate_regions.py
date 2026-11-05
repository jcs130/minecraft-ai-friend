import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('gate_regions',Path(__file__).resolve().parents[1]/'city_gate_regions.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class GateRegionsTest(unittest.TestCase):
    def setUp(self):
        self.config={'city-gates':{'enabled':True,'village':{'world':'world','x':-563,'y':67,'z':-443},
            'aincrad':{'world':'aincrad','x':-583,'y':67,'z':919}}}
        self.worlds={'world':{'regions':{'unrelated':{'flags':{'block-place':'allow'}},
            'qd_vortex_village_gate':{'type':'cuboid','min':{'x':-557,'y':66,'z':-440},'owners':{'unique-ids':['existing']},'flags':{}}}},
            'aincrad':{'regions':{'city':{'flags':{'block-break':'deny','block-place':'allow'}}}}}
    def test_moves_existing_region_and_preserves_unrelated(self):
        result=module.plan(self.config,self.worlds)
        gate=result['world']['regions']['qd_vortex_village_gate']
        self.assertEqual(gate['min'],{'x':-564,'y':66,'z':-443})
        self.assertEqual(gate['max'],{'x':-560,'y':70,'z':-441})
        self.assertEqual(gate['owners'],{'unique-ids':['existing']})
        self.assertEqual(result['aincrad']['regions']['city'],self.worlds['aincrad']['regions']['city'])
        self.assertEqual(result['world']['regions']['unrelated'],self.worlds['world']['regions']['unrelated'])
        self.assertEqual(self.worlds['world']['regions']['qd_vortex_village_gate']['min']['x'],-557)
    def test_return_gate_and_interaction(self):
        gate=module.plan(self.config,self.worlds)['aincrad']['regions']['qd_vortex_aincrad_gate']
        self.assertEqual(gate['min'],{'x':-584,'y':66,'z':919})
        for flag in ['use','interact']:self.assertEqual(gate['flags'][flag],'allow')
        for flag in ['block-break','block-place','pistons','other-explosion','water-flow']:self.assertEqual(gate['flags'][flag],'deny')
    def test_reapplying_is_idempotent(self):
        planned=module.plan(self.config,self.worlds)
        self.assertEqual(module.plan(self.config,planned),planned)
    def test_invalid_config_rejected(self):
        self.config['city-gates']['village']['x']=True
        with self.assertRaises(ValueError):module.plan(self.config,self.worlds)
    def test_disabled_does_not_write(self):
        self.config['city-gates']['enabled']=False
        with self.assertRaises(ValueError):module.plan(self.config,self.worlds)

if __name__=='__main__':unittest.main()
