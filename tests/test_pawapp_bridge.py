"""Regression for the real /apps versus legacy /plugin loading mismatch."""

import asyncio
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import types
import unittest
from unittest import mock

from fastapi import FastAPI
from fastapi.testclient import TestClient

OPS = Path(__file__).resolve().parents[1] / 'world' / 'ops'
sys.path.insert(0, str(OPS))
import pawapp_bridge as bridge
import install_pawapps


class PackageTests(unittest.TestCase):
    def test_manifest_and_package_keep_data_and_declare_backend(self):
        manifest = bridge.build_manifest('evolution-board', '看板', '只读', '📈',
                                         backend=True)
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp) / 'evolution-board'
            folder.mkdir()
            previous = b'{"historical":true}'
            (folder / 'board.json').write_bytes(previous)
            result = bridge.install_pawapp(folder, manifest, '<html>board</html>',
                                           backend_source=bridge.EVOLUTION_BOARD_BACKEND)
            self.assertEqual(json.loads((folder / 'plugin.json').read_text('utf-8')), manifest)
            self.assertEqual((folder / 'board.json').read_bytes(), previous)
            self.assertEqual((folder / 'backend.py').read_text('utf-8'), bridge.EVOLUTION_BOARD_BACKEND)
            self.assertEqual(result['entry'], '/apps/evolution-board')
            self.assertFalse(result['runtimeLoaded'])

    def test_invalid_contract_is_rejected_before_writing(self):
        with self.assertRaises(ValueError):
            bridge.build_manifest('../bad', 'name', '', '')
        manifest = bridge.build_manifest('evolution-board', '看板', '', '', backend=True)
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp) / 'not-created'
            with self.assertRaisesRegex(ValueError, 'backend'):
                bridge.install_pawapp(folder, manifest, '')
            self.assertFalse(folder.exists())
            manifest = bridge.build_manifest('evolution-board', '看板', '', '')
            manifest['meta']['pawapp']['entry_page'] = '/plugin/evolution-board'
            with self.assertRaisesRegex(ValueError, 'canonical'):
                bridge.install_pawapp(folder, manifest, '')
            self.assertFalse(folder.exists())

    def test_gods_eye_preserves_viewer_origin_and_csp_contract(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(install_pawapps, 'PLUGINS', Path(tmp)):
            install_pawapps.install('gods-eye', install_pawapps.GODS_EYE_PLUGIN,
                                    install_pawapps.GODS_EYE_PAGE)
            folder = Path(tmp) / 'gods-eye'
            page = (folder / 'index.html').read_text('utf-8')
            self.assertIn('src="http://127.0.0.1:19092/"', page)
            self.assertIn('MC_CONSOLE_ORIGIN', page)
            self.assertEqual((folder / 'backend.py').read_text('utf-8'),
                             install_pawapps.GODS_EYE_BACKEND)
            self.assertNotIn('Content-Security-Policy', page)


@unittest.skipUnless(shutil.which('node'), 'Node is required to execute the generated frontend')
class FrontendTests(unittest.TestCase):
    def _run(self, app_id):
        js = bridge.build_frontend(app_id, '看板', '📈', priority=41)
        harness = r'''
const vm = require('node:vm');
const assert = require('node:assert/strict');
let routes = new Map(), menus = new Map(), scopes = [];
const host = {
  host: {React: {createElement:(tag,props,...children)=>({tag,props,children})},
         getApiUrl:path=>'/console-base/api'+path},
  paw: {forApp(id) {scopes.push(id); return {ui: {registerPage(page) {
    assert.equal(page.path,'/apps/'+id);
    routes.set('pawapp:'+id+':'+page.path,{...page,source:id});
  }}};}},
  route: {add(id,route){routes.set(route.id,{...route,source:id});}},
  menu: {add(id,item){menus.set(item.id,{...item,source:id});}}
};
const script = JSON.parse(process.argv[1]);
const appId = process.argv[2];
const context={window:{QwenPaw:host}};
vm.runInNewContext(script,context);
// The official loadPawApp checks source + /apps prefix + exact entry_page.
assert.ok([...routes.values()].some(r=>r.source===appId &&
  r.path.startsWith('/apps/') && r.path==='/apps/'+appId));
const page=routes.get('pawapp:'+appId+':/apps/'+appId);
const legacy=routes.get(appId+':legacy-page');
assert.equal(legacy.path,'/plugin/'+appId);
assert.equal(legacy.component,page.component);
const frame=page.component();
assert.equal(frame.tag,'iframe');
assert.equal(frame.props.src,'/console-base/api/pawapps/'+appId+'/static/index.html');
assert.equal(frame.props.referrerPolicy,'no-referrer');
assert.equal(menus.get(appId+':open-app').route,'pawapp:'+appId+':/apps/'+appId);
assert.deepEqual(scopes,[appId]);
vm.runInNewContext(script,context);
assert.equal(routes.size,2);
assert.equal(menus.size,1);
assert.throws(()=>vm.runInNewContext(script,{window:{}}), /SDK is unavailable/);
'''
        result = subprocess.run(['node', '-e', harness, json.dumps(js), app_id],
                                capture_output=True, text=True, encoding='utf-8')
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_both_apps_register_canonical_page_and_legacy_bookmark(self):
        for app_id in ('gods-eye', 'evolution-board'):
            with self.subTest(app_id=app_id):
                self._run(app_id)


class BackendTests(unittest.TestCase):
    def test_official_loader_discovers_both_apps_after_backend_upgrade(self):
        try:
            from qwenpaw.plugins.loader import PluginLoader
            from qwenpaw.plugins.registry import PluginRegistry
            from qwenpaw.app.routers.pawapps import _get_pawapps_from_registry
        except ImportError:
            self.skipTest('Official QwenPaw SDK is not installed')

        async def run(folder):
            # An independent registry, never the current host service singleton.
            registry = object.__new__(PluginRegistry)
            registry.__init__()
            loader = PluginLoader([folder])
            loader.registry = registry
            request = types.SimpleNamespace(app=types.SimpleNamespace(
                state=types.SimpleNamespace(plugin_registry=registry)))
            try:
                for app_id in ('evolution-board', 'gods-eye'):
                    manifest = bridge.build_manifest(app_id, app_id, '', '', backend=True)
                    bridge.install_pawapp(folder / app_id, manifest, '<html></html>',
                                           backend_source=bridge.build_static_backend(app_id, app_id))
                    await loader.load_plugin_from_path(folder / app_id)
                self.assertEqual({app['id'] for app in _get_pawapps_from_registry(request)},
                                 {'evolution-board', 'gods-eye'})
                for record in loader.get_all_loaded_plugins().values():
                    self.assertEqual(record.instance._tools, [])
                    self.assertEqual(record.instance._routers, [])
            finally:
                for app_id in list(loader.get_all_loaded_plugins()):
                    await loader.unload_plugin(app_id)

        with tempfile.TemporaryDirectory() as tmp:
            asyncio.run(run(Path(tmp)))

    def test_manifest_and_router_with_installed_official_sdk(self):
        try:
            from qwenpaw.pawapp import PawApp
            from qwenpaw.plugins.architecture import PluginManifest
        except ImportError:
            self.skipTest('Official QwenPaw SDK is not installed')
        manifest = bridge.build_manifest('evolution-board', '看板', '只读', '📈',
                                         backend=True)
        parsed = PluginManifest.model_validate(manifest)
        self.assertEqual(parsed.entry.backend, 'backend.py')
        self.assertEqual(parsed.entry.frontend, 'ui/index.js')
        projection = types.SimpleNamespace(build_live_board=lambda: {'roles': ['active']})
        loader = types.SimpleNamespace(exec_module=mock.Mock())
        with mock.patch.object(importlib.util, 'spec_from_file_location',
                               return_value=types.SimpleNamespace(loader=loader)), \
                mock.patch.object(importlib.util, 'module_from_spec', return_value=projection), \
                mock.patch.object(sys, 'path', list(sys.path)):
            namespace = {}
            exec(compile(bridge.EVOLUTION_BOARD_BACKEND, 'backend.py', 'exec'), namespace)
        self.assertIsInstance(namespace['app'], PawApp)
        official_api = mock.Mock()
        namespace['app'].register(official_api)
        official_api.register_http_router.assert_called_once()
        args, kwargs = official_api.register_http_router.call_args
        self.assertEqual(kwargs['prefix'], '/evolution-board')
        app = FastAPI()
        app.include_router(args[0], prefix='/api' + kwargs['prefix'])
        paths = app.openapi()['paths']
        self.assertEqual(set(paths), {'/api/evolution-board/board'})
        self.assertEqual(set(paths['/api/evolution-board/board']), {'get'})
        with TestClient(app) as client:
            self.assertEqual(client.get('/api/evolution-board/board').json(), {'roles': ['active']})
            self.assertEqual(client.post('/api/evolution-board/chat').status_code, 404)

    def test_official_router_reads_fresh_projection_and_adds_no_actions(self):
        """Run the generated shim through FastAPI, without creating a Qwen agent."""
        registered = []

        class FakePawApp:
            def __init__(self, name, *, app_id):
                self.app_id = app_id

            def include_router(self, router):
                registered.append(router)

        pawapp = types.ModuleType('qwenpaw.pawapp')
        pawapp.PawApp = FakePawApp
        source_module = types.SimpleNamespace(build_live_board=mock.Mock(
            side_effect=[{'generatedAt': 1, 'roles': ['current']},
                         {'generatedAt': 2, 'roles': ['updated']}]))
        loader = types.SimpleNamespace(exec_module=mock.Mock())
        spec = types.SimpleNamespace(loader=loader)
        with mock.patch.dict(sys.modules, {'qwenpaw.pawapp': pawapp}), \
                mock.patch.object(importlib.util, 'spec_from_file_location', return_value=spec) as find, \
                mock.patch.object(importlib.util, 'module_from_spec', return_value=source_module), \
                mock.patch.object(sys, 'path', list(sys.path)):
            namespace = {}
            exec(compile(bridge.EVOLUTION_BOARD_BACKEND, 'backend.py', 'exec'), namespace)
        self.assertEqual(find.call_args.args[1].as_posix(), '/ops/evolution_policy.py')
        self.assertEqual(namespace['app'].app_id, 'evolution-board')
        self.assertEqual([(route.path, route.methods) for route in registered[0].routes],
                         [('/board', {'GET'})])
        app = FastAPI()
        app.include_router(registered[0], prefix='/api/evolution-board')
        with TestClient(app) as client:
            first = client.get('/api/evolution-board/board')
            second = client.get('/api/evolution-board/board')
            self.assertEqual(first.json()['roles'], ['current'])
            self.assertEqual(second.json()['roles'], ['updated'])
            self.assertEqual(first.headers['cache-control'], 'no-store')
            self.assertEqual(client.post('/api/evolution-board/board').status_code, 405)
            self.assertEqual(client.post('/api/evolution-board/chat').status_code, 404)
        self.assertEqual(source_module.build_live_board.call_count, 2)


if __name__ == '__main__':
    unittest.main()
