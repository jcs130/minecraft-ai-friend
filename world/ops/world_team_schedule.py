"""Native Qwen role cycles, using its persistent cron sessions and existing process."""
from datetime import datetime
from pathlib import Path
import hashlib
import json
import time
from zoneinfo import ZoneInfo
from world_team import TeamStore, digest
from world_team_hosts import logical_actor, migration_for, native_host, require_host
from engineering_cron_runtime import ACTOR as ENGINEER, POLICY as ENGINEERING_POLICY, execution_job

SCHEDULES = {
    'game:mc-god': ('qd-team-goddess', '女神 · 世界巡查与问题处理', '1-59/10 * * * *'),
    'operations:mc-god': ('qd-team-engineer', '天神 · 工程改进与验收', '5-59/10 * * * *'),
    'game:qd-guild-planner': ('qd-team-designer', '公会 · 剧情与活动策划', '3,33 * * * *'),
    # Migration alias: the engineer's native host is game/qd-engineer after the
    # single-QwenPaw consolidation, but its logical identity remains
    # operations:mc-god. execute() resolves the native id back through
    # logical_actor, so this entry only lets is_team_job and callers iterating
    # SCHEDULES find the job id; team_job resolves it to the same spec.
    'game:qd-engineer': ('qd-team-engineer', '天神 · 工程改进与验收', '5-59/10 * * * *'),
}
PROMPTS = {
    'game:mc-god': '执行一次世界管理员班次，本轮先完成一项最有价值的处理。读team_context和team_cases短索引，'
        '从新鲜玩家或桐人反馈、服务异常、待审工单、公会活动中自主选择一项；只展开选中的team_case，默认读最近3条事件，'
        '需要核实旧证据时才用next_before_seq向前分页，不先遍历全队工单、整段历史或源码。'
        '围绕这一项按需使用world_admin或world_content工具，并查询原请求的真实回执；未知或仍在途就记录原编号和下一核验点，'
        '不换编号重投。取得证据后及时用team_update更新原工单，新的真实问题才team_report；'
        '代码问题交operations:mc-god，内容问题交game:qd-guild-planner。候选代码、批准排队、实际生效和玩家完成分别验收。'
        '将该事项的事实、判断、未确认点简短记入自己的memory/YYYY-MM-DD.md，再给出简短本轮结论并结束；其他事项留给后续班次。'
        '治理谕（造物主2026-09-09）：时刻记得打造Agent-LLM自主驱动的体系，不是堆规则；验收看真实回执与角色自主闭环，优先给角色补证据和工具，而不是新增硬性断言。'
        '长期方向保持。',
    'operations:mc-god': '执行一次世界工程师班次，延续原会话和已落盘的进度。先读engineering_status().progress的最近测试与提交，'
        '再读team_context、team_cases与一项已分给自己的具体工单；已有job先看同一job回执，不因旧工单仍写blocked就重做已完成的测试。'
        '使用engineering_status/diff确认独立源码；通过Qwen原生文件工具读取和修改engineering/repo/内真实代码。'
        '每班只推进一个可交付步骤：接收通过回执并提交、修改并排队测试、或附证据交接。progress的passedFixedPlan是真实回执精简，可直接用其中sourceSha256交engineering_commit，'
        '它会重新核对当前全部字节，无需先做一次capture_source；若明确source_changed再查看相关差异并取新快照。'
        '选择最小可验证改进，运行engineering_test并通过engineering_test_status收取真实隔离测试结果；'
        '测试未完则记录job_id等待下次班次，不在模型里循环轮询。只有源码与通过测试的快照一致才engineering_commit。'
        '以commit、测试回执和剩余部署要求更新工单为needs_review，不把本地提交当线上生效。'
        '不擅自改工程受管元数据、测试基线或权限。服务诊断职责已并入：故障类工单先分析运行证据、复核恢复情况，'
        '区分过期巡检记录与当前故障，恢复结论以新鲜回执为准。'
        '工程谕（造物主2026-09-09）：时刻记得打造Agent-LLM自主驱动的体系，不是写一大堆规则；优先给角色可核实的工具与回执通道让模型自主判断行动，硬规则只收敛在安全与权限的最小边界。'
        '及时把本班工单、改动路径、job_id/sourceSha256/commit、尚未完成的一步追加到memory/YYYY-MM-DD.md；'
        '读记忆时只读相关末段，不每轮重读整天笔记和完整旧工单。本工程任务没有总时长截止，可以完整推理并完成当前交付步骤；'
        '持续保存进度，仍在执行时后续定时信号不叠加新的工程任务。',
    'game:qd-guild-planner': '执行一次游戏策划班次。读取team_context、分配的工单和world_content_context，结合在线公会人物与真实合同，'
        '设计有缘由、目标、阶段与结局的小型剧情或活动。可按需查官方技能与玩法参考；灶火祭司（剧情顾问）职责已并入，'
        '设计时自行核对原作设定一致性，不再等待独立顾问投稿；不要重复已经存在的活动。'
        '用world_content_submit提交可验证内容包，交给女神检查发布；候选、已批准、实际发布和玩家完成分别记录。'
        'Boss/宝箱能力若blocked，写明具体缺口并用team_report交工程团队补齐，不能重新打开旧的错误结算或伪造放置成功。'
        '只推进一个有价值的内容改进，并将设计取舍与反馈写入自己的memory/YYYY-MM-DD.md。',
}


