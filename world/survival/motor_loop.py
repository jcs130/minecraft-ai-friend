"""Single body executor, independent of the native asynchronous planning task.

Commands are durable; observations are coalesced. No claimed request is replayed.
Native goto/eat cancellation reuses the gateway's exact-task stop journal.
"""
import hashlib
import json
from motor_mailbox import view, claim_locked, finish_locked, public, binding
from numen_gateway import GatewayError, action_lock, read_json, write_json


def _job(c):
    p = c.root / 'skill-job.json'
    return read_json(p) if p.exists() else {}


def reconcile(c):
    """Recover only from a matching durable receipt, never resend a claim."""
    for row in view(c.root)['requests']:
        if row['status'] == 'unknown':
            c.pause('motor_outcome_unknown')
            return
        if row['status'] != 'claimed':
            continue
        if row['kind'] == 'skill':
            job = _job(c)
            if job.get('motorRequestId') != row['requestId']:
                status, receipt = 'unknown', {'code': 'motor_claim_without_job'}
            elif job.get('status') in ('pending', 'running', 'dispatching'):
                return
            elif job.get('practiceStarted') and not job.get('practiceFinalized'):
                return
            else:
                status = 'completed' if job.get('status') == 'done' else 'cancelled' if job.get('status') == 'cancelled' else 'failed'
                receipt = {k: job.get(k) for k in ('status', 'reason', 'practiceRunId', 'lastExecution')}
        else:
            receipts = c.gateway.turn_receipts(row['motorTurnId'])
            if not receipts:
                status, receipt = 'unknown', {'code': 'motor_claim_without_receipt'}
            else:
                receipt = receipts[-1]
                if receipt.get('status') in ('in_flight', 'dispatching'):
                    return
                status = {'completed': 'completed', 'failed': 'failed',
                          'rejected': 'failed', 'cancelled': 'cancelled'}.get(receipt.get('status'), 'unknown')
        # A concurrent status read must not turn a journalled outcome into an
        # uncertain dispatch. This lock only commits the local queue terminal.
        with action_lock(c.root, blocking=True):
            finish_locked(c.root, row['requestId'], status, receipt)
        if status == 'unknown':
            c.pause('motor_outcome_unknown')


def dispatch(c, recovery_only=False):
    with action_lock(c.root):
        control = read_json(c.root / 'control.json')
        if control.get('enabled') is not True or (control.get('drain') or {}).get('status') == 'requested':
            return False
        row = claim_locked(c.root, c.clock)
        if not row:
            return False
        if recovery_only and (row['kind'] != 'action' or row['payload'].get('tool') != 'goto'):
            finish_locked(c.root, row['requestId'], 'failed', {'code': 'outside_work_area',
                'dispatched': False, 'writePerformed': False,
                'instruction': 'Return using a short inward goto before other body actions.'})
            return True
        if row['kind'] == 'skill':
            from practice import run_id
            p = row['payload']
            write_json(c.root / 'skill-job.json', {'schema': 1, 'status': 'pending', **p,
                'turnId': row['motorTurnId'], 'motorRequestId': row['requestId'],
                'requestedAt': int(c.clock()*1000),
                'practiceRunId': run_id(p['name'], p['version'], row['motorTurnId'])})
            return True
    # Native gateway owns the effect journal and fresh preflight; no model owns
    # this short lease. A crash between claim and receipt remains unknown.
    try:
        c.gateway.open_lease(row['motorTurnId'], (c.clock()+60)*1000)
        outcome = c.gateway.action(row['motorTurnId'], **row['payload'])
        c.gateway.close_lease(blocking=True)
        c.collect_action_receipts(row['motorTurnId'])
        if not outcome.get('ok') and outcome.get('code') != 'outcome_unknown' and not outcome.get('actionId'):
            with action_lock(c.root, blocking=True):
                finish_locked(c.root, row['requestId'], 'failed', outcome)
        else:
            # A dispatched rejection has an exact journal receipt. The raw
            # gateway return omits its tool/status/reason and must not replace it.
            reconcile(c)
        c.record('motor_dispatch', requestId=row['requestId'], turnId=row['motorTurnId'],
                 slowTaskId=(c.data.get('active') or {}).get('taskId'), outcome=outcome.get('code'))
    except Exception:
        c.pause('motor_dispatch_uncertain')
        raise
    return True


