"""Qwen's native cron sends a review signal to the existing life controller.

This adapter never runs a model or a body action. Qwen owns the timer; the
survivor consumes the signal at its normal, durable life-session boundary.
"""
import asyncio
import json
from pathlib import Path
import time

from agent_learning import write

ROLE = 'qd-survivor'
JOB_ID = 'qd-life-review-qd-survivor'
TEXT = '检查桐人的长期成长目标与新经历；向原生活会话合并一次休息和学习复盘，不中断当前行动。'


def managed_job():
    return {'id': JOB_ID, 'name': '桐人 · 每10分钟成长复盘', 'enabled': True,
        'schedule': {'type': 'cron', 'cron': '*/10 * * * *', 'timezone': 'Asia/Shanghai'},
        'task_type': 'text', 'text': TEXT,
        'dispatch': {'type': 'channel', 'channel': 'console',
            'target': {'user_id': 'survival-controller', 'session_id': JOB_ID},
            'mode': 'final', 'silent': False},
        'runtime': {'max_concurrency': 1, 'timeout_seconds': 30,
            'misfire_grace_seconds': 60, 'share_session': False, 'tool_safety': True},
        'save_result_to_inbox': False,
        'meta': {'project': 'qiandengji', 'purpose': 'life-review-signal', 'version': 1}}


def validate_job(value, role):
    expected = managed_job()
    assert role == ROLE and value['id'] == JOB_ID
    assert type(value['enabled']) is bool
    # The native page may pause the job or choose five minutes instead of ten.
    schedule = value['schedule']
    assert schedule.get('type') == 'cron' and schedule.get('timezone') == 'Asia/Shanghai'
    assert schedule.get('cron') in ('*/5 * * * *', '*/10 * * * *')
    for key in ('task_type', 'text', 'meta', 'save_result_to_inbox'):
        assert value[key] == expected[key]
    for key in ('dispatch', 'runtime'):
        assert all(value[key].get(k) == v for k, v in expected[key].items())
    assert not value.get('request')


async def request_review(request_id):
    from mcp import ClientSession
    from mcp.client.streamable_http import streamablehttp_client
    token = Path('/run/secrets/survivor-mcp').read_text(encoding='ascii').strip()
    assert 32 <= len(token) <= 256 and not any(c.isspace() for c in token)
    async with streamablehttp_client('http://survivor:8089/mcp',
            headers={'Authorization': 'Bearer ' + token}) as streams:
        async with ClientSession(streams[0], streams[1]) as session:
            await session.initialize()
            result = await session.call_tool('request_review',
                {'request_id': request_id, 'reason': 'scheduled'})
            if result.isError:
                raise RuntimeError('life_review_signal_rejected')
            value = result.structuredContent
            if not isinstance(value, dict):
                value = json.loads(next(row.text for row in result.content if row.type == 'text'))
            if value.get('ok') is not True:
                raise RuntimeError('life_review_signal_not_accepted')
            return {key: value[key] for key in ('ok', 'code', 'reviewId', 'coalesced') if key in value}


async def execute(executor, job, send=request_review, clock=time.time):
    role = executor._workspace.agent_id
    value = job.model_dump(mode='json', exclude_none=True)
    validate_job(value, role)
    interval = 300 if value['schedule']['cron'].startswith('*/5 ') else 600
    request_id = JOB_ID + ':' + str(interval) + ':' + str(int(clock() // interval))
    record = {'schema': 1, 'jobId': JOB_ID, 'role': role, 'at': clock(),
              'requestId': request_id, 'modelCalls': 0, 'worldActions': 0}
    folder = Path(executor._workspace.workspace_dir) / 'life-review'
    # No local retry after uncertain transport; receiver coalesces future ticks.
    try:
        result = await asyncio.wait_for(send(request_id), timeout=20)
        record.update(status='signal_accepted', result=result)
        return {'task_type': 'text', 'run_id': None, 'delivery_status': 'suppressed',
            'final_text': '复盘信号已送入原生活会话，等待行动边界处理。', 'qiandeng': record}
    except BaseException:
        record.update(status='signal_unknown_or_failed', retryAutomatically=False)
        raise
    finally:
        write(folder / 'last-cron.json', record)
