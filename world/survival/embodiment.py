"""Grounded working state for the existing controller, not another agent loop.

Observations, intentions and outcomes have different provenance. The controller
owns freshness and execution; Qwen owns hypotheses, goals and learned programs.
The adapter remains the only boundary to a particular body/world implementation.
"""
import copy
import math
from world_adapter import validate_sensor

VERSION = 1
SENSORS = {
    'self': {'arguments': {}, 'source': 'body_adapter', 'scope': 'own_body'},
    'scene': {'arguments': {'radius': 'integer 4..12, default 8'},
              'source': 'body_adapter', 'scope': 'local_loaded_scene'},
    'block': {'arguments': {'x': 'integer', 'y': 'integer', 'z': 'integer'},
              'source': 'body_adapter', 'scope': 'nearby_block'},
    'container': {'arguments': {'x': 'integer', 'y': 'integer', 'z': 'integer'},
                  'source': 'body_adapter', 'scope': 'bound_open_container'},
    'storage': {'arguments': {'x': 'integer', 'y': 'integer', 'z': 'integer'},
                'source': 'numen_capabilities', 'scope': 'reachable_block',
                'format': 'native_text', 'semantics': 'item/fluid/energy, if exposed by the mod'},
    'menu': {'arguments': {}, 'source': 'numen_server_menu', 'scope': 'current_open_menu',
             'format': 'native_text', 'semantics': 'raw synchronized values; indices are menu-specific'},
}


def _stamp(value):
    return value if type(value) in (int, float) and math.isfinite(value) and value >= 0 else None


def observation_meta(data, now_ms, max_age_ms, source):
    stamp = _stamp(data.get('observedAt'))
    age = now_ms - stamp if stamp is not None else None
    return {'source': source, 'observedAt': stamp,
            'available': data.get('ok') is True,
            'fresh': data.get('ok') is True and age is not None and 0 <= age <= max_age_ms,
            'maxAgeMs': max_age_ms}


def working_memory(memory, epoch):
    # Old checkpoints must not silently become the new brain's intention.
    if memory.get('memoryEpoch') != epoch:
        return {}
    return {key: copy.deepcopy(memory[key]) for key in
            ('goal', 'goalState', 'nextFocus', 'lesson', 'updatedAt', 'reviewAfterSeconds') if key in memory}


def wake(controller, body, control, turn_id, message=None, replies=None):
    """One body-independent cognitive input built from already acquired evidence.

    A world model here is an explicit partial observation state. It does not
    claim predictive learning or infer success from position/inventory changes.
    Timestamps travel separately so identical sensor values can be delta-coded.
    """
    from perception import prioritize_events
    from controller import life_action_evidence
    epoch = controller.settings['memoryEpoch']
    now_ms = int(controller.clock() * 1000)
    memory = working_memory(controller.memory(), epoch)
    environment = controller.environment
    scene_binding = (environment.get('bodyUuid') == body.get('bodyUuid')
                     and environment.get('world', {}).get('dimension') == body.get('dimension'))
    scene_meta = observation_meta(environment, now_ms, 65000, 'body_adapter.observe')
    if not scene_binding:
        scene_meta.update(available=False, fresh=False)
    events, size = [], 0
    import json
    for event in prioritize_events(controller.awareness.get('events', []))[:6]:
        n = len(json.dumps(event, ensure_ascii=False))
        if size + n <= 4000:
            events.append(event)
            size += n
    self_state = {key: copy.deepcopy(body[key]) for key in (
        'ok', 'bodyUuid', 'bodyName', 'dimension', 'position', 'hp', 'maxHp', 'hunger',
        'saturation', 'air', 'inWater', 'inLava', 'onGround', 'gameMode',
        'equipment', 'counts', 'task', 'bodyControl') if key in body}
    # Native scheduler tick counters and world clocks change even when the
    # observed situation does not. Keep them as acquisition metadata, otherwise
    # every wake resends the entire inventory and scene as a false state change.
    control_meta = {}
    if isinstance(self_state.get('bodyControl'), dict):
        native_control = self_state['bodyControl']
        control_meta = {key: native_control.pop(key) for key in
                        ('observedAt', 'gameTime', 'bodyTickCount') if key in native_control}
    scene = {key: copy.deepcopy(environment[key]) for key in
             ('world', 'hostiles', 'limits') if key in environment} if scene_binding else None
    if scene is not None and isinstance(scene.get('world'), dict) and 'game_time' in scene['world']:
        scene_meta['gameTime'] = scene['world'].pop('game_time')
    last = controller.data.get('lastDecision') or {}
    context = {
        'turn_id': turn_id, 'currentTime': now_ms, 'wakeReason': controller.data['wakeReason'],
        'mission': control.get('mission') or controller.settings['mission'],
        'brain': {'version': VERSION, 'memoryEpoch': epoch, 'worldModel': 'partial_observation',
                  'selectionAuthority': 'agent', 'actionAuthority': 'existing_body_lease'},
        'self': self_state,
        'scene': scene,
        'observations': {'self': observation_meta(body, now_ms, 20000, 'body_adapter.snapshot'),
                         'scene': scene_meta, 'bodyControl': control_meta},
        'intent': {'source': 'agent_reported', **memory},
        'perception': {'events': events, 'pendingEventIds': [e['id'] for e in events if e.get('id')]},
        'recentActionReceipts': [life_action_evidence(row) for row in last.get('actions', [])[-6:]],
        'executionEvents': [{key: row[key] for key in ('kind', 'name', 'status', 'reason', 'steps') if key in row}
                            for row in controller.data.get('episodes', [])[-4:]
                            if row.get('kind') in ('skill_finished', 'skill_stopped', 'skill_error')],
        'instruction': '',  # bootstrap instructions are emitted once per behavior by prepare().
    }
    roster = getattr(controller.party, 'config', None)
    if roster is not None and roster.configured():
        context['partyMembers'] = roster.roster()
    if message is not None:
        context['partyMessage'] = controller.party.context(message)
    if replies:
        context['partyReplies'] = replies
    return context


def capabilities():
    return {'schema': VERSION, 'sensors': copy.deepcopy(SENSORS),
            'control': 'skill_catalog.actionTools', 'program': 'next(state,memory)',
            'learning': 'draft/test/promote/practice/refine',
            'unknownIsEmpty': False, 'nativePhysics': True, 'predictiveWorldModel': False}