def preempt(c, body, control):
    receipt = c.data.get('actionExecution', {}).get('receipt') or {}
    # Only native actions with an exact terminal/cancellation protocol qualify.
    if receipt.get('status') != 'in_flight' or receipt.get('tool') not in ('goto', 'eat'):
        c.pending_motor = None
        return
    facts = {'action': receipt.get('actionId'), 'task': body.get('task', {}).get('task_id'),
             'epoch': body.get('navigationEpoch'), 'goal': binding(c.root),
             'healthLow': body.get('hp', 20) <= 8, 'hungerLow': body.get('hunger', 20) <= 6,
             'goalChanged': bool(c.data.get('goalSwitchPending'))}
    key = hashlib.sha256(json.dumps(facts, sort_keys=True).encode()).hexdigest()
    pending = getattr(c, 'pending_motor', None)
    if pending:
        result = c.policy_worker.poll(pending['token'])
        if key != pending['key'] or c.clock()-pending['at'] > 5:
            c.pending_motor = None
            return
        if result is None:
            return
        c.pending_motor = None
        c.record('motor_interrupt_choice', selection={k:v for k,v in result.items() if k not in ('state','candidates')}, actionId=receipt['actionId'])
        if (result.get('choice') == 'interrupt' and result.get('code') == 'policy_escalated'
                and result.get('confidence', 0) >= .75):
            c.data['motorStop'] = {'actionId': receipt['actionId'], 'jobTurnId': _job(c).get('turnId')}
            c.save()  # Stop intent survives a restart; ACK never completes a job.
            c.gateway.enforce_navigation_deadline(body, preempt_action_id=receipt['actionId'])
        return
    if (c.data.get('motorPreemptKey') == key or c.data.get('motorStop')
            or c.pending_policy or c.pending_route or c.pending_social):
        return
    proposal = {'question': 'Should the current body script continue? Interrupt only for a changed goal or urgent '
                'survival need that this action does not address. Low hunger alone is not a reason to interrupt eating. '
                'Interrupt requests exact native cancellation; ordinary queued work can wait. Facts: '+json.dumps(facts),
                'candidates': [{'id':'continue','description':'Keep the current script running','action':None},
                               {'id':'interrupt','description':'Cancel the current native action at a confirmed boundary','action':None}]}
    token = c.policy_worker.submit(proposal, body, control.get('mission') or c.memory().get('goal',''), None)
    if token is not None:
        c.data['motorPreemptKey'] = key
        c.pending_motor = {'token':token,'key':key,'at':c.clock()}


def recovery_boundary(c, body):
    """Retire stopped programs only at a proved, idle body boundary."""
    execution = c.data.get('actionExecution') or {}
    if (body.get('task', {}).get('busy') or execution.get('inFlight')
            or execution.get('code') == 'outcome_unknown'):
        return False
    with action_lock(c.root):
        control = read_json(c.root/'control.json')
        lease_path = c.root/'lease.json'
        lease = read_json(lease_path) if lease_path.exists() else {}
        if (control.get('enabled') is not True or (control.get('drain') or {}).get('status') == 'requested'
                or lease.get('status') == 'unknown'
                or (c.root/'unknown.json').exists() or (c.root/'inflight-action.json').exists()):
            return False
        job = _job(c)
        if job.get('status') == 'dispatching':
            return False
        stop = c.data.get('motorStop')
        terminal = ('completed', 'failed', 'cancelled', 'rejected')
        def ended(row):
            return (row.get('status') in terminal and
                    (row.get('completionConfirmed') is True or row.get('status') == 'rejected'))
        receipt = execution.get('receipt') or {}
        if stop and (receipt.get('actionId') != stop['actionId']
                or not ended(receipt)):
            return False
        if job.get('status') in ('pending', 'running'):
            last = job.get('lastExecution') or {}
            turn = job.get('lastTurnId')
            evidence = None
            if turn:
                rows = c.gateway.turn_receipts(turn)
                evidence = rows[-1] if rows else {}
                if (evidence.get('turnId') != turn or not evidence.get('actionId')
                        or not ended(evidence)
                        or last.get('turnId') not in (None, turn)
                        or last.get('actionId') not in (None, evidence['actionId'])):
                    return False
            elif job.get('status') == 'running' or last:
                # Idle alone cannot prove what a running program last did.
                return False
            job.update(status='replan', reason='outside_work_area',
                recoveryBoundary=({k: evidence[k] for k in ('turnId', 'actionId', 'status')}
                                  if evidence else {'dispatched': False}))
            write_json(c.root/'skill-job.json', job)
        if stop:
            c.data.pop('motorStop', None)
            c.save()
    # Practice.finish is idempotent and must settle before the skill's mailbox
    # claim releases. Keep its frozen terminal observation on later retries.
    if job.get('practiceStarted') and not job.get('practiceFinalized'):
        c.settle_practice()
    reconcile(c)
    return True


