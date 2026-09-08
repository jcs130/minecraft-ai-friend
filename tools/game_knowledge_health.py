"""Read-only native skill/reference and recipe-tool readiness; no model task."""
import json
from pathlib import Path
import sys
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/ops'))
from role_learning_profiles import GAME_ROLES, maid_roles, skill_references

NAME = 'qd-minecraft-guide'


def get(route, role):
    request = urllib.request.Request('http://127.0.0.1:18089/api' + route, headers={'X-Agent-Id': role})
    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request, timeout=8) as response:
        raw = response.read(262145)
    assert len(raw) <= 262144
    return json.loads(raw)


def check(root=ROOT, request=get):
    root = Path(root)
    references = skill_references(NAME, root / 'world/ops')
    expected = set(GAME_ROLES) | set(maid_roles(root / 'server/mcdata/village/maid-agents/public/roles.json'))
    assert len(references) == 8
    roles = []
    for role in sorted(expected):
        skills = request('/skills', role)
        row = next(s for s in skills if s['name'] == NAME)
        assert row['enabled'] is True and 'all' in row['channels']
        folder = root / 'server/agents/work/workspaces' / role
        assert skill_references(NAME, folder) == references
        # Exercise Qwen's real file route, not only files on disk.
        page = request('/skills/' + NAME + '/files/references/crafting.md', role)
        assert page['content'] == references['crafting.md']
        roles.append({'role': role, 'enabled': True, 'referencePages': len(references), 'nativeFileApi': True})
    tools = request('/mcp/tools/numen_survival', 'qd-survivor')
    recipe = next(t for t in tools if t['name'] == 'lookup_recipe')
    assert recipe['enabled'] is True and set(recipe['input_schema']['required']) == {'item_id'}
    return {'ok': True, 'roles': roles, 'recipeToolReady': True, 'modelRequests': 0,
            'scope': 'Native skill and reference API readiness; recipe-query semantics and model selection tested separately.'}


if __name__ == '__main__':
    print(json.dumps(check(), ensure_ascii=False))
