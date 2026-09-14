"""Native Qwen timer publishes one coalescing life signal; never runs a model."""
import json
from pathlib import Path
import time

from agent_learning import locked, read, write
from party_role_capabilities import YUI_AGENT_ID, is_bound_yui, party_members

ROLE = YUI_AGENT_ID
JOB_ID = 'qd-life-review-' + ROLE
SIGNALS = Path('/team/party-life')
INTERVAL_SECONDS = 180
TEXT = '让结衣在原生活会话继续观察、照顾自己、与桐人协作和总结学习；等待当前任务结束，不强制聊天。'


def managed_job():
    return {'id': JOB_ID, 'name': '结衣 · 每3分钟自主生活', 'enabled': True,
        'schedule': {'type': 'cron', 'cron': '1-58/3 * * * *', 'timezone': 'Asia/Shanghai'},
        'task_type': 'text', 'text': TEXT,
        'dispatch': {'type': 'channel', 'channel': 'console',
            'target': {'user_id': 'party-life-controller', 'session_id': JOB_ID},
            'mode': 'final', 'silent': False},
        'runtime': {'max_concurrency': 1, 'timeout_seconds': 30,
            'misfire_grace_seconds': 60, 'share_session': False, 'tool_safety': True},
        'save_result_to_inbox': False,
        'meta': {'project': 'qiandengji', 'purpose': 'party-life-signal', 'version': 1}}


def validate_job(value, role):
    expected = managed_job()
    assert role == ROLE and value['id'] == JOB_ID
    assert type(value['enabled']) is bool
    for key in ('task_type', 'text', 'meta', 'save_result_to_inbox'):
        assert value[key] == expected[key]
    for key in ('schedule', 'dispatch', 'runtime'):
        assert all(value[key].get(k) == v for k, v in expected[key].items())
    assert not value.get('request')


def slot_epoch(slot, slot_seconds=600):
    """Compare the original ten-minute and current three-minute slots in time."""
    if (type(slot) is not int or slot < -1 or type(slot_seconds) is not int
            or slot_seconds not in (600, INTERVAL_SECONDS)):
        raise ValueError('party_life_signal_invalid')
    return slot * slot_seconds


def publish_signal(role, *, root=SIGNALS, now=None, members=None):
    if role != ROLE or not is_bound_yui('game:' + role):
        raise ValueError('party_life_identity_not_bound')
    roster = list(party_members()) if members is None else members
    now = time.time() if now is None else now
    slot = int(now // INTERVAL_SECONDS)
    value = {'schema': 1, 'role': role, 'jobId': JOB_ID,
             'requestId': JOB_ID + ':' + str(INTERVAL_SECONDS) + ':' + str(slot),
             'slot': slot, 'slotSeconds': INTERVAL_SECONDS,
             'scheduledAt': now, 'members': roster}
    folder = Path(root) / role
    with locked(folder):
        path = folder / 'latest-signal.json'
        previous = read(path) if path.exists() else None
        if previous and slot_epoch(previous.get('slot', -1), previous.get('slotSeconds', 600)) >= slot_epoch(
                slot, INTERVAL_SECONDS):
            if previous.get('members') != roster or previous.get('role') != role:
                raise ValueError('party_life_signal_binding_changed')
            return previous | {'coalesced': True}
        write(path, value)
    return value | {'coalesced': previous is not None}


async def execute(executor, job, *, publish=publish_signal, clock=time.time):
    role = executor._workspace.agent_id
    validate_job(job.model_dump(mode='json', exclude_none=True), role)
    value = publish(role, now=clock())
    record = {'schema': 1, 'jobId': JOB_ID, 'role': role, 'at': clock(),
              'requestId': value['requestId'], 'status': 'signal_accepted',
              'coalesced': value['coalesced'], 'modelCalls': 0, 'worldActions': 0}
    write(Path(executor._workspace.workspace_dir) / 'life-review/last-cron.json', record)
    return {'task_type': 'text', 'run_id': None, 'delivery_status': 'suppressed',
            'final_text': '自主生活信号已送入结衣原会话，等待当前任务边界。', 'qiandeng': record}
