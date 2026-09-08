"""Short real-model tests against this container only; never sends requests to Minecraft."""
import asyncio
from datetime import datetime, timezone
import json
from pathlib import Path
import time
import uuid

import httpx


async def test_agent(aid, token):
    began = time.monotonic()
    result = {'id': aid, 'ok': False, 'completed': False, 'httpStatus': None}
    payload = {'channel': 'console', 'user_id': 'qiandengji-smoke',
        'session_id': 'qiandengji-qa-' + str(uuid.uuid4()),
        'input': [{'role': 'user', 'content': [{'type': 'text', 'text':
            '这是千灯纪独立服务的连接测试。请只回复 JSON：{"ready":true}。'
            '不调用工具，不叙述任何已执行的游戏动作。'}]}]}
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(120, connect=10)) as client:
            async with client.stream('POST', 'http://127.0.0.1:8088/api/console/chat',
                    headers={'Authorization': f'Bearer {token}', 'X-Agent-Id': aid}, json=payload) as res:
                result['httpStatus'] = res.status_code
                res.raise_for_status()
                events, total_bytes = [], 0
                async for line in res.aiter_lines():
                    total_bytes += len(line.encode())
                    if total_bytes > 2 * 1024 * 1024: raise ValueError('Response limit')
                    if not line.startswith('data:'): continue
                    try: events.append(json.loads(line[5:].strip()))
                    except ValueError: pass
        result['completed'] = True
        messages, pending = [], {}
        error_events = 0
        for event in events:
            if event.get('type') in {'error', 'failed'} or event.get('object') == 'error': error_events += 1
            if event.get('object') == 'message' and event.get('type') == 'message':
                messages.append(event.get('id'))
            if event.get('object') == 'content' and isinstance(event.get('msg_id'), str):
                text = (event.get('data') or {}).get('text') or event.get('text') or ''
                if not isinstance(text, str): continue
                slot = pending.setdefault(event['msg_id'], {'delta': '', 'full': ''})
                if event.get('delta') is False: slot['full'] = text
                else: slot['delta'] += text
        last = pending.get(messages[-1], {}) if messages else {}
        answer = last.get('delta') or last.get('full') or ''
        result['finalAnswerCharacters'] = len(answer)
        result['errorEvents'] = error_events
        result['expectedReply'] = '"ready"' in answer and 'true' in answer.lower()
        result['ok'] = bool(answer) and result['expectedReply'] and not error_events
    except Exception as exc:
        result['errorType'] = type(exc).__name__
    result['elapsedSeconds'] = round(time.monotonic() - began, 1)
    return result


async def main():
    token = Path('/state/secret/console-token.txt').read_text().strip()
    async def bounded(aid):
        try: return await asyncio.wait_for(test_agent(aid, token), timeout=150)
        except TimeoutError: return {'id': aid, 'ok': False, 'completed': False, 'errorType': 'TotalTimeout'}
    results = await asyncio.gather(*(bounded(aid) for aid in ['mc-god', 'mc-herald']))
    report = {'project': 'qiandengji', 'kind': 'real-model',
              'finishedAt': datetime.now(timezone.utc).isoformat(),
              'ok': all(r['ok'] for r in results), 'agents': results, 'gameActions': 0}
    Path('/state/model-smoke-report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))
    return 0 if report['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(asyncio.run(main()))
