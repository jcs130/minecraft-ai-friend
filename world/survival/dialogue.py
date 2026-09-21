"""Read-only social cognition alongside native/program execution, on one loop.

Uses the existing party reservation/hearing receipts and native Qwen tasks.
It cannot mint, close or borrow a body lease, replay an unknown POST, or dispatch
another model task while the normal cognitive lane is active.
"""
import json
import uuid

from numen_gateway import read_json, action_lock
from life_session import final_text, framework_failure

READ_TOOLS = ('numen_survival__status', 'numen_survival__look', 'numen_survival__sense',
              'numen_survival__world_perception', 'numen_survival__request_goal', 'numen_survival__goal_agenda')


def tick(controller, body, control):
    c = controller
    active = c.data.get('dialogueActive')
    if active:
        if not active.get('taskId') or active.get('phase') != 'submitted':
            c.data['dialogueStatus'] = 'submission_unknown'
            if hasattr(c.backend, 'lookup_submission') and c.clock() >= active.get('lookupAfter', 0):
                active['lookupAfter'] = c.clock() + 10
                try:
                    task = c.backend.lookup_submission(active)
                    if task:
                        # Persist the party link before advancing controller
                        # state. Repeating this exact link after a crash is safe.
                        c.party.submitted(active['partyReservation'], task)
                        active.update(taskId=task, phase='submitted', recoveredAt=c.clock())
                        c.data['dialogueStatus'] = 'submission_recovered'
                        c.record('social_submission_recovered', turnId=active['turnId'], taskId=task,
                                 requestReplayed=False)
                except Exception as error:
                    c.data['dialogueWarning'] = type(error).__name__
                c.save()
            return
        enabled = control.get('enabled') is True and body.get('ok') is True
        try:
            if not active.get('nativeTerminal'):
                result = c.backend.poll(active['taskId'])
                if result.get('status') in ('pending', 'running', 'queued'):
                    if (not enabled or c.clock() - active['startedAt'] > c.settings['taskTimeoutSeconds'] + 30) and not active.get('cancelRequested'):
                        active['cancelRequested'] = True
                        c.save()
                        c.backend.cancel(active)
                    c.data['dialogueStatus'] = 'cancelling' if active.get('cancelRequested') else 'thinking'
                    return
                if result.get('status') not in ('completed', 'finished', 'failed', 'cancelled', 'canceled'):
                    raise ValueError('dialogue_terminal_unknown')
                native = result.get('result') or {}
                if native.get('session_id') and native['session_id'] != active['sessionId']:
                    raise ValueError('dialogue_session_mismatch')
                answer = final_text(native)
                success = result['status'] in ('completed', 'finished') and native.get('status') == 'completed' and bool(answer)
                active['nativeTerminal'] = {'completed': success, 'text': answer if success else '',
                    'failureReason': framework_failure(native) or 'native_task_failed'}
                active['generatedAt'] = c.clock()
                c.save()
            receipt = c.deliver_party_terminal(active, allow_dispatch=enabled)
            if receipt['settled']:
                c.data['lastDialogueTiming'] = {'messageId': active.get('messageId'),
                    'batchMessageIds': active.get('batchMessageIds', []),
                    'receivedAt': active.get('receivedAt'), 'submittedAt': active['startedAt'],
                    'generatedAt': active.get('generatedAt'), 'settledAt': c.clock(),
                    'worldHeard': receipt['heard'], 'audioPlayedAt': None}
                c.record('social_dialogue_settled', **c.data['lastDialogueTiming'])
                if active['nativeTerminal']['completed']:
                    from behavior_context import acknowledge
                    acknowledge(c.root, c.session, active['contextDelivery'])
                c.data['dialogueActive'] = None
                c.data['dialogueStatus'] = 'heard' if receipt['heard'] else 'not_heard'
                c.save()
        except Exception as error:
            c.data['dialogueStatus'] = 'confirmation_wait'
            c.data['dialogueWarning'] = type(error).__name__
        return
    if (not c.party or c.data.get('active') or control.get('enabled') is not True
            or (control.get('drain') or {}).get('status') == 'requested' or body.get('ok') is not True
            or c.data.get('inferenceBackoff') or (c.root / 'unknown.json').exists()):
        return
    now = c.clock()
    job_path = c.root / 'skill-job.json'
    job = read_json(job_path) if job_path.exists() else {}
    executing = (body.get('task', {}).get('busy') or c.data.get('actionExecution', {}).get('inFlight')
                 or job.get('status') in ('pending', 'running', 'dispatching'))
    if not executing:
        # New instructions get an action-planning turn first. Otherwise alternate
        # when both cognition and social work are due; a stream of chat cannot
        # starve planning. Running programs/native actions still allow dialogue.
        signature = c.data.get('lastDecisionSignature')
        review_at = c.next_review(control)
        due = (signature != c.decision_signature(body, control) or c.reviews.pending() is not None
               or review_at is not None and now >= review_at)
        if (c.data.get('goalSwitchPending') or signature is None
                or due and c.data.get('dialogueYieldToPlanner')):
            return
    recent = [row for row in c.data['decisions'] if now - row['startedAt'] < 86400]
    limit = c.daily_planning_limit()
    if limit is not None and len(recent) >= limit or now < c.data.get('nextDecisionAt', 0):
        return
    try:
        if hasattr(c.party, 'validate_session'):
            c.party.validate_session(c.session, c.settings)
        message = c.party.pending()
        if message is None:
            return
        # Same native readiness gate, no separate inference provider.
        import os
        if os.environ.get('SURVIVOR_QWEN_MODE') == 'external':
            from native_tools import require_ready
            if not require_ready():
                c.data['dialogueStatus'] = 'waiting_for_tools'
                return
        turn_id = 'survival-' + uuid.uuid4().hex
        c.data['wakeReason'] = 'party_message'
        context = c.life_context(body, control, turn_id, message)
        context['bodyAccess'] = 'read_only'
        from behavior_context import prepare
        session, context, delivery = prepare(c.root, c.session, context, c.memory())
        # Every input states the authority independently of previous context.
        context['bodyAccess'] = 'read_only'
        context['instruction'] = ('回应本组已经听见的消息，按发言时间理解补充与纠正，合成一次简短最终答复，由原桥投递。'
            '身体工具只读，没有身体租约；不调用remember或party_send，不声称动作已完成。'
            '不把每句话当任务；若决定接受明确后续请求，先用goal_agenda查看，再request_goal持久保存后才承诺。'
            'request_id用当前messageId加操作后缀，重试复用；纠正或取消用原goalId/revision，默认排队不覆盖。')
        active = {'turnId': turn_id, 'startedAt': now, 'taskId': None, 'phase': 'reserved',
                  'messageId': message['messageId'], 'receivedAt': message.get('createdAt'),
                  'batchMessageIds': [item['messageId'] for item in message.get('batchMessages', [])],
                  'sessionId': session['primarySessionId'], 'userId': session['userId'],
                  'channel': session['channel'], 'contextDelivery': delivery}
        with action_lock(c.root, blocking=True):
            latest = read_json(c.root / 'control.json')
            if latest.get('enabled') is not True or (latest.get('drain') or {}).get('status') == 'requested':
                return
            reservation = c.party.reserve(message)
            if not reservation or reservation.get('claimed') is not True:
                return
            active['partyReservation'] = reservation
            c.data['dialogueActive'] = active
            c.data['dialogueYieldToPlanner'] = True
            c.data['decisions'] = recent + [{'turnId': turn_id, 'startedAt': now, 'purpose': 'dialogue'}]
            c.data['nextDecisionAt'] = now + c.model_cooldown()
            c.save()
        active['taskId'] = c.backend.submit(turn_id, '具身交流输入：\n' + json.dumps(context, ensure_ascii=False),
            c.settings['taskTimeoutSeconds'], session=session,
            request_context={'subagent_allowed_tools': list(READ_TOOLS)})
        active['phase'] = 'submitted'
        c.save()
        c.party.submitted(reservation, active['taskId'])
        c.data['dialogueStatus'] = 'thinking'
    except Exception as error:
        # Keep the exact reservation on every uncertain outcome; never retry.
        c.data['dialogueStatus'] = 'submission_unknown' if c.data.get('dialogueActive') else 'unavailable'
        c.data['dialogueWarning'] = type(error).__name__
        c.save()
