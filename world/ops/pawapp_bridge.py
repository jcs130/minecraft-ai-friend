"""Small PawApp package builders for the official QwenPaw 2.2.1 SDK.

Writing a package does not hot-load its backend. Installation/reinstallation
uses QwenPaw's authenticated plugin API; this module never calls that API.
"""

import json
from pathlib import Path
import re


def _app_id(value):
    if not isinstance(value, str) or not re.fullmatch(r'[a-z0-9][a-z0-9-]*', value):
        raise ValueError('PawApp id must use lowercase letters, digits and hyphens')
    return value


def build_manifest(app_id, name, description, icon, *, backend=False,
                   version='1.1.0'):
    """Declare the same canonical page registered by ``build_frontend``."""
    app_id = _app_id(app_id)
    entry = {'frontend': 'ui/index.js'}
    if backend:
        entry['backend'] = 'backend.py'
    return {
        'id': app_id, 'name': name, 'version': version,
        'description': description, 'type': 'app',
        'qwenpaw_version': {'min': '2.2.1', 'max': '2.3.0'},
        'entry': entry,
        'meta': {'pawapp': {'category': 'monitor', 'icon': icon,
                            'entry_page': f'/apps/{app_id}',
                            'launch_scope': 'page'}, 'settings': []},
    }


def build_frontend(app_id, name, icon, *, priority=40):
    """Register the App Center page, a sidebar link and the old bookmark.

    The iframe stays same-origin. Its scripts can use the host's scoped
    ``parent.QwenPaw.paw.forApp(id).api`` without copying bearer credentials.
    """
    app_id = _app_id(app_id)
    config = json.dumps({'id': app_id, 'name': name, 'icon': icon,
                         'priority': priority}, ensure_ascii=False)
    return r'''/* Official QwenPaw PawApp SDK; no bundled React or host patches. */
(function () {
  "use strict";
  const config = __CONFIG__;
  const host = window.QwenPaw;
  if (!host || !host.host || !host.paw || !host.route || !host.menu) {
    throw new Error(config.id + ": QwenPaw 2.2.1 PawApp SDK is unavailable");
  }
  const React = host.host.React;
  const path = "/apps/" + config.id;
  const routeId = "pawapp:" + config.id + ":" + path;
  function Page() {
    return React.createElement("iframe", {
      src: host.host.getApiUrl("/pawapps/" + config.id + "/static/index.html"),
      title: config.name,
      referrerPolicy: "no-referrer",
      style: {width: "100%", height: "calc(100vh - 140px)", border: 0,
              borderRadius: 12, background: "#0b0d11"}
    });
  }
  host.paw.forApp(config.id).ui.registerPage({path, label: config.name,
    icon: config.icon, priority: config.priority, component: Page});
  host.route.add(config.id, {id: config.id + ":legacy-page",
    path: "/plugin/" + config.id, component: Page});
  host.menu.add(config.id, {id: config.id + ":open-app",
    location: "primary.settings", label: config.name,
    icon: React.createElement("span", {style: {fontSize: 16}}, config.icon),
    route: routeId, order: config.priority});
})();
'''.replace('__CONFIG__', config)


def build_static_backend(app_id, name):
    """Register a UI-only PawApp manifest without adding backend capabilities.

    QwenPaw 2.2.1's preferred app discovery uses the backend plugin registry.
    A frontend-only package disappears from that list when another app has a
    backend. Exporting the official PawApp object registers the manifest too.
    """
    app_id = _app_id(app_id)
    return ('"""Official PawApp registration; no routes, tools or services."""\n'
            'from qwenpaw.pawapp import PawApp\n\n'
            f'app = PawApp({name!r}, app_id={app_id!r})\n')


# App-scoped GET only. Standard chat/storage capabilities, agent tools and
# lifecycle services are deliberately not enabled by this read-only package.
EVOLUTION_BOARD_BACKEND = '''"""Live read-only projection inside the official PawApp runtime."""
import importlib.util
import sys
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from qwenpaw.pawapp import PawApp

# Fixed trusted project code; no request-controlled import or filesystem path.
OPS = Path('/ops')
if str(OPS) not in sys.path:
    sys.path.append(str(OPS))
spec = importlib.util.spec_from_file_location(
    '_qiandengji_evolution_board', OPS / 'evolution_policy.py')
if spec is None or spec.loader is None:
    raise RuntimeError('Evolution board project module is unavailable')
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)

app = PawApp('自我改进看板', app_id='evolution-board')
router = APIRouter()

@router.get('/board')
def board():
    return JSONResponse(policy.build_live_board(),
                        headers={'Cache-Control': 'no-store'})

app.include_router(router)
'''


def install_pawapp(folder, manifest, page, *, backend_source=None, priority=40):
    """Write reviewed package assets; preserve unrelated app data files."""
    folder = Path(folder)
    app_id = _app_id(manifest['id'])
    if manifest['entry'].get('backend') != ('backend.py' if backend_source else None):
        raise ValueError('Manifest backend entry must match supplied backend source')
    if manifest['meta']['pawapp']['entry_page'] != f'/apps/{app_id}':
        raise ValueError('Manifest page must match the canonical PawApp route')
    folder.mkdir(parents=True, exist_ok=True)
    (folder / 'ui').mkdir(exist_ok=True)
    (folder / 'index.html').write_text(page, encoding='utf-8')
    (folder / 'ui' / 'index.js').write_text(build_frontend(
        app_id, manifest['name'], manifest['meta']['pawapp']['icon'],
        priority=priority), encoding='utf-8')
    if backend_source is not None:
        (folder / 'backend.py').write_text(backend_source, encoding='utf-8')
    (folder / 'plugin.json').write_text(
        json.dumps(manifest, ensure_ascii=False, indent=1), encoding='utf-8')
    return {'appId': app_id, 'dir': str(folder),
            'entry': f'/apps/{app_id}',
            'staticEntry': f'/api/pawapps/{app_id}/static/index.html',
            'runtimeLoaded': False}
