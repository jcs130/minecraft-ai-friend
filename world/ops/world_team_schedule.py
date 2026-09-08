"""Native Qwen role cycles, using its persistent cron sessions and existing process."""
from datetime import datetime
from pathlib import Path
import hashlib
import json
import time
from zoneinfo import ZoneInfo
from world_team import TeamStore, digest
from world_team_hosts import ENGINEER, SOURCE, logical_actor, native_host, require_host

SCHEDULES = {
    'game:mc-god': ('qd-team-goddess', '女神 · 世界巡查与问题处理', '1-59/10 * * * *'),
    'operations:mc-god': ('qd-team-engineer', '天神 · 工程改进与验收', '5-59/10 * * * *'),
    'game:qd-guild-planner': ('qd-team-designer', '公会 · 剧情与活动策划', '3,33 * * * *'),
}
PROMPTS = {
    'game:mc-god': '执行一次世界管理员班次。使用team_context和team_cases读取新鲜事实与未结问题，按需读具体工单。'
        '主动关注玩家和桐人内测反馈、服务异常、公会内容。你可用world_admin工具执行已授权的服务器管理，必须查真实回执；'
        '代码问题通过team_update交给operations:mc-god，内容问题交给game:qd-guild-planner。检查待发布活动并用world_content工具核对/批准。'
        '选择本轮最有价值的一项处理，已有同类问题补充证据，不重复开单。候选代码、内容已排队与实际生效分别验收。'
        '将本轮事实、判断、未确认事项和下一点记入自己的memory/YYYY-MM-DD.md，长期方向保持。',
    'operations:mc-god': '执行一次世界工程师班次。先读team_context、team_cases与一项已分给自己的具体工单。'
        '使用engineering_status/diff确认独立源码；通过Qwen原生文件工具读取和修改engineering/repo/内真实代码。'
        '选择最小可验证改进，运行engineering_test并通过engineering_test_status收取真实隔离测试结果；'
        '测试未完则记录job_id等待下次班次，不在模型里循环轮询。只有源码与通过测试的快照一致才engineering_commit。'
        '以commit、测试回执和剩余部署要求更新工单为needs_review，不把本地提交当线上生效。'
        '不擅自改工程受管元数据、测试基线或权限。记录发现与下一验收点至自己的memory/YYYY-MM-DD.md。',
    'game:qd-guild-planner': '执行一次游戏策划班次。读取team_context、分配的工单和world_content_context，结合在线公会人物与真实合同，'
        '设计有缘由、目标、阶段与结局的小型剧情或活动。可按需查官方技能、玩法参考和剧情顾问的投稿；不要重复已经存在的活动。'
        '用world_content_submit提交可验证内容包，交给女神检查发布；候选、已批准、实际发布和玩家完成分别记录。'
        'Boss/宝箱能力若blocked，写明具体缺口并用team_report交工程团队补齐，不能重新打开旧的错误结算或伪造放置成功。'
        '只推进一个有价值的内容改进，并将设计取舍与反馈写入自己的memory/YYYY-MM-DD.md。',
}


def team_job(actor):
    job_id, name, cron = SCHEDULES[actor]
    runtime, role = actor.split(':', 1)
    prompt = PROMPTS[actor]
    spec = {'id': job_id, 'name': name, 'enabled': True,
        'schedule': {'type': 'cron', 'cron': cron, 'timezone': 'Asia/Shanghai'},
        'task_type': 'agent', 'text': prompt,
        'request': {'input': [{'role': 'user', 'content': [{'type': 'text', 'text': prompt}]}]},
        'dispatch': {'type': 'channel', 'channel': 'console', 'target': {
            'user_id': 'qiandeng-world-team', 'session_id': 'world-team-' + actor.replace(':', '-')},
            'mode': 'final', 'silent': True},
        'runtime': {'max_concurrency': 1, 'timeout_seconds': 360, 'misfire_grace_seconds': 90,
                    'share_session': False, 'tool_safety': True},
        'save_result_to_inbox': False,
        'meta': {'project': 'qiandengji', 'purpose': 'world-team', 'runtime': runtime, 'role': role, 'version': 1}}
    host = native_host(actor)
    if actor == ENGINEER and host != SOURCE:
        spec['meta']['nativeHost'] = host
    return spec


def is_team_job(job_id):
    return job_id in {value[0] for value in SCHEDULES.values()}


