"""Small local program helpers. No planner, provider, retries or world mutations."""
import json
import math

OBSERVATION_LIMIT = 16384


def program_observation(gateway, request, body, now):
    """Execute one already-validated read with the same checks as the MCP tool."""
    from world_actions import WorldActions
    from numen_gateway import GatewayError
    tools = WorldActions(gateway)
    methods = {'inspect_block': tools.inspect, 'inspect_container': tools.container_view}
    method = methods.get(request.get('tool'))
    if method is None:
        raise ValueError('unsupported_program_observation')
    try:
        result = method(**request['args'])
        if not isinstance(result, dict):
            raise ValueError('invalid_observation_result')
        encoded = json.dumps(result, ensure_ascii=True, allow_nan=False)
        if len(encoded.encode('utf8')) > OBSERVATION_LIMIT:
            raise ValueError('observation_result_too_large')
    except (GatewayError, OSError, ValueError, TypeError) as exc:
        result = {'ok': False, 'code': str(exc) if isinstance(exc, GatewayError) else type(exc).__name__}
    return {'tool': request['tool'], 'args': dict(request['args']),
            'bodyUuid': body.get('bodyUuid'), 'dimension': body.get('dimension'),
            'observedAt': int(now * 1000), 'result': result}


def observation_view(observation, body, now):
    if not isinstance(observation, dict):
        return None
    stamp = observation.get('observedAt')
    age = now * 1000 - stamp if type(stamp) in (int, float) and math.isfinite(stamp) else None
    fresh = (age is not None and 0 <= age <= 60000
             and observation.get('bodyUuid') == body.get('bodyUuid')
             and observation.get('dimension') == body.get('dimension'))
    # Stale data stays visible as history; it cannot masquerade as a fresh read.
    return {**observation, 'fresh': fresh, 'ageMs': age}


def execution_state(job, episodes, body, now):
    return {'lastResult': job.get('lastResult'), 'lastExecution': job.get('lastExecution'),
            'observation': observation_view(job.get('lastObservation'), body, now),
            'observedAt': int(now * 1000), 'evidence': episodes[-3:]}


def systems_status(data, job, now):
    active = job.get('status') in ('pending', 'running', 'dispatching')
    waiting = active and type(job.get('nextRunAt')) in (int, float) and job['nextRunAt'] > now
    return {'schema': 1, 'fast': {'owner': 'native-ai-and-tested-programs',
            'active': active, 'waiting': bool(waiting), 'name': job.get('name') if active else None,
            'nextCheckAt': job.get('nextRunAt') if waiting else None,
            'steps': job.get('steps', 0) if active else 0,
            'observations': job.get('observations', 0) if active else 0,
            'requiresModelPerStep': False},
            'slow': {'owner': 'qwenpaw', 'active': bool(data.get('active')),
                     'status': data.get('status'), 'readiness': data.get('qwenReadiness')},
            'automaticFoodReflex': False}
