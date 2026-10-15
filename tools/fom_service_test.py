"""FOM deployment guards; never launch or contact a Minecraft server."""
from pathlib import Path
import hashlib,json,tempfile,unittest
from unittest.mock import patch
import fom_service as service
from mixed_auth_support import CONFIG,NAME

class FomGuards(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name).resolve();self.server=self.root/'case/server'
        for part in ('mods','config','world/serverconfig'):(self.server/part).mkdir(parents=True,exist_ok=True)
        self.java=Path('E:/MC/jdk/jdk-21.0.12.1+1/bin/java.exe')
        self.props=self.server/'server.properties';self.write_props()
        (self.server/'eula.txt').write_text('eula=true\n')
        (self.server/'config/sable-common.toml').write_text('attempt_udp_networking=false\ndisable_udp_pipeline=true\n')
        (self.server/'world/serverconfig/mixauth-server.toml').write_text(CONFIG,encoding='utf-8')
        self.support=self.server/'mods/maw-fom-support-0.1.0.jar';self.support.write_bytes(b'fixture support')
        (self.server/'mods'/NAME).write_bytes(b'fixture auth')
        self.lock=self.root/'case/mods.lock.json';self.lock.write_text(json.dumps({'files':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (self.server/'mods').iterdir()}}))
        self.file=self.root/'case/service.json';self.raw={'schemaVersion':1,'serverDir':str(self.server),'runtimeDir':str(self.root/'case/ops/fom-service'),
            'gamePort':39172,'healthPort':39173,'java':str(self.java),'maxMemoryMiB':6144,'publicGameAccess':False,'modsManifest':str(self.lock)}
        self.save()
        self.mocks=[patch.object(service,'RESEARCH',self.root),patch.object(service,'PRODUCTION',self.root/'production/server'),patch.object(service,'verify')]
        for mock in self.mocks:mock.start()
    def tearDown(self):
        for mock in reversed(self.mocks):mock.stop()
        self.tmp.cleanup()
    def write_props(self,port=39172,host='127.0.0.1',**changes):
        values={'server-ip':host,'server-port':str(port),'online-mode':'false','enforce-secure-profile':'false','enable-rcon':'false','enable-query':'false','level-name':'world'}
        values.update(changes);self.props.write_text('\n'.join(k+'='+v for k,v in values.items()))
    def save(self):self.file.write_text(json.dumps(self.raw))
    def test_single_owned_java_and_loopback_health(self):
        cfg=service.load_config(self.file);self.assertEqual([s['id'] for s in cfg['services']],['java']);self.assertEqual(cfg['services'][0]['host'],'127.0.0.1');service.validator(cfg)
    def test_public_mode_refuses_unselected_server(self):
        self.raw.update(publicGameAccess=True,gamePort=28976,healthPort=28985);self.save();self.write_props(28976,'0.0.0.0')
        with self.assertRaisesRegex(ValueError,'explicitly selected'):service.load_config(self.file)
    def test_selected_public_server_uses_own_process_and_ports(self):
        with patch.object(service,'PRODUCTION',self.server):
            self.raw.update(publicGameAccess=True,gamePort=28976,healthPort=28985);self.save();self.write_props(28976,'0.0.0.0')
            cfg=service.load_config(self.file);self.assertTrue(cfg['networkExposure']['publicGameAccess']);self.assertEqual(cfg['services'][0]['listenHost'],'0.0.0.0')
    def test_public_flag_is_not_coerced_from_string(self):
        self.raw['publicGameAccess']='true';self.save()
        with self.assertRaises(ValueError):service.load_config(self.file)
    def test_management_interfaces_cannot_be_enabled(self):
        for key in ('enable-rcon','enable-query'):
            self.write_props(**{key:'true'})
            with self.assertRaisesRegex(ValueError,'management properties'):service.load_config(self.file)
    def test_changed_mod_bytes_fail_before_launch(self):
        self.support.write_bytes(b'changed artifact')
        with self.assertRaisesRegex(ValueError,'mod hash differs'):service.load_config(self.file)
    def test_running_mod_change_is_not_silently_adopted(self):
        cfg=service.load_config(self.file);self.support.write_bytes(b'changed artifact')
        with self.assertRaisesRegex(ValueError,'mods changed'):service.validator(cfg)
    def test_running_configuration_change_requires_review(self):
        cfg=service.load_config(self.file);self.raw['maxMemoryMiB']=4096;self.save()
        with self.assertRaisesRegex(ValueError,'configuration changed'):service.validator(cfg)
    def test_shared_ip_password_bypass_refused(self):
        target=self.server/'world/serverconfig/mixauth-server.toml';target.write_text(CONFIG.replace('trusted_login_window_hours = 0','trusted_login_window_hours = 24'))
        with self.assertRaisesRegex(ValueError,'Mixed-login policy'):service.load_config(self.file)
    def test_udp_mode_cannot_drift_into_unmapped_port(self):
        cfg=service.load_config(self.file);(self.server/'config/sable-common.toml').write_text('attempt_udp_networking=true\ndisable_udp_pipeline=false\n')
        with self.assertRaisesRegex(ValueError,'TCP physics'):service.validator(cfg)
    def test_manifest_change_is_not_accepted_at_runtime(self):
        cfg=service.load_config(self.file);doc=json.loads(self.lock.read_bytes());doc['note']='changed';self.lock.write_text(json.dumps(doc))
        with self.assertRaisesRegex(ValueError,'manifest changed'):service.validator(cfg)
    def test_new_support_requires_explicit_selection(self):
        candidate=self.server/'mods/maw-fom-support-0.2.0.jar'
        self.support.rename(candidate)
        self.lock.write_text(json.dumps({'files':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (self.server/'mods').iterdir()}}))
        with self.assertRaisesRegex(ValueError,'Explicit first-join'):service.load_config(self.file)
        self.raw['supportJar']=candidate.name;self.save()
        cfg=service.load_config(self.file);service.validator(cfg)
    def test_duplicate_support_is_rejected(self):
        (self.server/'mods/maw-fom-support-0.2.0.jar').write_bytes(b'other adapter')
        self.lock.write_text(json.dumps({'files':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (self.server/'mods').iterdir()}}))
        with self.assertRaisesRegex(ValueError,'Duplicate'):service.load_config(self.file)
    def test_unknown_support_filename_is_rejected(self):
        self.raw['supportJar']='another-login.jar';self.save()
        with self.assertRaisesRegex(ValueError,'Explicit first-join'):service.load_config(self.file)

    def gateway(self):
        self.support.rename(self.server/'mods/maw-fom-support-0.2.0.jar')
        self.lock.write_text(json.dumps({'files':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (self.server/'mods').iterdir()}}))
        self.raw['supportJar']='maw-fom-support-0.2.0.jar'
        root=self.root/'case/ops/agent-gateway/fixture';root.mkdir(parents=True)
        names=('node.exe','gate/gate.cjs','registry/idmap.json','registry/items.json','registry/network-channels.json',
            'registry/components.tsv','registry/particles.tsv','registry/entity-data-serializers.tsv')
        for name in names:
            path=root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(b'pinned fixture')
        release={'schemaVersion':1,'minecraft':'1.21.1','modFiles':json.loads(self.lock.read_text())['files'],
            'files':{name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in names}}
        (root/'release.json').write_text(json.dumps(release))
        self.raw['agentGateway']={'releaseDir':str(root),'port':39174};self.save();return root

    def test_gateway_is_owned_dependent_lan_only_and_reverse_stoppable(self):
        self.gateway();cfg=service.load_config(self.file);gate=cfg['services'][1]
        self.assertEqual([s['id'] for s in cfg['services']],['java','gate'])
        self.assertEqual(gate['dependsOn'],['java']);self.assertEqual(gate['stopText'],'{"kind":"shutdown"}')
        self.assertEqual(gate['readiness'],'minecraft');self.assertEqual(gate['env']['GATE_PUBLIC_GAME_ACCESS'],'0')
        self.assertEqual(gate['env']['GATE_AGENT_PREFIX'],'ag_');service.validator(cfg)

    def test_gateway_refuses_foreign_pack_manifest(self):
        root=self.gateway();release=json.loads((root/'release.json').read_text());release['modFiles']['unrelated.jar']='00'
        (root/'release.json').write_text(json.dumps(release))
        with self.assertRaisesRegex(ValueError,'exact FOM mod set'):service.load_config(self.file)

    def test_gateway_refuses_changed_bytes_and_runtime_drift(self):
        root=self.gateway();cfg=service.load_config(self.file);(root/'gate/gate.cjs').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError,'Gateway release hash'):service.load_config(self.file)
        with self.assertRaisesRegex(ValueError,'gateway release changed'):service.validator(cfg)

    def test_gateway_paths_and_ports_cannot_escape_deployment(self):
        root=self.gateway()
        for changes in ({'releaseDir':str(self.root/'foreign')},{'port':self.raw['gamePort']},{'port':28977}):
            original=dict(self.raw['agentGateway']);self.raw['agentGateway'].update(changes);self.save()
            with self.assertRaises(ValueError):service.load_config(self.file)
            self.raw['agentGateway']=original
        self.save();release=json.loads((root/'release.json').read_text());release['files']['../../escape']='00';(root/'release.json').write_text(json.dumps(release))
        with self.assertRaisesRegex(ValueError,'Invalid gateway release file'):service.load_config(self.file)

if __name__=='__main__':unittest.main()
