"""A native task nobody here dispatched must not silence the one who thinks.

2026-09-20, Kirito: an external client issued ``follow`` on his body ("跟着你,保持 4 米").
Numen runs that as a task with no terminal and a budget of 2.3e17 seconds. The tick
saw ``body.task.busy`` and parked in ``acting`` -- and so refused to think again for
9.8 hours (35125s, zero model calls, zero receipts) while the body stood at hp 7.2/20
with hunger 5 and 2041 perception events were dropped unseen.

Waiting on a task we dispatched is correct; we hold its receipt and expect it back.
Waiting forever on a stranger's standing order is a freeze wearing a waiting costume.
So: name it, watch it, and after a bounded window take the body back -- a stop is a
request the native side answers, never an invented result, and the outcome is written
down whichever way it goes. Same discipline as the cancellation nobody was probing
(75f22a6), applied to the other half of the same hole.
"""

GRACE_SECONDS = 900      # a standing task that is not ours is watched, not obeyed
MAX_LOG = 8


def observe(watch, body, now, *, owned=False, stop=None, record=None):
    """Advance the occupation watch over ``watch`` (a persisted dict); return a row.

    ``owned`` must say whether the running task is one this controller dispatched.
    ``stop`` is called with the task id once the window closes; without it this stays
    a pure observation. Never raises: a failed look costs a stale row, never a turn.
    """
    state = watch if isinstance(watch, dict) else {}
    task = (body or {}).get('task') or {}
    task_id, name = task.get('task_id'), task.get('task')
    elapsed, budget = task.get('elapsed_s'), task.get('budget_left_s')
    log = list(state.get('log') or [])

    def emit(kind, **extra):
        log.append(dict({'at': now, 'kind': kind, 'taskId': task_id}, **extra))
        state['log'] = log[-MAX_LOG:]

    if not task_id:
        # The body is free again. Keep the trail, drop the watch, and say so once.
        if state.get('taskId'):
            emit('gone', heldSeconds=round(now - state.get('since', now), 1),
                 task=state.get('name'))
            state.update({'taskId': None, 'action': 'idle'})
        return {'occupied': False}

    if owned:
        if state.get('taskId') == task_id:
            emit('ours', task=name, elapsedS=elapsed)
            state.update({'taskId': None, 'action': 'owned'})
        return {'occupied': False, 'owned': True, 'taskId': task_id, 'elapsedS': elapsed}

    if state.get('taskId') != task_id:
        state.update({'taskId': task_id, 'name': name, 'since': now, 'recorded': False,
                      'elapsedAtFirst': elapsed, 'budgetLeftAtFirst': budget,
                      'graceSeconds': GRACE_SECONDS})
        emit('watched', task=name, elapsedS=elapsed, budgetLeftS=budget)
        state['action'] = 'watching'
        return {'occupied': True, 'action': 'watching', 'taskId': task_id, 'task': name,
                'heldSeconds': 0.0, 'elapsedS': elapsed, 'budgetLeftS': budget,
                'graceSeconds': GRACE_SECONDS}

    held = now - state.get('since', now)
    row = {'occupied': True, 'taskId': task_id, 'task': name, 'elapsedS': elapsed,
           'budgetLeftS': budget, 'heldSeconds': round(held, 1), 'graceSeconds': GRACE_SECONDS}
    if held < GRACE_SECONDS:
        state['action'] = 'watching'
        row['action'] = 'watching'
        return row

    outcome = 'not_attempted'
    if stop is not None:
        try:
            reply = stop(task_id)
            outcome = ('stopped' if isinstance(reply, dict) and reply.get('success') is True
                       else 'stop_refused')
        except Exception as error:            # a failed release costs a retry, never a turn
            outcome = 'stop_failed:' + type(error).__name__
        emit('reclaim', task=name, heldSeconds=round(held, 1), outcome=outcome)
        if outcome == 'stopped':
            state.update({'taskId': None, 'action': outcome})
        else:
            # A stop nobody honoured is still a stranger holding the body: keep the
            # watch running so the next tick tries again, rather than restarting the
            # grace period as if this were a new task.
            state['action'] = outcome
        row.update(action=outcome, reclaimed=True)
        # The log keeps every attempt; the episode ledger says it once per task, so a
        # stop that keeps failing cannot bury the story in repeats.
        if record is not None and (outcome == 'stopped' or not state.get('recorded')):
            state['recorded'] = True
            try:
                record('standing_task_reclaimed', taskId=task_id, task=name,
                       heldSeconds=round(held, 1), elapsedS=elapsed,
                       budgetLeftS=budget, outcome=outcome)
            except Exception:
                pass
        return row

    state['action'] = 'watching'
    row['action'] = 'watching'
    return row
