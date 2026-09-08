"""One optional read-only Qwen experiment; default only checks readiness.

Submit: --execute qiandengji. Collect later: --collect. A durable reservation
prevents a second POST, including after an unknown outcome. No model/provider
configuration, budgets, game actions or workspace files are changed by this
tool. Native Qwen necessarily saves the new QA conversation and token usage.
"""
from __future__ import annotations
import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import urllib.parse
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]
ROLE, CALLER, GUIDE = 'qd-survivor', 'knowledge-qa', 'qd-minecraft-guide'
ITEM = 'irons_spellbooks:arcane_ingot'
MARKER = Path('runtime/minecraft-knowledge-exercise.json')
REPORT = Path('reports/minecraft-knowledge-exercise.json')
READ_TOOLS = ('status', 'look', 'lookup_recipe', 'inspect_block', 'scan_blocks', 'inspect_container')
PROMPT = ('这是一次独立的只读玩法咨询，不改变你当前的自主生存目标。'
          '我想制作 irons_spellbooks:arcane_ingot：当前服务器的配方是什么？'
          '所需材料、材料是否具备以及制作设施应该怎样确认？'
          '请根据你能查到的当前资料和真实服务器信息作答，区分已经确认和仍未知的部分。'
          '按需要检索资料，避免整本阅读。此次只观察和查询，不执行游戏动作，'
          '不写文件、不改变任务或计划、不联系其他角色；查完直接回答。')
WORKFLOW_PROMPT = ('这是一次独立只读咨询，不改变你的生存目标。请依据本服已安装的玩法资料，'
    '说明桐人从查配方到成品入包的制作流程：什么工具目前能实际执行，何时才算制作成功，'
    '模组机器配方查不到和执行回执未知时各该怎么办？以 irons_spellbooks:arcane_ingot 为例核验当前配方。'
    '请注明你实际参考的资料，别仅凭通用 Minecraft 经验作答。只读必要的相关页面，不读取整套资料；'
    '不执行游戏动作，不写文件，不改任务或计划，不联系其他角色，查完直接回答。')

# Uses the installed request factory and its actual final-pass tool filter.
# This short-lived process builds data only; it does not invoke an Agent/model.
NATIVE_BUILD = r'''
import json,sys
from pathlib import Path
from types import SimpleNamespace
from qwenpaw.agents.tools.agent_management import build_agent_chat_request
from qwenpaw.drivers.handlers.mcp import _tool_namespace_from_display_name
from qwenpaw.runtime.builder import AgentBuilder
d=json.load(sys.stdin)
p=Path('/state/work/workspaces/qd-survivor/drivers/mcp/numen_survival.yaml')
card=json.loads(p.read_text())
namespace=_tool_namespace_from_display_name(card['config']['display_name'],fallback='numen_survival')
allowed=['Skill','read_file','get_current_time']+[namespace+'__'+n for n in d['readTools']]
session,payload,_=build_agent_chat_request('qd-survivor',d['prompt'],session_id=d['session'],from_agent='knowledge-qa')
payload['timeout']=180
payload['request_context']['subagent_allowed_tools']=allowed
names=allowed+['write_file','execute_shell_command',namespace+'__craft',namespace+'__move']
filtered=AgentBuilder.apply_subagent_tool_whitelist([SimpleNamespace(name=n) for n in names],payload['request_context'])
assert [t.name for t in filtered]==allowed
print(json.dumps({'payload':payload,'allowedTools':allowed,'nativeWhitelistVerified':True}))
'''


def require(value, code):
    if not value: raise ValueError(code)


def now():
    return datetime.now(timezone.utc).isoformat()


def read(path):
    path = Path(path)
    require(not any(p.is_symlink() or getattr(p, 'is_junction', lambda: False)()
                    for p in (path, *path.parents)), 'linked_evidence')
    require(path.stat().st_size <= 8 * 1024 * 1024, 'evidence_too_large')
    return json.loads(path.read_text(encoding='utf-8-sig'))


def save(path, data):
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    with temporary.open('x', encoding='utf-8') as stream:
        json.dump(data, stream, ensure_ascii=False, indent=2)
        stream.flush(); os.fsync(stream.fileno())
    temporary.replace(path)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs): raise ValueError('redirect_not_allowed')


def api(route, payload=None):
    require(route.startswith('/') and not route.startswith('//'), 'invalid_route')
    if payload is not None: require(route == '/console/chat/task', 'only_chat_submission_allowed')
    req = urllib.request.Request('http://127.0.0.1:18089/api' + route,
        data=None if payload is None else json.dumps(payload).encode(),
        headers={'X-Agent-Id': ROLE, 'Content-Type': 'application/json'})
    with urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect()).open(req, timeout=15) as response:
        raw = response.read(8 * 1024 * 1024 + 1)
    require(len(raw) <= 8 * 1024 * 1024, 'response_too_large')
    return json.loads(raw)


