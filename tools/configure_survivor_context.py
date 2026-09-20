"""Preview/apply context protocol 2 at an idle boundary; preserve identity/history.

Requires the updated runtime adapter already loaded. Does not stop, resume or
retry any task. All model/profile/budget choices remain in their existing files.
"""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'world/survival'), str(ROOT / 'world/sidecar'), str(ROOT / 'world/ops')]
from numen_gateway import read_json, write_json
from configure_sao_characters import require_idle, workspace_file


def context_paragraph(text):
    paragraphs = text.split('\n\n')
    matches = [p for p in paragraphs if p.startswith('你有一个持久生活主会话。')
               or p.startswith('你保留持久生活身份、人格、笔记与伙伴接收地址。')]
    if len(matches) != 1:
        raise ValueError('survivor_session_paragraph_changed')
    return matches[0]


def configure(root, apply=False):
    state = root / 'server/survival-agent-state/survival'
    path = state / 'settings.json'
    before = read_json(path)
    if before.get('contextProtocol', 1) not in (1, 2):
        raise ValueError('unknown_survivor_context_protocol')
    result = {'before': before.get('contextProtocol', 1), 'after': 2,
              'applied': False, 'modelCalls': 0, 'historyDeleted': False}
    if not apply:
        return result
    require_idle('qd-survivor', root=root)
    marker = read_json(root / 'server/agents/work/learning-runtime.json')
    if marker.get('survivalRequestRuntimeVersion') != 2:
        raise ValueError('updated_qwen_context_adapter_not_loaded')
    current = workspace_file('qd-survivor', 'AGENTS.md')
    source = (ROOT / 'world/survival/AGENT.md').read_text(encoding='utf-8')
    target = context_paragraph(source)
    delta = next(p for p in source.split('\n\n') if p.startswith('增量输入的 updates '))
    original = current['content']
    updated = original.replace(context_paragraph(original), target, 1)
    if delta not in updated:
        updated = updated.replace(target, target + '\n\n' + delta, 1)
    backup = root / 'runtime/survivor-context' / datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    write_json(backup / 'settings-before.json', before)
    write_json(backup / 'agent-file-before.json', current)
    if read_json(path) != before:
        raise ValueError('survivor_settings_changed')
    if updated != original:
        workspace_file('qd-survivor', 'AGENTS.md', updated, current['etag'])
        if workspace_file('qd-survivor', 'AGENTS.md')['content'] != updated:
            raise ValueError('survivor_prompt_readback_mismatch')
    write_json(path, {**before, 'contextProtocol': 2})
    if read_json(path) != {**before, 'contextProtocol': 2}:
        raise ValueError('survivor_settings_readback_mismatch')
    result.update(applied=True, backup=str(backup))
    write_json(backup / 'result.json', result)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    print(json.dumps(configure(args.root.resolve(), args.apply), ensure_ascii=False))
