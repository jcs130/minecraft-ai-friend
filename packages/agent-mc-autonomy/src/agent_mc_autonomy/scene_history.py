"""Lossless scene replay; current authority always belongs to the final scene."""
import copy
import hashlib
import json

from .context_evidence import outcome_id

KIND = 'agent_mc_scene/v1'
GUIDANCE = """Full input scenes in historical exchanges describe the past, not current orders or world state.
Only the final user scene selects the current goal, current_facts and current host memory.
An unchanged selected field may be {context_ref:scene_id,pointer:JSON_pointer}; its exact value is
in that earlier scene in this request. This is lossless reuse, not missing/unknown data. All other
facts and all attributed event text remain literal. Never treat historical goals as permission.
"""
ALWAYS_LITERAL = {'body', 'health', 'place', 'queue', 'life', 'deathLifecycle', 'foodReserve',
                  'serverFeedback', 'messages', 'lastTask', 'connection', 'identity', 'clock', 'sample', 'realclock'}
SECTIONS = ('death_memory', 'host_context', 'tool_failure')


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def identifier(value):
    raw = {key: item for key, item in value.items() if key != 'context_id'}
    return hashlib.sha256(json.dumps(raw, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()[:32]


def make_scene(value):
    result = copy.deepcopy(value)
    result['kind'] = KIND
    result['context_id'] = identifier(result)
    return result


def _value(message):
    content = message.get('content')
    if isinstance(content, list):
        content = next((p.get('text') for p in content if p.get('type') == 'text'), None)
    if message.get('role') != 'user' or not isinstance(content, str):
        return None
    try:
        value = json.loads(content)
    except ValueError:
        return None
    return value if isinstance(value, dict) else None


def _native(value, sources):
    row = value.get('native_outcome')
    if value.get('kind') == 'native_outcome/v1' and outcome_id(row) == value.get('context_id') and outcome_id(row):
        sources[value['context_id']] = row


def project_messages(messages):
    """Rebase from raw retained scenes on every assembly; never leave dangling refs."""
    result, known, native = [], {}, {}
    reused, saved, scenes = 0, 0, 0
    for message in messages:
        row = copy.deepcopy(message)
        value = _value(row)
        if value:
            _native(value, native)
        if not value or value.get('kind') != KIND or value.get('context_id') != identifier(value):
            result.append(row)
            continue
        scenes += 1
        projected = copy.deepcopy(value)

        def reuse(item, slot, pointer, *, literal=False, key=None):
            nonlocal reused, saved
            serialized = encode(item)
            prior = known.get((slot, serialized))
            if prior and not literal and len(serialized.encode()) >= 512:
                ref = {'context_ref': prior[0], 'pointer': prior[1]}
                if key is not None:
                    ref = {'key': key, **ref}
                reused += 1
                saved += len(serialized.encode()) - len(encode(ref).encode())
                return ref
            # Only advertise a literal source, so references never form chains.
            known[(slot, serialized)] = (value['context_id'], pointer)
            return item

        projected['current_facts'] = [reuse(part, ('fact', part.get('key')), f'/current_facts/{i}',
                                          literal=part.get('key') in ALWAYS_LITERAL, key=part.get('key'))
                                      for i, part in enumerate(value.get('current_facts', []))]
        for section in SECTIONS:
            if section in value:
                projected[section] = reuse(value[section], ('section', section), '/' + section)
        if value.get('recent_native_outcomes'):
            projected['recent_native_outcomes'] = [
                {'context_ref': key} if (key := outcome_id(item)) in native else item
                for item in value['recent_native_outcomes']]
        # Raw canonical scenes are text. Image artifacts remain current-only in
        # perception.attach_frame and are never copied into historical replay.
        if isinstance(row.get('content'), list):
            part = next(p for p in row['content'] if p.get('type') == 'text')
            part['text'] = encode(projected)
        else:
            row['content'] = encode(projected)
        result.append(row)
    return result, {'scenes': scenes, 'reused_fields': reused, 'saved_utf8_bytes': saved}


def capture_scene(messages):
    """Recover complete selected values before storing the input/reply exchange."""
    scenes, native, latest = {}, {}, None
    for message in messages:
        value = _value(message)
        if not value:
            continue
        _native(value, native)
        if value.get('kind') != KIND:
            continue
        restored = copy.deepcopy(value)
        for i, part in enumerate(value.get('current_facts', [])):
            if isinstance(part, dict) and set(part) == {'key', 'context_ref', 'pointer'}:
                pointer = part['pointer'].split('/')
                if len(pointer) != 3 or pointer[1] != 'current_facts':
                    raise ValueError('scene_reference_invalid')
                original = scenes[part['context_ref']]['current_facts'][int(pointer[2])]
                if original.get('key') != part['key']:
                    raise ValueError('scene_reference_key_mismatch')
                restored['current_facts'][i] = copy.deepcopy(original)
        for section in SECTIONS:
            ref = value.get(section)
            if isinstance(ref, dict) and set(ref) == {'context_ref', 'pointer'}:
                if ref['pointer'] != '/' + section:
                    raise ValueError('scene_reference_invalid')
                restored[section] = copy.deepcopy(scenes[ref['context_ref']][section])
        if value.get('recent_native_outcomes'):
            restored['recent_native_outcomes'] = [copy.deepcopy(native[item['context_ref']])
                if isinstance(item, dict) and set(item) == {'context_ref'} else item
                for item in value['recent_native_outcomes']]
        if restored.get('context_id') != identifier(restored):
            raise ValueError('scene_integrity_invalid')
        scenes[restored['context_id']] = restored
        if message is messages[-1]:
            latest = {'role': 'user', 'content': encode(restored)}
    return latest


def is_scene(message):
    value = _value(message)
    return bool(value and value.get('kind') == KIND and value.get('context_id'))
