"""Select tested programs through the existing policy slot and durable executor.

The classifier sees each program's actual first proposed action. It never emits
code, parameters, leases or arbitrary tool names. The selected immutable program
is rechecked and queued; all effects and practice receipts remain controller work.
"""
import copy
import hashlib
import json
import uuid

from numen_gateway import action_lock, read_json, write_json
from policy_worker import same_body


def validate_routing(value):
    if (not isinstance(value, dict) or set(value) != {'intents', 'maintenance'}
            or type(value['maintenance']) is not bool or not isinstance(value['intents'], list)
            or not 1 <= len(value['intents']) <= 12
            or any(not isinstance(s, str) or not 2 <= len(s.strip()) <= 40 for s in value['intents'])):
        raise ValueError('invalid_skill_routing')
    return copy.deepcopy(value)


def candidates(library, body, goal, catalog=None):
    """Bounded sandbox previews. A failing/absent prerequisite admits no candidate."""
    rows = []
    for item in (catalog if catalog is not None else library.catalog()).get('skills', [])[:64]:
        version = item.get('activeVersion')
        if not version or not item.get('routing'):
            continue
        try:
            routing = validate_routing(item.get('routing'))
            if not routing['maintenance'] and not any(s.casefold() in goal.casefold() for s in routing['intents']):
                continue
            record = library.read(item['name'], version)
            if not record.get('active') or record.get('routing') != routing:
                continue
            plan = library.run(item['name'], dict(body, goal=goal), {}, version)
            if not plan.get('action') or plan.get('done') or plan.get('replan'):
                continue
            rows.append({'name': item['name'], 'version': version, 'action': plan['action'],
                         'description': record['description'][:240], 'maintenance': routing['maintenance']})
        except (ValueError, OSError, KeyError, TypeError):
            continue
    # Hunger/emergency maintenance first, otherwise name ordering is stable.
    return sorted(rows, key=lambda r: (not r['maintenance'], r['name']))[:7]


def clear(c):
    c.pending_route = None
    c.data.pop('skillRoutePending', None)


def _context(c, control):
    memory = c.memory()
    goal = control.get('mission') or memory.get('nextFocus') or memory.get('goal') or ''
    # One automatic program per slow decision/goal revision. Failures and done
    # both hand back to cognition; changing inventory cannot cause a retry loop.
    attempt = {'mission': goal, 'changedAt': control.get('missionChangedAt'),
               'memoryAt': memory.get('updatedAt'), 'epoch': c.settings.get('memoryEpoch'),
               'decision': (c.data.get('lastDecision') or {}).get('turnId')}
    key = hashlib.sha256(json.dumps(attempt, sort_keys=True).encode()).hexdigest()
    return goal, key


def tick(c, body, control):
    try:
        result = _tick(c, body, control)
        c.data.pop('skillRouteWarning', None)
        return result
    except (ValueError, OSError, KeyError, TypeError) as exc:
        clear(c)
        c.data['skillRouteWarning'] = type(exc).__name__
        # Selection has no world effect. A queued job still owns the boundary
        # if logging after its atomic write failed; do not start cognition over it.
        path = c.root / 'skill-job.json'
        return path.exists() and read_json(path).get('status') in ('pending', 'running', 'dispatching')