# SCHEDULES repeats a job id for a native host alias; the first key holding that
# id is the logical actor the alias resolves to. Derived from the table itself so
# team_job does not depend on the native migration registry being readable.
LOGICAL_OF = {}
for _key, _entry in SCHEDULES.items():
    LOGICAL_OF.setdefault(_entry[0], _key)
NATIVE_ALIASES = {key: LOGICAL_OF[entry[0]] for key, entry in SCHEDULES.items()
                  if LOGICAL_OF[entry[0]] != key}


def team_job(actor):
    job_id, name, cron = SCHEDULES[actor]
    # A native host id (game:qd-engineer) denotes the same logical actor and the
    # same job; resolve it so the alias cannot yield a divergent spec.
    logical = NATIVE_ALIASES.get(actor, actor)
    runtime, role = logical.split(':', 1)
    prompt = PROMPTS[logical]
    spec = {'id': job_id, 'name': name, 'enabled': True,
        'schedule': {'type': 'cron', 'cron': cron, 'timezone': 'Asia/Shanghai'},
        'task_type': 'agent', 'text': prompt,
        'request': {'input': [{'role': 'user', 'content': [{'type': 'text', 'text': prompt}]}]},
        'dispatch': {'type': 'channel', 'channel': 'console', 'target': {
            'user_id': 'qiandeng-world-team', 'session_id': 'world-team-' + logical.replace(':', '-')},
            'mode': 'final', 'silent': True},
        'runtime': {'max_concurrency': 1, 'timeout_seconds': 480 if logical == 'game:mc-god' else 360, 'misfire_grace_seconds': 90,
                    'share_session': False, 'tool_safety': True},
        'save_result_to_inbox': False,
        'meta': {'project': 'qiandengji', 'purpose': 'world-team', 'runtime': runtime, 'role': role, 'version': 1}}
    host = native_host(logical)
    if logical == ENGINEER:
        spec['meta']['engineeringExecution'] = dict(ENGINEERING_POLICY)
    entry = migration_for(logical)
    if entry is not None and host != entry['source']:
        spec['meta']['nativeHost'] = host
    return spec


def is_team_job(job_id):
    return job_id in {value[0] for value in SCHEDULES.values()}


def validate_team_job(value, actor):
    expected = team_job(actor)
    # Compare semantic fields exactly: the prompt text and identity must match.
    for key in ('id', 'name', 'task_type', 'text', 'meta', 'save_result_to_inbox'):
        assert value.get(key) == expected[key], 'team_cron_drift:' + key
    assert type(value['enabled']) is bool
    # QwenPaw normalizes schedule/dispatch/request structures on save (adds
    # run_at, restructures input parts). Compare only the cron expression
    # and runtime agent identity — not the internal representation.
    assert value.get('schedule', {}).get('cron') == expected['schedule']['cron'], 'team_cron_drift:schedule.cron'
    assert value.get('runtime') == expected['runtime'], 'team_cron_drift:runtime'


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


def native_rate_limit_ended(error):
    """The pinned executor finalizes this failed stream before propagating it."""
    try:
        from qwenpaw.providers.retry_chat_model import _AcquireTimeoutError
    except ImportError:
        return False
    return isinstance(error, _AcquireTimeoutError)


# Native runs are cancelled by timeout_seconds(360) + misfire_grace(90); the extra
# margin covers stream teardown. A cycle still marked running/unknown past this
# horizon is an orphan left by a recycled process, so the role's own next shift
# reconciles it and retries — no maintainer script required (case-704a09d2).
# The horizon is priced off the deadline-bearing roles: the engineer runs with no
# total deadline, but max_concurrency=1 plus its finalized native inner
# timeout/cancellation keep a live shift from being mistaken for an orphan.
ORPHAN_CYCLE_AFTER = 360 + 90 + 300


