"""Bridge protocol, ownership policy and reuse tests; no actual game actions."""
import hashlib
import importlib.util
import json
from pathlib import Path
import socket
import struct
import tempfile
import threading
import unittest
from unittest.mock import Mock, patch

import maw_bedrock_service as bridge
import maw_service as owner


def pong(stamp, port=bridge.UDP_PORT):
    text=f'MCPE;My Agent World;2193;26.52;0;4;123;NeoForge LAN visitor;Survival;1;{port};{port};'.encode()
    return b'\x1c'+struct.pack('>qq',stamp,123)+bridge.MAGIC+struct.pack('>H',len(text))+text


class ProtocolTests(unittest.TestCase):
    def test_pong_requires_nonce_magic_length_and_protocol(self):
        data=pong(125)
        self.assertEqual(bridge.decode_pong(data,125)['protocol'],2193)
        for bad,stamp in [(data,126),(data[:-1],125),(data+b'\x00',125),
                (data[:17]+b'x'*16+data[33:],125),(b'\x1b'+data[1:],125)]:
            with self.subTest(bad=bad[:20]),self.assertRaises(ValueError):
                bridge.decode_pong(bad,stamp)

    def test_actual_udp_round_trip_has_positive_control(self):
        with socket.socket(socket.AF_INET,socket.SOCK_DGRAM) as server:
            server.bind(('127.0.0.1',0));port=server.getsockname()[1]
            def reply():
                data,address=server.recvfrom(1024)
                server.sendto(pong(struct.unpack('>q',data[1:9])[0],port),address)
            thread=threading.Thread(target=reply);thread.start()
            result=bridge.bedrock_probe('127.0.0.1',port);thread.join(timeout=3)
        self.assertEqual(result['version'],'26.52')
        self.assertEqual(result['maxPlayers'],4)

    def test_config_keeps_auth_and_network_bounds(self):
        with self.assertRaises(ValueError):bridge.geyser_config('0.0.0.0')
        config=bridge.geyser_config()
        for required in ['address: 192.168.3.163','mode: none','validate-bedrock-login: true',
                'enable-metrics: false','max-players: 4','config-version: 8']:
            self.assertIn(required,config)


class ConfigurationTests(unittest.TestCase):
    def test_original_voice_channels_and_global_frequency_are_bound_to_native_config(self):
        import maw_bedrock_modpacks as models
        import maw_bedrock_voices as voices
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);directory=root/'bedrock';resources=directory/'plugins/Geyser'
            resources.mkdir(parents=True)
            artifacts={'ViaProxy-3.4.14.jar':b'proxy fixture','plugins/Geyser-ViaProxy.jar':b'geyser fixture'}
            for name,data in artifacts.items():(directory/name).write_bytes(data)
            hashes={name:hashlib.sha256(data).hexdigest() for name,data in artifacts.items()}
            (resources/'config.yml').write_bytes(bridge.geyser_config().encode('utf8'))
            (resources/models.CONTRACT).write_text('{}','utf8')
            (root/'services').mkdir()
            config=root/'services/bedrock.json';config.write_text(json.dumps({'schemaVersion':1,'lanAddress':bridge.LAN_ADDRESS,'udpPort':bridge.UDP_PORT}),'utf8')
            (root/'services/service.json').write_text(json.dumps({'services':[{'id':'gate','port':28977,
                'command':['node','gate.cjs','28977','127.0.0.1','28976'],'cwd':tmp,'env':{}}]}),'utf8')
            native=root/'server/config/touhou_little_maid-common.toml';native.parent.mkdir(parents=True)
            native.write_text('GlobalMaidSoundFrequency = 25\n','utf8')
            contract={'voiceVersion':1,'files':{},'geyserJarSha256':hashes['plugins/Geyser-ViaProxy.jar']}
            with patch.object(bridge,'ARTIFACTS',hashes),patch.object(models,'validate',return_value=contract):
                value=bridge.load_config(config,root=root);value['validator']()
                env=value['services'][0]['env']
                self.assertEqual(env['GATE_MAID_SOUND_FREQUENCY'],'0.25')
                self.assertTrue(set(voices.CHANNELS)<=set(env['GATE_EXTRA_PLAY_CHANNELS'].split(',')))
                native.write_text('GlobalMaidSoundFrequency = 0\n','utf8')
                with self.assertRaises(ValueError):value['validator']()
                self.assertEqual(bridge.load_config(config,root=root)['services'][0]['env']['GATE_MAID_SOUND_FREQUENCY'],'0.0')
                native.write_text('GlobalMaidSoundFrequency = 101\n','utf8')
                with self.assertRaisesRegex(ValueError,'global maid sound frequency'):bridge.load_config(config,root=root)

    def test_hashes_and_live_changes_are_checked(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);directory=root/'bedrock';(directory/'plugins/Geyser').mkdir(parents=True)
            artifacts={'ViaProxy-3.4.14.jar':b'proxy fixture','plugins/Geyser-ViaProxy.jar':b'geyser fixture'}
            for name,data in artifacts.items():(directory/name).write_bytes(data)
            file=directory/'plugins/Geyser/config.yml';file.write_bytes(bridge.geyser_config().encode('utf-8'))
            config=root/'bedrock.json';config.write_text(json.dumps({'schemaVersion':1,
                'lanAddress':bridge.LAN_ADDRESS,'udpPort':bridge.UDP_PORT}),'utf-8')
            (root/'services').mkdir()
            (root/'services/service.json').write_text(json.dumps({'services':[{'id':'gate','port':28977,
                'command':['node','gate.cjs','28977','127.0.0.1','28976'],'cwd':tmp,
                'env':{'GATE_LAN_SUBNET':'192.168.3.0/24','GATE_PUBLIC_GAME_ACCESS':'1'}}]}),'utf-8')
            hashes={name:hashlib.sha256(data).hexdigest() for name,data in artifacts.items()}
            with patch.object(bridge,'ARTIFACTS',hashes):
                value=bridge.load_config(config,root=root);value['validator']()
                self.assertEqual(value['services'][0]['listenHost'],'127.0.0.1')
                self.assertEqual(value['services'][0]['env']['GATE_LISTEN_HOST'],'127.0.0.1')
                self.assertNotIn('GATE_PUBLIC_GAME_ACCESS',value['services'][0]['env'])
                self.assertNotIn('GATE_LAN_SUBNET',value['services'][0]['env'])
                self.assertIn('127.0.0.1:28994',value['services'][1]['command'])
                self.assertEqual(value['services'][1]['command'][-1],'NONE')
                self.assertEqual(value['services'][0]['env']['GATE_BEDROCK_PROJECTION'],'1')
                self.assertEqual(value['services'][0]['env']['GATE_NATIVE_VIEWER'],'0')
                self.assertIn('maw_agent:auth_state',value['services'][0]['env']['GATE_EXTRA_PLAY_CHANNELS'].split(','))
                self.assertIn('validate-bedrock-login: true',bridge.geyser_config())
                file.write_text(bridge.geyser_config()+'# edited','utf-8')
                with self.assertRaises(ValueError):value['validator']()
                with self.assertRaises(ValueError):bridge.load_config(config,root=root)

    def test_unexpected_config_is_rejected_before_file_access(self):
        with tempfile.TemporaryDirectory() as tmp:
            file=Path(tmp)/'config.json';file.write_text('{"schemaVersion":1,"lanAddress":"0.0.0.0","udpPort":19132}')
            with self.assertRaises(ValueError):bridge.load_config(file,root=Path(tmp))

    def test_shared_supervisor_uses_configured_role_and_validator(self):
        with tempfile.TemporaryDirectory() as tmp:
            child=Mock();child.spec={'dependsOn':[]};child.process=None;child.ready=True;child.stopping=False
            child.next_start=float('inf');child.state.return_value={'id':'bedrock','ready':True}
            validator=Mock()
            config={'runtimeDir':tmp,'serverDir':tmp,'gamePort':bridge.TCP_PORT,
                'healthPort':bridge.HEALTH_PORT,'services':[{'id':'bedrock'}]}
            supervisor=bridge.BedrockSupervisor(config,validator=validator,child_factory=lambda *args:child)
            try:
                supervisor.tick();self.assertTrue(supervisor.snapshot['healthy'])
                self.assertEqual(supervisor.roles,('bedrock',));validator.assert_called_once()
                with self.assertRaises(ValueError):supervisor.apply({'action':'console','command':'stop'})
                supervisor.apply({'action':'pause'});self.assertTrue(supervisor.paused())
                supervisor.apply({'action':'resume'});self.assertFalse(supervisor.paused())
            finally:
                supervisor.job.close();supervisor.lock.close()
                for handler in supervisor.audit.handlers:handler.close()