def usage(get=api):
    end = (datetime.now(timezone.utc) + timedelta(days=1)).date().isoformat()
    rows = get('/token-usage/details?start_date=1970-01-01&end_date=' + end)
    selected = [r for r in rows if r.get('agent_id') == ROLE]
    values = {}
    for key in ('call_count', 'prompt_tokens', 'completion_tokens'):
        require(all(type(r.get(key)) is int and r[key] >= 0 for r in selected), 'unknown_usage_field')
        values[key] = sum(r[key] for r in selected)
    return values


def protected(root):
    folder = root / 'server/survival-agent-state/survival'
    control, controller = read(folder / 'control.json'), read(folder / 'controller.json')
    return {'paused': control.get('enabled') is False, 'activeDecision': bool(controller.get('active')),
            'controlSha256': hashlib.sha256((folder / 'control.json').read_bytes()).hexdigest(),
            'decisionHistorySha256': hashlib.sha256(json.dumps(controller.get('decisions', []),
                sort_keys=True).encode()).hexdigest()}


def preflight(root=ROOT, get=api):
    state = protected(root)
    require(state['paused'] and not state['activeDecision'], 'survivor_must_be_paused_and_idle')
    require(get('/agents/' + ROLE + '/agent-status').get('running_task_count') == 0, 'role_busy')
    skills = get('/skills')
    require(any(s.get('name') == GUIDE and s.get('enabled') is True for s in skills), 'guide_not_enabled')
    tools = get('/mcp/tools/numen_survival')
    require(set(READ_TOOLS) <= {t.get('name') for t in tools if t.get('enabled') is True}, 'read_tools_not_ready')
    return {'ok': True, 'role': ROLE, 'guide': GUIDE, 'readTools': list(READ_TOOLS),
            'protectedBefore': state, 'usageBefore': usage(get), 'modelTasksSubmitted': 0}


