"""One native daily operations shift; it requests the existing guild planner."""
from copy import deepcopy
from datetime import date, timedelta
import hashlib
import json
from pathlib import Path
import time

JOB_ID = 'qd-world-daily-default'
PROMPT = ('执行千灯纪每日运营班次。先用 operations_snapshot 和 operations_world_planning 读取实际新鲜证据。'
          '检查服务、玩家、NPC、公会；missing 不是死亡，不召唤或恢复角色。'
          '调用 operations_request_guild_plan 请求专业公会策划为次日拟定货单；已有计划应保留。'
          '读取回执，区分已排队、已有计划和真实发布。最后 submit_operations_report 记录至多3条事实与3条待办，'
          'request_id 使用 world-daily-加本地日期。不要委派其它模型任务，不修改身体、经济或世界；无证据不虚构繁荣。')


def world_job():
    return {'id': JOB_ID, 'name': '每日世界运营', 'enabled': True,
        'schedule': {'type': 'cron', 'cron': '10 9 * * *', 'timezone': 'Asia/Shanghai'},
        'task_type': 'agent', 'text': PROMPT,
        'request': {'input': [{'role': 'user', 'content': [{'type': 'text', 'text': PROMPT}]}]},
        'dispatch': {'type': 'channel', 'channel': 'console', 'target': {
            'user_id': 'qiandeng-world-operations', 'session_id': 'qd-world-operations'}, 'mode': 'final', 'silent': True},
        'runtime': {'max_concurrency': 1, 'timeout_seconds': 180, 'misfire_grace_seconds': 300,
                    'share_session': False, 'tool_safety': True},
        'save_result_to_inbox': False,
        'meta': {'project': 'qiandengji', 'purpose': 'world-operations', 'runtime': 'operations', 'role': 'default', 'version': 1}}


def is_world_job(job, role):
    return role == 'default' and str(job.id) == JOB_ID and job.meta == world_job()['meta']


def validate_world_job(actual, role):
    expected = world_job()
    assert role == 'default'
    for key in ('id', 'name', 'task_type', 'text', 'meta', 'save_result_to_inbox'):
        assert actual.get(key) == expected[key]
    assert type(actual.get('enabled')) is bool
    for key in ('schedule', 'runtime', 'dispatch'):
        assert all(actual[key].get(k) == v for k, v in expected[key].items())
    assert actual['request']['input'] == expected['request']['input']


class WorldPlanning:
    def __init__(self, public=Path('/public'), state=Path('/state/work/operations'), clock=time.time):
        self.public, self.state, self.clock = Path(public), Path(state), clock

    def context(self):
        from operations_team_mcp import read_json
        try:
            row = read_json(self.public/'world-planning.json', 65536)
            if row.get('schema') != 1 or not -5 <= self.clock()-row['updatedAt'] <= 90:
                raise ValueError('stale_context')
            return {'ok': True, **row}
        except (OSError, ValueError, KeyError, TypeError):
            return {'ok': False, 'code': 'world_planning_context_unavailable'}

    def request(self):
        context = self.context()
        if not context.get('ok'): return context
        day = context.get('nextDay')
        if not isinstance(day, str) or date.fromisoformat(context['today']) + timedelta(days=1) != date.fromisoformat(day):
            return {'ok': False, 'code': 'invalid_planning_day'}
        if context.get('existingPlan'):
            return {'ok': True, 'code': 'existing_plan_preserved', 'day': day, 'plan': context['existingPlan']}
        if not context.get('eligibleIssuers'):
            return {'ok': False, 'code': 'no_online_qualified_issuers'}
        row = {'schema': 1, 'project': 'qiandengji', 'purpose': 'guild-next-day', 'day': day,
               'requestId': 'world-guild-'+day, 'requestedAt': self.clock(),
               'eligibleIssuers': context['eligibleIssuers']}
        folder = self.state/'world-requests'
        folder.mkdir(parents=True, exist_ok=True)
        target = folder/(day+'.json')
        if any(p.is_symlink() for p in (target, *target.parents)): raise ValueError('linked_world_request')
        if target.exists():
            return {'ok': True, 'code': 'already_requested', 'day': day, 'receipt': context.get('receipt')}
        # Publish a complete immutable request atomically; only NPC owns receipt.
        import os, uuid
        temp = target.with_name(target.name+'.'+uuid.uuid4().hex+'.tmp')
        with temp.open('x', encoding='utf8') as out:
            json.dump(row, out, ensure_ascii=False); out.flush(); os.fsync(out.fileno())
        try: os.link(temp, target)
        except FileExistsError: pass
        finally: temp.unlink()
        return {'ok': True, 'code': 'requested', 'day': day, 'requestId': row['requestId'], 'worldActionsExecuted': 0}
