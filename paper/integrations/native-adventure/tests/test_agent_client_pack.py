import importlib.util,json,tarfile,tempfile,unittest,zipfile
from pathlib import Path

HERE=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('agent_client_pack',HERE/'build_agent_client.py')
pack=importlib.util.module_from_spec(spec);spec.loader.exec_module(pack)

class AgentClientPackTest(unittest.TestCase):
    def inputs(self,root,version='0.1.1'):
        gate=root/'gate';gate.mkdir()
        (gate/'native-viewer-packet.cjs').write_text('''const CHANNEL="mcviewer:native_packet";
function nativeRegistries (source) { return source }
function encodeNativePacket () { throw Error("server encoder") }
function decodeNativePacket (bytes) { return bytes }
function attachNativeViewerPackets () { return {} }
module.exports = { encodeNativePacket }
''')
        for name in ['native-chunk-remap.cjs','bounded-jsonl.cjs']:(gate/name).write_text('module.exports = {};\n')
        (gate/'private-token.txt').write_text('must not be packaged')
        addon=root/'addon.jar'
        with zipfile.ZipFile(addon,'w') as z:z.writestr('native-operations.json',json.dumps({'version':version}))
        return gate,addon,root/'sdk.tgz'

    def test_allowlist_contract_provenance_and_no_server_encoders(self):
        with tempfile.TemporaryDirectory() as name:
            gate,addon,out=self.inputs(Path(name));result=pack.build(gate,addon,out)
            self.assertFalse(result['published'])
            with tarfile.open(out) as t:
                names=t.getnames();self.assertEqual(len(names),13)
                self.assertNotIn('package/private-token.txt',names)
                self.assertNotIn('server encoder',t.extractfile('package/native-stream.cjs').read().decode())
                self.assertEqual(json.load(t.extractfile('package/operations.json'))['version'],'0.1.1')
                proof=json.load(t.extractfile('package/provenance.json'));self.assertFalse(proof['includesCredentialsOrWorld'])
                for rel,digest in proof['files'].items():self.assertEqual(pack.sha(t.extractfile('package/'+rel).read()),digest)

    def test_existing_package_is_never_overwritten(self):
        with tempfile.TemporaryDirectory() as name:
            gate,addon,out=self.inputs(Path(name));out.write_bytes(b'preserve')
            with self.assertRaisesRegex(ValueError,'Preserve'):pack.build(gate,addon,out)
            self.assertEqual(out.read_bytes(),b'preserve')

    def test_wrong_server_contract_does_not_create_package(self):
        with tempfile.TemporaryDirectory() as name:
            gate,addon,out=self.inputs(Path(name),'99.0')
            with self.assertRaisesRegex(ValueError,'contract'):pack.build(gate,addon,out)
            self.assertFalse(out.exists())

    def test_changed_native_packet_source_requires_review(self):
        with tempfile.TemporaryDirectory() as name:
            gate,addon,out=self.inputs(Path(name));p=gate/'native-viewer-packet.cjs';p.write_text(p.read_text()+'\nfunction decodeNativePacket (other) {}\n')
            with self.assertRaisesRegex(ValueError,'Review changed'):pack.build(gate,addon,out)
            self.assertFalse(out.exists())

if __name__=='__main__':unittest.main()
