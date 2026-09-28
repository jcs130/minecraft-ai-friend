"""Yield an opted-in fast motion continuation to new commands or danger.

The slow agent explicitly chooses the route through navigate_plan. The tested
motion program handles one bounded return leg in the same durable job, so no
new cognition lease or replayable command is created here.
"""
from motor_mailbox import view
from numen_gateway import action_lock, read_json, write_json


def yield_to_explicit(c, body):
    """Stop a return leg only at a proven idle body boundary."""
    path = c.root / 'skill-job.json'
    job = read_json(path) if path.exists() else {}
    memory = job.get('memory') or {}
    if (job.get('status') not in ('pending', 'running')
            or memory.get('continueWhileThinking') is not True):
        return False
    current = job.get('motorRequestId')
    if not current:
        return False
    queued = any(row.get('status') == 'queued' and row.get('requestId') != current
                 and row.get('expiresAt', 0) > c.clock()
                 for row in view(c.root)['requests'])
    remembered = c.memory()
    environment = c.environment or {}
    stamp = environment.get('observedAt')
    unsafe = (body.get('hp', 0) <= 8 or body.get('hunger', 0) <= 4
              or body.get('inWater') is True or body.get('inLava') is True
              or body.get('onGround') is not True
              or remembered.get('goalState') != 'ongoing'
              or remembered.get('goal') != memory.get('goalClaim')
              or environment.get('ok') is not True
              or environment.get('bodyUuid') != body.get('bodyUuid')
              or type(stamp) not in (int, float)
              or not 0 <= c.clock() * 1000 - stamp <= 5000
              or not isinstance(environment.get('hostiles'), list)
              or bool(environment['hostiles']))
    if not queued and not unsafe:
        return False
    reason = 'unsafe_body_or_scene' if unsafe else 'planner_command_preempted'
    with action_lock(c.root):
        latest = read_json(path)
        if latest != job:
            return False
        write_json(path, job | {'status': 'replan', 'reason': reason})
    c.record('motion_continuation_yielded', requestId=current, reason=reason)
    return True
