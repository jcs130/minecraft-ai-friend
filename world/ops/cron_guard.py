"""Keep native Qwen scheduling; put the existing budget before agent cron I/O."""
import asyncio
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import time
import uuid
from agent_learning import LearningTools, OPS_ROLES, locked, read, write

VERSION = 1


def fingerprint(tools):
    index = tools._index()
    reports = tools.state / 'operations/reports' / tools.role
    rows = []
    for path in sorted(reports.glob('*.json'))[:200]:
        if path.is_symlink(): raise ValueError('linked_review_evidence')
        stat = path.stat(); rows.append([path.name, stat.st_size, stat.st_mtime_ns])
    drafts = []
    for path in sorted((tools.root / 'drafts').glob('*/*.json'))[:48]:
        if path.is_symlink(): raise ValueError('linked_draft_evidence')
        drafts.append([path.parent.name, path.stem])
    material = {'skills': index['skills'], 'feedback': index['feedback'], 'reports': rows, 'drafts': drafts}
    if not any(material.values()) and not index['reviewPending']: return None
    return hashlib.sha256(json.dumps(material, sort_keys=True, ensure_ascii=False).encode('utf8')).hexdigest()


def reserve_review(tools, job_id, clock=time.time):
    """Uses the SAME persisted ledger as operations_delegate, never a new quota."""
    from operations_native_tasks import ledger, budget_check, reconcile_pending
    reconcile_pending()
    with locked(tools.root):
        digest = fingerprint(tools)
        marker = tools.root / 'last-review.json'
        previous = read(marker) if marker.exists() else {}
        if not digest or previous.get('evidenceSha256') == digest:
            return {'ok': False, 'code': 'no_new_learning_evidence'}
        with ledger() as rows:
            now = clock(); blocked = budget_check(rows, now)
            if blocked: return {'ok': False, 'code': blocked}
            run_id = 'learning-' + uuid.uuid4().hex
            rows.append({'runId': run_id, 'requestId': run_id, 'role': tools.role,
                'startedAt': now, 'status': 'cron_reserved', 'taskId': None, 'jobId': job_id,
                'source': 'native-qwen-cron'})
        # Reserve before executing. Timeout/crash is charged, never auto-retried.
        write(marker, {'schema': 1, 'evidenceSha256': digest, 'reservedAt': now, 'runId': run_id})
        return {'ok': True, 'runId': run_id}


async def guarded_execute(executor, job, original, runtime, factory=LearningTools):
    role = executor._workspace.agent_id
    state = Path(executor._workspace.workspace_dir).parent.parent
    tools = factory(role, runtime, state=state)
    managed = job.id == 'qd-learning-' + role and job.meta.get('project') == 'qiandengji'
    def skipped(code):
        record = {'schema': 1, 'role': role, 'jobId': job.id, 'checkedAt': time.time(),
            'status': 'skipped', 'code': code, 'modelCalls': 0}
        write(tools.root / 'last-cron.json', record)
        return {'task_type': job.task_type, 'run_id': None, 'delivery_status': 'suppressed',
            'final_text': code, 'qiandeng': record}
    if runtime == 'game':
        from life_review_schedule import JOB_ID, execute as execute_life_review
        if job.id == JOB_ID:
            return await execute_life_review(executor, job)
        if managed and job.task_type == 'text':
            result = await asyncio.to_thread(tools.maintenance)
            write(tools.root / 'last-cron.json', result | {'status': 'local_maintenance', 'jobId': job.id})
            return {'task_type': 'text', 'run_id': None, 'delivery_status': 'suppressed',
                'final_text': '本角色技能维护完成；待改进项在下次正常任务中处理。', 'qiandeng': result}
        if job.task_type == 'agent': return skipped('use_existing_game_decision_controller')
        return await original(executor, job)
    if job.task_type != 'agent': return await original(executor, job)
    if role not in OPS_ROLES: return skipped('unregistered_operations_role')
    if job.dispatch.channel != 'console': return skipped('project_console_required')
    if job.runtime.timeout_seconds > 180 or job.runtime.max_concurrency != 1:
        return skipped('bounded_runtime_required')
    from world_operations import is_world_job
    world_job = is_world_job(job, role)
    if not managed and not world_job:
        return skipped('unmanaged_operations_job')
    from operations_native_tasks import reserve_operation, finish_run
    reservation = await asyncio.to_thread(reserve_operation, role, str(job.id)) if world_job else await asyncio.to_thread(reserve_review, tools, str(job.id))
    if not reservation['ok']: return skipped(reservation['code'])
    record = {'schema': 1, 'role': role, 'jobId': job.id, 'checkedAt': time.time(),
        'status': 'reserved', 'runId': reservation['runId'], 'sharedBudgetCharged': True}
    write(tools.root / 'last-cron.json', record)
    try:
        result = await original(executor, job)
        delivery = result.get('delivery_status')
        terminal = 'failed' if delivery in ('failed', 'error') else 'completed'
        record.update(status='finished', executionStatus='returned', finishedAt=time.time(), deliveryStatus=delivery)
        await asyncio.to_thread(finish_run, reservation['runId'], terminal,
                                executionStatus='returned', deliveryStatus=delivery)
        return result
    except BaseException:
        record.update(status='failed_or_interrupted', retryAutomatically=False)
        # A raised/cancelled native execution is not a confirmed backend
        # terminal receipt. Keep its durable reservation unresolved.
        raise
    finally:
        # This is execution status, not a claim that the agent produced a useful
        # workflow. Evidence and native session history are checked separately.
        write(tools.root / 'last-cron.json', record)


def install(runtime):
    if runtime not in ('game', 'operations'): raise ValueError('invalid_learning_runtime')
    if importlib.metadata.version('qwenpaw') != '2.2.0': raise ValueError('review_new_qwen_cron_contract')
    from native_tool_runtime import install as install_native_tools
    native_guard_version = install_native_tools(runtime)
    from llm_runtime_policy import install as install_llm_policy
    llm_policy_version = install_llm_policy(runtime)
    from reme_status_compat import install as install_reme_status
    reme_status_version = install_reme_status(runtime)
    from qwenpaw.app.crons.executor import CronExecutor
    if getattr(CronExecutor, '_qiandeng_learning_guard', None) == VERSION: return
    original = CronExecutor.execute
    async def execute(self, job):
        return await guarded_execute(self, job, original, runtime)
    CronExecutor.execute = execute
    CronExecutor._qiandeng_learning_guard = VERSION
    # Stable process identity is independent of Docker/WSL wall-clock drift.
    process_ticks = int(Path('/proc/self/stat').read_text().rsplit(')', 1)[1].split()[19])
    boot_id = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
    write(Path('/state/work/learning-runtime.json'), {'schema': 1, 'runtime': runtime, 'guardVersion': VERSION,
        'pid': os.getpid(), 'startedAt': time.time(), 'qwenVersion': '2.2.0', 'scheduler': 'native-qwen-cron',
        'processStartTicks': process_ticks, 'bootId': boot_id, 'nativeToolGuardVersion': native_guard_version,
        'llmPolicyVersion': llm_policy_version, 'remeStatusCompatVersion': reme_status_version})