async def execute(executor, job, original, runtime):
    import asyncio
    import fcntl
    native_role = executor._workspace.agent_id
    # The runtime builds the actor from runtime + native agent_id (e.g.
    # 'game:qd-engineer'), but team stores and schedules use logical actors
    # (e.g. 'operations:mc-god'). Resolve through the migration mapping.
    runtime_actor = runtime + ':' + native_role
    actor = logical_actor(runtime, native_role) or runtime_actor
    def skipped(reason):
        return {'task_type': 'agent', 'run_id': None, 'delivery_status': 'suppressed',
                'final_text': reason, 'modelCalls': 0}
    # A native host that is not this logical actor's current executable host has no
    # authority to run, learn, or write a lane. Reject before validation, store
    # creation, or model initialization so a retired/prepared host cannot drift a
    # cycle record or touch the roster (test_prepared_new_executor, test_active_target).
    try:
        require_host(actor, runtime, native_role)
    except ValueError:
        return skipped('team_native_host_inactive')
    validate_team_job(job.model_dump(mode='json', exclude_none=True), actor)
    store = TeamStore(actor)
    store.root.mkdir(parents=True, exist_ok=True)
    lock_path = store.root / ('cycle-' + actor.replace(':', '-') + '.lock')
    if lock_path.is_symlink(): raise ValueError('linked_team_cycle')
    with lock_path.open('a+b') as lock:
        try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError: return skipped('team_cycle_already_running')
        current, pending = fingerprint(store)
        previous = store.cycle_state()
        # Previous uncertain work is not replayed just because another timer fired.
        orphan = None
        if previous and previous['status'] in ('running', 'unknown'):
            age = store.clock() - float(previous['at'] or 0)
            if age < ORPHAN_CYCLE_AFTER:
                return skipped('previous_team_cycle_requires_reconciliation')
            # The flock above proves no live executor holds this cycle here, and
            # no native run can outlive timeout+grace: a record still uncertain
            # past that horizon is an orphan from a recycled process, not active
            # work. This shift reconciles it itself and becomes the retry.
            try: prior = json.loads(previous['result'] or '{}')
            except ValueError: prior = {}
            if not isinstance(prior, dict): prior = {}
            orphan = {'orphanStatus': previous['status'], 'orphanAt': previous['at'],
                'orphanAgeSeconds': round(age, 3), 'jobId': prior.get('jobId', job.id)}
            store.save_cycle(previous['fingerprint'], 'failed',
                prior | orphan | {'orphanReconciled': True})
        if actor == 'operations:mc-god' and not pending:
            return skipped('no_assigned_engineering_work')
        # Unknown work is never hidden behind a no-change skip or replayed.
        if (actor != 'game:mc-god' and previous and previous['status'] == 'completed'
                and previous['fingerprint'] == current):
            actionable = actor == 'operations:mc-god' and any(
                row['status'] in ('open', 'working') for row in store.cases(limit=30)['cases'])
            if not actionable: return skipped('no_new_team_work')
        reservation = None
        if actor.startswith('operations:'):
            from operations_native_tasks import reserve_operation, finish_run
            reservation = await asyncio.to_thread(reserve_operation, actor.split(':', 1)[1], job.id)
            if not reservation['ok']: return skipped(reservation['code'])
        store.save_cycle(current, 'running',
            {'jobId': job.id, **({'reconciledOrphan': orphan} if orphan else {})})
        try:
            # Re-check the host at the moment of model invocation: a migration can
            # flip active/retired between cycle entry and here, and a host that lost
            # authority mid-cycle must not start the model or write further lanes.
            require_host(actor, runtime, native_role)
            result = dict(await original(executor, execution_job(job, actor)))
            if orphan: result['reconciledOrphan'] = orphan
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
        except asyncio.TimeoutError as error:
            # CronExecutor's wait_for has awaited stream cancellation before
            # raising this known terminal. World action uncertainty remains in
            # its separate receipt ledger; a future inspection may report it.
            details = {'jobId': job.id, 'nativeTimeoutConfirmed': True}
            if actor == ENGINEER:
                # With no outer deadline this is a native inner timeout (e.g.
                # stream idle), not the old 360-second engineering cutoff.
                details.update(totalDeadlineApplied=False, nativeInnerTimeout=True,
                               errorType=type(error).__name__)
            if orphan: details['reconciledOrphan'] = orphan
            store.save_cycle(current, 'failed', details)
            if reservation:
                await asyncio.to_thread(finish_run, reservation['runId'], 'failed',
                                        **{k: v for k, v in details.items() if k != 'jobId'})
            raise
        except asyncio.CancelledError:
            # Native CronExecutor has awaited stream cancellation and finalized
            # its cancelled trace before propagating this terminal. Release only
            # this execution lease; world/tool effects retain their own receipts.
            store.save_cycle(current, 'failed', {'jobId': job.id, 'nativeCancellationConfirmed': True})
            if reservation:
                await asyncio.to_thread(finish_run, reservation['runId'], 'failed', nativeCancellationConfirmed=True)
            raise
        except BaseException as error:
            if native_rate_limit_ended(error):
                # This is the native model-permit timeout, not an uncertain
                # transport/write result. A later scheduled inspection is safe;
                # already issued tool requests keep their separate receipts.
                details = {'jobId': job.id, 'nativeRateLimitConfirmed': True,
                           'resultCompleted': False, 'oldWorkReplayed': False}
                store.save_cycle(current, 'failed', details)
                if reservation:
                    await asyncio.to_thread(finish_run, reservation['runId'], 'failed', **details)
            else:
                store.save_cycle(current, 'unknown', {'jobId': job.id, 'retryAutomatically': False,
                                                      'selfRetryAfterSeconds': ORPHAN_CYCLE_AFTER,
                                                      'errorType': type(error).__name__})
            raise