def tick(c, body, control):
    if (control.get('drain') or {}).get('status') == 'requested':
        # Finish a claimed action from its exact journal while admission is
        # closed. Queued commands are retired at the controller's idle boundary.
        reconcile(c)
        c.data['motorQueue'] = public(c.root)
        return
    try:
        c.gateway._area(body['position'], protect=False)
    except GatewayError as exc:
        if str(exc) != 'outside_work_area':
            raise
        # Being outside the action boundary must not starve the cognition
        # terminal, exact action receipts, or heartbeat in Controller.tick.
        # The gateway still refuses every unauthorized body dispatch.
        c.discard_policy()
        c.pending_motor = None
        from skill_router import clear
        clear(c)
        reconcile(c)
        c.data['motorStatus'] = 'outside_work_area'
        c.data['motorBlocked'] = {'code': 'outside_work_area',
            'position': dict(body['position']), **getattr(exc, 'details', {})}
        if (body.get('gameMode') == 'survival' and not c.data.get('goalAgendaError')
                and not body.get('task', {}).get('busy')
                and not c.data.get('actionExecution', {}).get('inFlight')
                and recovery_boundary(c, body)):
            # Only a model-selected inward goto reaches the normal fresh gateway
            # preflight. No route is invented and no skill starts outside the area.
            dispatch(c, recovery_only=True)
        c.data['motorQueue'] = public(c.root)
        return
    c.data.pop('motorBlocked', None)
    if body.get('gameMode') != 'survival':
        c.pause('not_in_survival')
        return
    if c.data.get('goalAgendaError'):
        return
    if body.get('task', {}).get('busy') or c.data.get('actionExecution', {}).get('inFlight'):
        c.data['motorStatus'] = 'executing'
        preempt(c, body, control)
        c.watch_standing_task(body)
        return
    c.pending_motor = None
    stop = c.data.get('motorStop')
    if stop:
        receipt = c.data.get('actionExecution', {}).get('receipt') or {}
        if receipt.get('actionId') != stop['actionId'] or receipt.get('status') not in ('completed','failed','cancelled'):
            c.data['motorStatus'] = 'stop_confirmation_wait'
            return
        with action_lock(c.root):
            job = _job(c)
            if job.get('turnId') == stop.get('jobTurnId') and job.get('status') in ('pending','running'):
                write_json(c.root/'skill-job.json', job | {'status':'cancelled','reason':'motor_preempt'})
        c.data.pop('motorStop', None)
        c.settle_practice()
    reconcile(c)
    if read_json(c.root/'control.json').get('enabled') is not True:
        return
    c.finish_action_observation(body)
    c.switch_goal_at_boundary()
    if c.tick_skill(body):
        c.data['motorStatus'] = 'executing_skill'
        return
    c.settle_practice()
    job = _job(c)
    if job.get('practiceStarted') and not job.get('practiceFinalized'):
        c.data['motorStatus'] = 'practice_confirmation_wait'
        return
    reconcile(c)
    if read_json(c.root/'control.json').get('enabled') is not True:
        return
    if dispatch(c):
        c.data['motorStatus'] = 'dispatching'
        return
    from skill_router import tick as route
    c.data['motorStatus'] = 'selecting' if route(c, body, read_json(c.root/'control.json')) else 'idle'
    c.data['motorQueue'] = public(c.root)