class HealthSmokeTests(unittest.TestCase):
    def test_scoped_smoke_requires_firewall_and_leaves_legacy_checks_alone(self):
        import time
        spec=importlib.util.spec_from_file_location('bedrock_health_test',
            Path(__file__).resolve().parents[1]/'world/ops/health/health_mon.py')
        health=importlib.util.module_from_spec(spec);spec.loader.exec_module(health)
        value={'healthy':True,'paused':False,'heartbeatEpoch':time.time(),
            'services':[{'id':'bedrock','port':bridge.TCP_PORT,'listenHost':'127.0.0.1',
                'ready':True,'pid':123,'metrics':{'bedrock':{}}},
                {'id':'compat_gate','port':bridge.GATE_PORT,'listenHost':'127.0.0.1','ready':True,'pid':124}]}
        connection=Mock();response=connection.getresponse.return_value
        response.status=200;response.read.return_value=json.dumps(value).encode()
        firewall=Mock(returncode=1,stdout='{"ok":false}')
        with patch('http.client.HTTPConnection',return_value=connection), \
                patch.object(bridge,'bedrock_probe',return_value={'motd':'My Agent World','maxPlayers':4}), \
                patch.object(bridge,'load_config',return_value={'gamePort':bridge.TCP_PORT}), \
                patch('maw_bedrock_resources.validate',return_value={'itemCount':1,'perNamespace':{'test':1}}), \
                patch('maw_bedrock_resources.registered_items',return_value={'nativeItems':1}), \
                patch('maw_bedrock_modpacks.validate',return_value={'modelCount':1,'packs':[{}]}), \
                patch('maw_bedrock_modpacks.registered_models',return_value={'registeredModels':1,'packsLoaded':1}), \
                patch('maw_bedrock_visuals.validate',return_value={'blockCount':1,'partCount':1,'entityCount':1,'foodCount':1,'heldModelCount':1,'actualPhoneTested':False}), \
                patch('maw_bedrock_visuals.registered',return_value={'blocks':1}), \
                patch.object(health.subprocess,'run',return_value=firewall), \
                patch.object(health,'probe_agent_observatory',side_effect=AssertionError('legacy probe called')):
            report=health.probe_panel_smoke(scope='society-bedrock')
            self.assertFalse(report['ok'])
            self.assertFalse(report['society_bedrock']['lanAccessReady'])
            firewall.returncode=0;firewall.stdout='{"ok":true}'
            self.assertTrue(health.probe_panel_smoke(scope='society-bedrock')['ok'])
        with self.assertRaises(ValueError):health.probe_panel_smoke(scope='unknown')


if __name__=='__main__':unittest.main()
