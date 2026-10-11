import importlib.util,json,tempfile,unittest,base64,time,threading,socket,struct
from pathlib import Path
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('goddess_mcp',Path(__file__).with_name('goddess-mcp.py'))
g=importlib.util.module_from_spec(spec);spec.loader.exec_module(g)

class GoddessMcpTests(unittest.TestCase):
    def test_command_framing_and_schema(self):
        calls=[]
        def rcon(q):
            calls.append(q)
            return 'MC_OBSERVATION '+json.dumps({'schemaVersion':1,'status':'ok'})
        with patch.object(g,'_rcon',rcon):
            g._last_observe=0
            self.assertEqual(json.loads(g.read_player_world('.Guest'))['status'],'ok')
        self.assertEqual(json.loads(base64.urlsafe_b64decode(calls[0].split()[-1]+'===')),{'op':'player','player':'.Guest'})
        with self.assertRaises(ValueError):g.read_player_world('Guest\nsay hacked')
        with self.assertRaises(ValueError):g.inspect_world_block('world;stop',0,64,0)
        with self.assertRaises(ValueError):g.inspect_world_area('world',0,64,0,radius=900)
        with self.assertRaises(ValueError):g.find_world_blocks('world',0,64,0,['chest\nsay hacked'])
        with self.assertRaises(ValueError):g.inspect_player_access('Guest','world',0,64,0,'op')
        with patch.object(g,'_rcon',lambda q:'legacy backend not available'):
            with self.assertRaises(RuntimeError):g._observe('player',player='Guest')

    def test_fragmented_rcon_is_assembled(self):
        with tempfile.TemporaryDirectory(prefix='goddess-rcon-test-') as folder:
            self.assertEqual(Path(folder).resolve().parent,Path(tempfile.gettempdir()).resolve())
            listener=socket.socket();listener.bind(('127.0.0.1',0));listener.listen();port=listener.getsockname()[1]
            props=Path(folder)/'server.properties';props.write_text(f'rcon.password=fake-unit-password\nrcon.port={port}\n')
            def packet(i,t,b):
                raw=b.encode() if isinstance(b,str) else b;return struct.pack('<iii',len(raw)+10,i,t)+raw+b'\0\0'
            def exact(c,n):
                out=b''
                while len(out)<n:out+=c.recv(n-len(out))
                return out
            def read(c):
                n=struct.unpack('<i',exact(c,4))[0];raw=exact(c,n);return struct.unpack('<ii',raw[:8]),raw[8:-2].decode()
            expected=json.dumps({'text':'测试fragment '*600},ensure_ascii=False)
            errors=[]
            def serve():
                try:
                    with listener.accept()[0] as c:
                        read(c);c.sendall(packet(901,2,''));a,q=read(c)
                        self.assertEqual(q,'minecraft:list')
                        raw=expected.encode()
                        for start in range(0,len(raw),1001):
                            c.sendall(packet(902,0,raw[start:start+1001]))
                            if start==0:self.assertEqual(read(c)[1],'minecraft:time query gametime')
                        c.sendall(packet(903,0,''))
                except BaseException as e:errors.append(e)
                finally:listener.close()
            t=threading.Thread(target=serve);t.start()
            with patch.object(g,'PROPERTIES',props):self.assertEqual(g._rcon('minecraft:list'),expected)
            t.join(5);self.assertFalse(t.is_alive());self.assertFalse(errors)

    def test_photo_missing_and_stale_are_explicit(self):
        with tempfile.TemporaryDirectory(prefix='goddess-photo-test-') as folder:
            self.assertEqual(Path(folder).resolve().parent,Path(tempfile.gettempdir()).resolve())
            uid='00000000-0000-4000-8000-000000000001'
            with patch.object(g,'ROOT',Path(folder)),patch.object(g,'_observe',lambda *a,**kw:{'uuid':uid}):
                self.assertEqual(json.loads(g.read_recent_photo('Guest')[0])['reason'],'no_recent_photo')
                root=Path(folder)/'goddess-observations';root.mkdir();(root/(uid+'.png')).write_bytes(b'old')
                (root/(uid+'.json')).write_text(json.dumps({'capturedAtMs':0,'sha256':'old'}))
                self.assertEqual(json.loads(g.read_recent_photo('Guest')[0])['reason'],'stale_or_changed_photo')
        with self.assertRaises(ValueError):g.read_recent_photo('Guest',10000)

if __name__=='__main__':unittest.main()
