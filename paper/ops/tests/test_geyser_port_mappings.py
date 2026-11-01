import importlib.util,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('mapping',Path(__file__).parents[1]/'geyser-port-mappings.py');mapping=importlib.util.module_from_spec(spec);spec.loader.exec_module(mapping)

class Router:
    def __init__(self):self.values={};self.adds=[]
    def invoke(self,action,fields):
        key=(fields['NewExternalPort'],fields['NewProtocol'])
        if action=='GetSpecificPortMappingEntry':return self.values.get(key,{'errorCode':'714'}).copy()
        if action=='AddPortMapping':
            self.adds.append(fields.copy());self.values[key]={k:str(v)for k,v in fields.items()};self.values[key]['NewLeaseDuration']='604800';return {}
        raise AssertionError(action)

class MappingTests(unittest.TestCase):
    def test_preview_has_no_router_writes(self):
        router=Router();result=mapping.reconcile(router.invoke,'192.0.2.10')
        self.assertFalse(result['routerChanged']);self.assertEqual(len(result['mappings']),3);self.assertEqual(router.adds,[])
    def test_readback_of_router_limited_lease(self):
        router=Router();result=mapping.reconcile(router.invoke,'192.0.2.10',True)
        self.assertTrue(result['routerChanged']);self.assertEqual(len(router.adds),3)
        self.assertTrue(all(r['after']['NewLeaseDuration']=='604800'for r in result['mappings']))
    def test_later_conflict_rejects_before_any_write(self):
        router=Router();router.values[(19133,'UDP')]={'NewInternalClient':'192.0.2.11','NewInternalPort':'19133'}
        with self.assertRaisesRegex(RuntimeError,'another destination'):mapping.reconcile(router.invoke,'192.0.2.10',True)
        self.assertEqual(router.adds,[])
    def test_inspection_failure_rejects_before_write(self):
        router=Router();router.values[(19133,'UDP')]={'errorCode':'501'}
        with self.assertRaisesRegex(RuntimeError,'Cannot inspect'):mapping.reconcile(router.invoke,'192.0.2.10',True)
        self.assertEqual(router.adds,[])
    def test_permanent_own_mappings_are_not_replaced(self):
        router=Router()
        for port,protocol,_ in mapping.MAPPINGS:router.values[(port,protocol)]={'NewInternalClient':'192.0.2.10','NewInternalPort':str(port),'NewEnabled':'1','NewLeaseDuration':'0','NewPortMappingDescription':'existing game'}
        self.assertFalse(mapping.reconcile(router.invoke,'192.0.2.10',True)['routerChanged']);self.assertEqual(router.adds,[])
    def test_renewal_retains_description(self):
        router=Router();mapping.reconcile(router.invoke,'192.0.2.10',True);router.values[(19132,'UDP')]['NewPortMappingDescription']='original game entry'
        router.adds.clear();mapping.reconcile(router.invoke,'192.0.2.10',True)
        self.assertEqual(router.adds[0]['NewPortMappingDescription'],'original game entry')
    def test_public_or_loopback_destination_rejected(self):
        for client in ['8.8.8.8','127.0.0.1']:
            with self.assertRaises(ValueError):mapping.reconcile(Router().invoke,client,True)

if __name__=='__main__':unittest.main()