def build(session):
    proc = subprocess.run(['docker', 'exec', '-i', 'qiandengji-qwenpaw-1', 'python', '-c', NATIVE_BUILD],
        input=json.dumps({'session': session, 'prompt': PROMPT, 'readTools': READ_TOOLS}),
        text=True, encoding='utf-8', capture_output=True, timeout=30,
        creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    require(proc.returncode == 0, 'native_request_build_failed')
    result = json.loads(proc.stdout.strip().splitlines()[-1])
    require(result.get('nativeWhitelistVerified') is True, 'native_readonly_filter_unverified')
    return result


def submit(root=ROOT, get=api, builder=build):
    marker_path = root / MARKER
    if marker_path.exists():
        marker = read(marker_path)
        return {'status': 'already_reserved_no_resubmit', 'taskId': marker.get('taskId'),
                'sessionId': marker.get('sessionId'), 'modelTasksSubmitted': 0}
    checks = preflight(root, get)
    session = 'knowledge-qa-' + uuid.uuid4().hex
    native = builder(session)
    marker = {**checks, 'schema': 1, 'sessionId': session, 'reservedAt': now(),
              'status': 'reserved', 'postAttempted': False, 'allowedTools': native['allowedTools'],
              'nativeWhitelistVerified': True, 'prompt': PROMPT,
              'sourceSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    marker_path.parent.mkdir(parents=True, exist_ok=True)
    # Exclusive durable reservation happens before the only possible paid POST.
    with marker_path.open('x', encoding='utf-8') as stream:
        json.dump(marker, stream, ensure_ascii=False); stream.flush(); os.fsync(stream.fileno())
    marker.update(postAttempted=True, status='submission_uncertain', submittedAt=now())
    save(marker_path, marker)
    try:
        reply = get('/console/chat/task', native['payload'])
        require(isinstance(reply.get('task_id'), str) and re.fullmatch(r'task-[a-zA-Z0-9_-]+', reply['task_id']), 'task_id_missing')
        marker.update(taskId=reply['task_id'], status='submitted', modelTasksSubmitted=1)
    except Exception as exc:
        marker['submissionErrorType'] = type(exc).__name__
    # Save task ID before any polling. Even an uncertain POST is never retried.
    save(marker_path, marker)
    return {'status': marker['status'], 'taskId': marker.get('taskId'), 'sessionId': session,
            'modelTasksSubmitted': marker.get('modelTasksSubmitted'), 'retryAutomatically': False}


def trace(history):
    """Only native protocol data, never tool names mentioned in model prose."""
    calls, outputs = [], {}
    for message in history.get('messages', []):
        kind = message.get('type')
        if kind not in ('plugin_call', 'plugin_call_output'): continue
        for part in message.get('content', []):
            data = part.get('data')
            if not isinstance(data, dict): continue
            if kind == 'plugin_call':
                args = data.get('arguments')
                if isinstance(args, str):
                    try: args = json.loads(args)
                    except ValueError: pass
                calls.append({'name': data.get('name'), 'callId': data.get('call_id'), 'arguments': args})
            elif data.get('call_id'):
                outputs[data['call_id']] = data
    for call in calls:
        output = outputs.get(call['callId'])
        call.update(outputPresent=output is not None,
                    toolState=output.get('state') if output else None,
                    output=output.get('output') if output else None)
    return calls


def collect(root=ROOT, get=api):
    marker = read(root / MARKER)
    task_id = marker.get('taskId')
    require(task_id and re.fullmatch(r'task-[a-zA-Z0-9_-]+', task_id), 'submission_unknown_do_not_retry')
    report_path = root / REPORT
    if report_path.exists():
        recorded = read(report_path)
        response = recorded.get('nativeTask', {}).get('result') or {}
        if recorded.get('taskId') == task_id and response.get('status') in ('completed', 'failed', 'cancelled'):
            # Preserve the terminal observation and its usage/state snapshot;
            # later reads must not attribute subsequent role activity to this QA.
            return collection_summary(recorded)
    task = get('/console/chat/task/' + task_id)
    chats = get('/chats?user_id=' + urllib.parse.quote(CALLER))
    selected = [c for c in chats if c.get('session_id') == marker['sessionId'] and c.get('user_id') == CALLER]
    require(len(selected) <= 1, 'qa_chat_ambiguous')
    history = get('/chats/' + urllib.parse.quote(selected[0]['id'], safe='')) if selected else {'messages': []}
    after = usage(get)
    calls = trace(history)
    delta = {k: after[k] - marker['usageBefore'][k] for k in after}
    response = task.get('result') if isinstance(task.get('result'), dict) else {}
    error = response.get('error') if isinstance(response.get('error'), dict) else {}
    result = {'schema': 1, 'collectedAt': now(), 'role': ROLE, 'taskId': task_id,
              'sessionId': marker['sessionId'], 'chatId': selected[0]['id'] if selected else None,
              'status': task.get('status'), 'responseStatus': response.get('status'),
              'completed': response.get('status') == 'completed' and not error,
              'errorCode': error.get('code'), 'nativeTask': task, 'history': history,
              'calls': calls, 'usageBefore': marker['usageBefore'], 'usageAfter': after, 'usageDelta': delta,
              'usageAttribution': 'role aggregate; controller paused, concurrent manual chats are not excluded',
              'protectedBefore': marker['protectedBefore'], 'protectedAfter': protected(root),
              'allowedTools': marker['allowedTools'], 'modelTasksSubmittedThisCollection': 0,
              'verification': 'Inspect matched native tool outputs and final answer; prose alone is not evidence.',
              'retryAutomatically': False}
    save(root / REPORT, result)
    return collection_summary(result)


def collection_summary(result):
    response = result.get('nativeTask', {}).get('result') or {}
    error = response.get('error') or {}
    return {k: result.get(k) for k in ('status', 'taskId', 'chatId', 'usageDelta')} | {
        'responseStatus': response.get('status'), 'completed': response.get('status') == 'completed' and not error,
        'errorCode': error.get('code'),
        'calls': [{k: c[k] for k in ('name', 'arguments', 'outputPresent', 'toolState')} for c in result['calls']],
        'report': str(REPORT), 'modelTasksSubmitted': 0}


def main():
    global PROMPT, MARKER, REPORT
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--execute', choices=['qiandengji'])
    mode.add_argument('--collect', action='store_true')
    parser.add_argument('--scenario', choices=['recipe', 'crafting-workflow', 'crafting-workflow-revised'], default='recipe',
                        help='Each explicit scenario has its own durable one-submission receipt')
    parser.add_argument('--run-label', help='Explicit new validation after a reviewed change; never overwrites earlier receipts')
    args = parser.parse_args()
    if args.scenario.startswith('crafting-workflow'):
        PROMPT = WORKFLOW_PROMPT
        suffix = '-revised' if args.scenario.endswith('-revised') else ''
        MARKER = Path('runtime/minecraft-knowledge-workflow' + suffix + '-exercise.json')
        REPORT = Path('reports/minecraft-knowledge-workflow' + suffix + '-exercise.json')
    if args.run_label:
        if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,31}', args.run_label):
            parser.error('run-label must contain 1–32 lowercase letters, digits or hyphens')
        MARKER = MARKER.with_stem(MARKER.stem + '-' + args.run_label)
        REPORT = REPORT.with_stem(REPORT.stem + '-' + args.run_label)
    try:
        value = submit() if args.execute else collect() if args.collect else preflight()
    except Exception as exc:
        print(json.dumps({'ok': False, 'errorType': type(exc).__name__,
                          'error': str(exc) if isinstance(exc, ValueError) else 'read_or_transport_failed',
                          'retryAutomatically': False}, ensure_ascii=False))
        return 1
    print(json.dumps(value, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