def validate_team_job(value, actor):
    expected = team_job(actor)
    for key in ('id', 'name', 'task_type', 'text', 'meta', 'save_result_to_inbox'):
        assert value.get(key) == expected[key], 'team_cron_drift:' + key
    assert type(value['enabled']) is bool
    for key in ('schedule', 'runtime', 'dispatch'):
        assert all(value[key].get(k) == v for k, v in expected[key].items()), 'team_cron_drift:' + key
    assert value['request']['input'] == expected['request']['input']


def fingerprint(store):
    work, pending = store.work_fingerprint()
    material = {'work': work}
    if store.actor == 'game:qd-guild-planner':
        material['day'] = datetime.now(ZoneInfo('Asia/Shanghai')).date().isoformat()
    if store.actor == 'operations:mc-god':
        receipt_root = Path('/engineering/receipts')
        material['tests'] = [[p.name, p.stat().st_mtime_ns, p.stat().st_size]
                             for p in sorted(receipt_root.glob('*.json'))[-100:] if not p.is_symlink()]
    return digest(material), pending


async def execute(executor, job, original, runtime):
    import asyncio
    import fcntl
    native_role = executor._workspace.agent_id
    actor = logical_actor(runtime, native_role)
    if actor not in SCHEDULES:
        return {'task_type': 'agent', 'run_id': None, 'delivery_status': 'suppressed',
                'final_text': 'team_native_host_inactive', 'modelCalls': 0}
    validate_team_job(job.model_dump(mode='json', exclude_none=True), actor)
    store = TeamStore(actor)
    store.root.mkdir(parents=True, exist_ok=True)
    lock_path = store.root / ('cycle-' + actor.replace(':', '-') + '.lock')
    if lock_path.is_symlink(): raise ValueError('linked_team_cycle')
    def skipped(reason):
        return {'task_type': 'agent', 'run_id': None, 'delivery_status': 'suppressed',
                'final_text': reason, 'modelCalls': 0}
    with lock_path.open('a+b') as lock:
        try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError: return skipped('team_cycle_already_running')
        require_host(actor, runtime, native_role)
        current, pending = fingerprint(store)
        previous = store.cycle_state()
        if actor == 'operations:mc-god' and not pending:
            return skipped('no_assigned_engineering_work')
        if actor != 'game:mc-god' and previous and previous['fingerprint'] == current:
            actionable = actor == 'operations:mc-god' and any(
                row['status'] in ('open', 'working') for row in store.cases(limit=30)['cases'])
            if not actionable: return skipped('no_new_team_work')
        # Previous uncertain work is not replayed just because another timer fired.
        if previous and previous['status'] in ('running', 'unknown'):
            return skipped('previous_team_cycle_requires_reconciliation')
        reservation = None
        if actor.startswith('operations:'):
            from operations_native_tasks import reserve_operation, finish_run
            reservation = await asyncio.to_thread(reserve_operation, actor.split(':', 1)[1], job.id)
            if not reservation['ok']: return skipped(reservation['code'])
        store.save_cycle(current, 'running', {'jobId': job.id})
        try:
            require_host(actor, runtime, native_role)
            result = await original(executor, job)
            if result.get('delivery_status') in ('failed', 'error', 'no_content'):
                store.save_cycle(current, 'failed', result)
            else:
                # A report/test receipt arriving during this query may never
                # have entered its context. Only acknowledge the input waterline.
                store.save_cycle(current, 'completed', result)
            if reservation:
                terminal = 'failed' if result.get('delivery_status') in ('failed', 'error', 'no_content') else 'completed'
                await asyncio.to_thread(finish_run, reservation['runId'], terminal, jobId=job.id)
            return result
        except asyncio.TimeoutError:
            # CronExecutor's wait_for has awaited stream cancellation before
            # raising this known terminal. World action uncertainty remains in
            # its separate receipt ledger; a future inspection may report it.
            store.save_cycle(current, 'failed', {'jobId': job.id, 'nativeTimeoutConfirmed': True})
            if reservation:
                await asyncio.to_thread(finish_run, reservation['runId'], 'failed', nativeTimeoutConfirmed=True)
            raise
        except BaseException:
            store.save_cycle(current, 'unknown', {'jobId': job.id, 'retryAutomatically': False})
            raise
