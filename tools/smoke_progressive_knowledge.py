"""Zero-model proof of Qwen's skill metadata -> body -> reference disclosure.

Runs a fixed synthetic skill inside a disposable, offline Qwen 2.2 container.
Only the receipt is written on the host; no production service or state changes.
"""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def container_check():
    import asyncio
    import importlib.metadata
    assert os.environ.get('QIANDENG_PROGRESSIVE_QA') == '1'
    sys.path.insert(0, '/ops')
    from agentscope.tool import Toolkit
    from agentscope.state import AgentState
    from qwenpaw.config.config import Config, AgentProfileConfig
    from qwenpaw.config.context import set_current_workspace_dir
    from qwenpaw.agents.skill_system.workspace_service import SkillService
    from qwenpaw.agents.skill_system.runtime_cache import load_runtime_skills
    from qwenpaw.agents.tools.file_io import read_file
    from native_role_capabilities import configure_native
    from native_tool_runtime import role_engine, check

    assert importlib.metadata.version('qwenpaw') == '2.2.0'
    base = Path('/state/work')
    assert not (base / 'config.json').exists() and not (base / 'workspaces').exists(), 'This smoke must run in an empty disposable tmpfs'
    folder = base / 'workspaces/mc-herald'; folder.mkdir(parents=True)
    config = Config(); config.security.skill_scanner.mode = 'block'
    (base / 'config.json').write_text(config.model_dump_json())
    profile = AgentProfileConfig(id='mc-herald', name='Knowledge QA', workspace_dir=str(folder))
    (folder / 'agent.json').write_text(json.dumps(configure_native(profile.model_dump(mode='json'), 'mc-herald')))
    set_current_workspace_dir(folder)
    service = SkillService(folder)
    name = 'minecraft-knowledge-qa'
    body = ('---\nname: minecraft-knowledge-qa\ndescription: METADATA_ONLY_MARKER game knowledge lookup\n---\n'
        '# Knowledge index\nBODY_ONLY_MARKER\nRead references/crafting.md only when crafting is relevant.\n')
    references = {'crafting.md': 'REFERENCE_ONLY_MARKER\nCrafting guide fixture only.',
                  'recipes': {'sticks.json': '{"fixture":"RECIPE_ONLY_MARKER"}'}}
    assert service.create_skill(name, body, references=references, enable=True) == name
    row = next(s for s in service.list_available_skills() if s.name == name)
    assert row.references == {'crafting.md': None, 'recipes': {'sticks.json': None}}
    # save_skill changes the index, preserving the native references tree.
    reference_path = folder / 'skills' / name / 'references/crafting.md'
    before = reference_path.read_bytes()
    assert service.save_skill(skill_name=name, content=body + '\nUpdated index fixture.\n')['success'] is True
    assert reference_path.read_bytes() == before

    async def prove():
        toolkit = Toolkit(skills_or_loaders=load_runtime_skills([folder / 'skills' / name]))
        metadata = await toolkit.get_skill_instructions()
        assert 'METADATA_ONLY_MARKER' in metadata
        assert all(marker not in metadata for marker in ('BODY_ONLY_MARKER', 'REFERENCE_ONLY_MARKER', 'RECIPE_ONLY_MARKER'))
        schemas = await toolkit.get_tool_schemas()
        assert 'Skill' in {row['function']['name'] for row in schemas}
        viewer = toolkit.builtin_skill_viewer.tool
        detail = str(await viewer.call(skill=name, _agent_state=AgentState()))
        assert 'BODY_ONLY_MARKER' in detail and 'REFERENCE_ONLY_MARKER' not in detail and 'RECIPE_ONLY_MARKER' not in detail
        engine = role_engine('mc-herald', folder)
        reference = 'skills/' + name + '/references/crafting.md'
        assert check(engine, 'read_file', {'file_path': reference})
        assert not check(engine, 'read_file', {'file_path': '../mc-god/' + reference})
        content = str(await read_file(file_path=reference))
        assert 'REFERENCE_ONLY_MARKER' in content and 'RECIPE_ONLY_MARKER' not in content
        assert service.load_skill_file(name, 'references/recipes/sticks.json') == '{"fixture":"RECIPE_ONLY_MARKER"}'
        assert service.load_skill_file(name, '../agent.json') is None
        return {'ok': True, 'packageVersion': '2.2.0', 'modelRequests': 0, 'networkRequests': 0,
            'productionMutation': False, 'fixtureOnly': True, 'metadataChars': len(metadata), 'viewerTool': viewer.name,
            'checks': [{'name': item, 'ok': True} for item in (
                'metadata-only-default-context', 'native-Skill-tool-exposed', 'Skill-only-loads-index-body',
                'reference-tree-only-in-service-list', 'save-index-preserves-references',
                'own-role-reference-read-allowed', 'cross-role-reference-read-denied',
                'reference-loaded-on-demand', 'native-reference-api-traversal-denied')]}
    try:
        return asyncio.run(prove())
    finally:
        set_current_workspace_dir(None)


def run(image):
    command = ['docker', 'run', '--rm', '--pull', 'never', '--network', 'none', '--read-only',
        '--tmpfs', '/tmp', '--tmpfs', '/state', '--env', 'HOME=/tmp/knowledge-qa',
        '--env', 'QWENPAW_WORKING_DIR=/state/work', '--env', 'QIANDENG_PROGRESSIVE_QA=1',
        '--env', 'PYTHONDONTWRITEBYTECODE=1',
        '--mount', f'type=bind,source={ROOT / "world/ops"},target=/ops,readonly',
        '--mount', f'type=bind,source={Path(__file__).resolve()},target=/qa/smoke_progressive_knowledge.py,readonly',
        '--entrypoint', 'python', image, '/qa/smoke_progressive_knowledge.py', '--container-check']
    result = subprocess.run(command, capture_output=True, text=True, encoding='utf-8', errors='replace',
        timeout=60, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if result.returncode:
        raise RuntimeError('progressive_knowledge_qa_failed: ' + result.stderr[-2200:])
    lines = [line for line in result.stdout.splitlines() if line.startswith('{')]
    assert lines, 'Native QA returned no receipt'
    receipt = json.loads(lines[-1])
    assert receipt['ok'] is True and len(receipt['checks']) == 9
    receipt.update(schema=1, image=image, recordedAt=datetime.now(timezone.utc).isoformat(), sources={})
    for relative in ('tools/smoke_progressive_knowledge.py', 'world/ops/native_role_capabilities.py', 'world/ops/native_tool_runtime.py'):
        receipt['sources'][relative] = hashlib.sha256((ROOT / relative).read_bytes()).hexdigest()
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', default='qiandengji-qwenpaw-game:2.2.0-qd1')
    parser.add_argument('--report', type=Path, default=ROOT / 'reports/progressive-knowledge-smoke.json')
    parser.add_argument('--container-check', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.container_check:
        print(json.dumps(container_check(), ensure_ascii=False)); return
    report = args.report.resolve()
    assert report.is_relative_to((ROOT / 'reports').resolve()) and not report.is_symlink()
    receipt = run(args.image)
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(receipt, ensure_ascii=False))


if __name__ == '__main__':
    main()