def _tick(c, body, control):
    if (c.settings.get('brainProtocol') != 1 or not c.skills or not c.practice
            or control.get('enabled') is not True or (control.get('drain') or {}).get('status') == 'requested'
            or c.data.get('active') or c.data.get('dialogueActive') or c.pending_social is not None
            or c.pending_policy is not None or c.data.get('actionExecution', {}).get('inFlight')
            or c.data.get('goalSwitchPending') or c.data.get('goalAgendaError')
            or body.get('bodyUuid') != c.settings['bodyUuid'] or not same_body(body, body, c.clock())
            or c.reviews.pending() or (c.root / 'unknown.json').exists()):
        clear(c)
        return False
    path = c.root / 'skill-job.json'
    job = read_json(path) if path.exists() else {}
    if (job.get('status') in ('pending', 'running', 'dispatching')
            or job.get('practiceStarted') and not job.get('practiceFinalized')):
        clear(c)
        return False
    goal, key = _context(c, control)
    pending = c.pending_route
    binding = c.policy_binding(job)
    if pending is not None:
        result = c.policy_worker.poll(pending['token'])
        age = c.clock() - pending['at']
        if pending['key'] != key or pending['binding'] != binding or not same_body(pending['body'], body, c.clock()):
            clear(c)
            c.record('skill_route_discarded', reason='premise_changed', worldActions=0)
            return False
        if result is None and age <= 5:
            c.data['status'] = 'selecting_skill'
            return True
        clear(c)
        if result is None or age > 5:
            result = {**(result or {}), 'ok': False, 'code': 'skill_route_timeout'}
        result['handoffMs'] = round(age * 1000, 2)
        c.data['skillRouteLast'] = {k: v for k, v in result.items() if k not in ('state', 'candidates', 'action')}
        c.record('system_one_skill_choice', selection=result, candidates=pending['rows'])
        if not result.get('ok'):
            return False
        selected = next((r for i, r in enumerate(pending['rows']) if 'skill_' + str(i) == result.get('choice')), None)
        if selected is None or selected['action'] != result.get('action'):
            return False
        # An active-version change or a changed precondition invalidates the
        # selection. Do not silently execute a newly promoted replacement.
        record = c.skills.read(selected['name'], selected['version'])
        plan = c.skills.run(selected['name'], dict(body, goal=goal), {}, selected['version'])
        if not record.get('active') or plan.get('action') != selected['action'] or plan.get('done') or plan.get('replan'):
            c.record('skill_route_discarded', reason='catalog_changed', worldActions=0)
            return False
        from practice import run_id, validate_objective
        tool, args = selected['action']['tool'], selected['action']['args']
        checks = [{'kind': 'action_completed', 'tool': tool, 'count': 1}]
        if tool == 'craft' and isinstance(args.get('item_id'), str):
            checks.append({'kind': 'inventory_gain', 'item': args['item_id'], 'count': 1})
        objective = validate_objective({'description': selected['description'], 'checks': checks})
        with action_lock(c.root):
            latest = read_json(c.root / 'control.json')
            previous = read_json(path) if path.exists() else {}
            lease_path = c.root / 'lease.json'
            lease = read_json(lease_path) if lease_path.exists() else {}
            if (latest != control or previous != job or (c.root / 'unknown.json').exists()
                    or lease.get('status') in ('open', 'used', 'unknown')):
                c.record('skill_route_discarded', reason='execution_boundary_changed', worldActions=0)
                return False
            turn = 'route-' + uuid.uuid4().hex
            queued = {'schema': 1, 'status': 'pending', 'name': selected['name'], 'version': selected['version'],
                      'memory': {}, 'maxSteps': 16, 'requestedAt': int(c.clock() * 1000),
                      'turnId': turn, 'practiceRunId': run_id(selected['name'], selected['version'], turn),
                      'objective': objective, 'routeSelection': c.data['skillRouteLast'],
                      'routeAction': selected['action'], 'routeGoal': goal}
            write_json(path, queued)
        c.record('system_one_choice', name=queued['name'], version=queued['version'],
                 practiceRunId=queued['practiceRunId'], selection=result, scope='skill_catalog')
        c.record('skill_routed', name=queued['name'], version=queued['version'],
                 practiceRunId=queued['practiceRunId'], turnId=turn, executionConfirmed=False)
        c.data['status'] = 'executing_skill'
        return True
    if not goal or c.data.get('skillRouteAttempt') == key:
        return False
    # Loading indexed candidates on a slow bind mount can still take time. Do this
    # once per admission, then refresh physical facts BEFORE starting its clock.
    rows = candidates(c.skills, body, goal, c.catalog(refresh=True))
    c.data['skillRouteAttempt'] = key
    c.save()  # A restart cannot buy an automatic retry for an unchanged goal.
    if not rows:
        return False
    current_body = c.gateway.snapshot()
    if not same_body(body, current_body, c.clock()):
        c.record('skill_route_discarded', reason='premise_changed_during_catalog_read', worldActions=0)
        return False
    body = current_body
    proposal = {'question': 'Choose the tested program whose first action directly advances the current goal. '
                'All listed prerequisites passed. Choose slow only if no program is appropriate or more planning is needed.',
                'candidates': [{'id': 'skill_' + str(i), 'description': r['description'], 'action': r['action']}
                               for i, r in enumerate(rows)] + [
                    {'id': 'slow', 'description': 'No suitable skill; ask the existing slow planner.', 'action': None}]}
    token = c.policy_worker.submit(proposal, body, goal, None)
    if token is None:
        return False
    c.pending_route = {'token': token, 'key': key, 'binding': binding, 'body': copy.deepcopy(body),
                       'rows': rows, 'at': c.clock()}
    c.data['skillRoutePending'] = {'submittedAt': int(c.clock() * 1000), 'candidates': len(rows)}
    c.data['status'] = 'selecting_skill'
    return True
