import hashlib,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import fom_bedrock_service as bridge

class FomBedrockTests(unittest.TestCase):
    def fixture(self,root):
        server=root/'server';server.mkdir();ops=root/'ops';ops.mkdir()
        directory=ops/'bedrock-test';(directory/'plugins/Geyser/packs').mkdir(parents=True);(directory/'plugins/Geyser/custom_mappings').mkdir()
        main=ops/'service.json';main.write_text('{}');mods=ops/'mods.json';mods.write_text(json.dumps({'files':{'native.jar':'original'}}))
        release=ops/'gateway';(release/'gate').mkdir(parents=True);(release/'registry').mkdir()
        artifacts={'ViaProxy-3.4.14.jar':b'viaproxy','plugins/Geyser-ViaProxy.jar':b'geyser'}
        for name,data in artifacts.items():(directory/name).write_bytes(data)
        (directory/'plugins/Geyser/config.yml').write_bytes(bridge.geyser_config('lan').encode())
        record={'schemaVersion':1,'minecraft':'1.21.1','modFiles':{'native.jar':'original'},'files':{}}
        for name in ['gate/gate.cjs','gate/bedrock-account.cjs','registry/idmap.json','registry/items.json']:
            path=release/name;path.write_bytes(b'{}');record['files'][name]=bridge.sha(path)
        (release/'release.json').write_text(json.dumps(record))
        contract={'itemCount':1,'inputs':{'idmapSha256':bridge.sha(release/'registry/idmap.json')},'files':{}}
        for name,subdir in [(bridge.resources.PACK,'packs'),(bridge.resources.MAPPINGS,'custom_mappings'),(bridge.resources.CATALOG,'')]:
            file=directory/'plugins/Geyser'/subdir/name;file.write_bytes(b'{}');contract['files'][name]={'sha256':bridge.sha(file)}
        (directory/'plugins/Geyser'/bridge.resources.CONTRACT).write_text(json.dumps(contract))
        projection=directory/'plugins/Geyser/fom-item-projection.json';projection.write_bytes(b'{}')
        (directory/'plugins/Geyser/fom-projection-contract.json').write_text(json.dumps({'schemaVersion':1,'nativeCatalogSha256':bridge.sha(release/'registry/items.json'),'iconCatalogSha256':contract['files'][bridge.resources.CATALOG]['sha256'],'projectionSha256':bridge.sha(projection)}))
        raw={'schemaVersion':1,'mode':'lan','mainConfig':str(main),'bridgeDir':str(directory),'gatewayRelease':str(release)}
        config=ops/'bedrock.json';config.write_text(json.dumps(raw))
        native={'serverDir':str(server),'gamePort':28976,'healthPort':28985,'networkExposure':{'publicGameAccess':True},'_raw':{'modsManifest':str(mods)},'services':[{'id':'gate','env':{'GATE_AGENT_PREFIX':'ag_','GATE_PUBLIC_GAME_ACCESS':'1','GATE_LAN_SUBNET':'192.168.3.0/24','GATE_VANILLA_PROJECTION':'1'}}]}
        return config,raw,server,native,contract,{n:hashlib.sha256(d).hexdigest() for n,d in artifacts.items()}

    def scenario(self,fn):
        with tempfile.TemporaryDirectory() as tmp:
            config,raw,server,native,contract,hashes=self.fixture(Path(tmp))
            with patch.object(bridge.fom,'PRODUCTION',server),patch.object(bridge.fom,'load_config',return_value=native),patch.object(bridge.fom,'validator'),patch.object(bridge.original,'ARTIFACTS',hashes),patch.object(bridge.resources,'validate',return_value=contract):
                fn(config,raw,contract)

    def test_live_bridge_is_namespaced_and_private_with_xbox_validation(self):
        def run(config,raw,contract):
            out=bridge.load_config(config);gate=out['services'][0]
            self.assertEqual(out['udpPort'],28988);self.assertEqual(gate['listenHost'],'127.0.0.1')
            self.assertEqual(gate['env']['GATE_BEDROCK_ACCOUNT_NAMESPACE'],'1');self.assertEqual(gate['env']['GATE_PUBLIC_GAME_ACCESS'],'0')
            self.assertEqual(gate['env']['GATE_AGENT_PREFIX'],'');self.assertNotIn('GATE_LAN_SUBNET',gate['env'])
            self.assertIn('validate-bedrock-login: true',bridge.geyser_config('lan'));out['validator']()
        self.scenario(run)

    def test_offline_bedrock_qa_cannot_bind_production_directory(self):
        def run(config,raw,contract):
            raw['mode']='offline_qa';config.write_text(json.dumps(raw))
            with self.assertRaisesRegex(ValueError,'marked staging'):bridge.load_config(config)
        self.scenario(run)

    def test_icon_mapping_from_another_native_registry_is_rejected(self):
        def run(config,raw,contract):
            contract['inputs']['idmapSha256']='not-this-world'
            with self.assertRaisesRegex(ValueError,'different registry'):bridge.load_config(config)
        self.scenario(run)

    def test_gateway_from_a_different_modpack_is_rejected(self):
        def run(config,raw,contract):
            file=Path(raw['gatewayRelease'])/'release.json';record=json.loads(file.read_text());record['modFiles']={'another.jar':'x'};file.write_text(json.dumps(record))
            with self.assertRaisesRegex(ValueError,'actual FOM mod set'):bridge.load_config(config)
        self.scenario(run)

    def test_runtime_configuration_drift_stops_bridge_validation(self):
        def run(config,raw,contract):
            out=bridge.load_config(config);config.write_text(config.read_text()+'\nchanged')
            with self.assertRaisesRegex(ValueError,'release changed'):out['validator']()
        self.scenario(run)

    def test_unlisted_geyser_extensions_are_rejected(self):
        def run(config,raw,contract):
            out=bridge.load_config(config)
            extensions=Path(raw['bridgeDir'])/'plugins/Geyser/extensions';extensions.mkdir()
            (extensions/'unexpected.jar').write_bytes(b'unreviewed')
            with self.assertRaisesRegex(ValueError,'Unreviewed Geyser extensions'):out['validator']()
        self.scenario(run)

    def test_no_arbitrary_http_or_remote_world_fields(self):
        def run(config,raw,contract):
            raw['remoteServer']='outside.example';config.write_text(json.dumps(raw))
            with self.assertRaisesRegex(ValueError,'Invalid FOM'):bridge.load_config(config)
        self.scenario(run)

    def test_isolated_candidate_uses_its_own_upstream_and_health(self):
        with tempfile.TemporaryDirectory() as tmp:
            config,raw,server,native,contract,hashes=self.fixture(Path(tmp))
            native.update(gamePort=39220,healthPort=39221,networkExposure={'publicGameAccess':False})
            raw['mode']='offline_qa';config.write_text(json.dumps(raw))
            directory=Path(raw['bridgeDir']);(directory/'.fom-bedrock-qa').write_text('loopback-only')
            (directory/'plugins/Geyser/config.yml').write_bytes(bridge.geyser_config('offline_qa').encode())
            with patch.object(bridge.fom,'PRODUCTION',Path(tmp)/'unrelated-production'),patch.object(bridge.fom,'RESEARCH',Path(tmp)),patch.object(bridge,'QA_ROOT',Path(tmp)),patch.object(bridge.fom,'load_config',return_value=native),patch.object(bridge.original,'ARTIFACTS',hashes),patch.object(bridge.resources,'validate',return_value=contract):
                out=bridge.load_config(config);gate=out['services'][0]
                self.assertEqual(gate['command'][-1],'39220')
                self.assertEqual(gate['fomHealthPort'],39221)
                self.assertEqual(Path(gate['fomServerDir']),server)
                self.assertEqual(gate['listenHost'],'127.0.0.1')
                raw['mode']='lan';config.write_text(json.dumps(raw))
                with self.assertRaisesRegex(ValueError,'selected FOM world'):bridge.load_config(config)

if __name__=='__main__':unittest.main()
