"""Bounded Bedrock animation adapter. Original geometry/PNG are never changed.

Simple YSM/Gecko keyframes are preserved. Java-only expressions are rejected;
the TLM humanoid rig receives explicit Bedrock kinematics on its actual bones.
This is a presentation adapter, not Java animation/clock parity.
"""
import copy
import re

POSES = ['idle', 'walk', 'run', 'jump', 'sit', 'sleep', 'swim', 'sneak', 'fly']
ALIASES = {'sit': ['sit', 'ride'], 'sleep': ['sleep', 'sleeping'],
           'swim': ['swim', 'swimming'], 'sneak': ['sneak', 'sneaking']}


def safe_clip(clip, bones):
    """Keep complete supported clips, never substitute unknown Molang with zero."""
    result = copy.deepcopy(clip)
    if set(result) - {'loop', 'animation_length', 'bones', 'override_previous_animation', 'anim_time_update', 'blend_weight'}:
        return None
    if not isinstance(result.get('bones'), dict) or set(result['bones']) - set(bones):
        return None
    def safe(value):
        if isinstance(value, str):
            if len(value) > 2048 or re.search(r'(?:v|variable|t|temp)\.|;|=|\{|\}', value, re.I): return False
            return all(q.lower() in {'query.anim_time', 'q.anim_time', 'query.life_time', 'q.life_time',
                'query.ground_speed', 'q.ground_speed', 'query.vertical_speed', 'q.vertical_speed',
                'query.target_x_rotation', 'query.target_y_rotation', 'query.modified_distance_moved'}
                for q in re.findall(r'\b(?:query|q)\.[\w.]+', value, re.I))
        if isinstance(value, list): return len(value) <= 4096 and all(safe(v) for v in value)
        if isinstance(value, dict): return len(value) <= 4096 and all(safe(v) for v in value.values())
        return isinstance(value, (int, float, bool))
    if not safe(result): return None
    result.pop('anim_time_update', None)
    result.pop('blend_weight', None)
    result['loop'] = True
    return result


def adapt(bone_names, prefix, source=None, roots=None):
    names = set(bone_names)
    def find(*options): return next((n for n in options if n in names), None)
    roles = dict(head=find('head', 'Head', 'AllHead'), body=find('body', 'Body', 'UpBody'),
        left_arm=find('armLeft', 'LeftArm', 'left_arm', 'leftArm'),
        right_arm=find('armRight', 'RightArm', 'right_arm', 'rightArm'),
        left_leg=find('legLeft', 'LeftLeg', 'left_leg', 'leftLeg'),
        right_leg=find('legRight', 'RightLeg', 'right_leg', 'rightLeg'), blink=find('blink'))
    clips, native, unsupported = {}, [], []
    for pose in POSES:
        original = next((source[n] for n in [pose, *ALIASES.get(pose, [])] if source and n in source), None)
        supported = safe_clip(original, names) if original else None
        if supported:
            clips[pose] = supported; native.append(pose)
        elif original: unsupported.append(pose)
    # Bedrock degrees; TLM's radian limb formulas become degree oscillations.
    # Only named, existing joints are touched, leaving mesh/UV/bind pose intact.
    for pose in POSES:
        if pose in clips: continue
        bones = {}
        def setbone(role, **channels):
            if roles[role]: bones[roles[role]] = channels
        if pose in ('walk', 'run'):
            speed, amplitude = (720, 48) if pose == 'run' else (440, 30)
            wave = f'math.cos(query.anim_time*{speed})*{amplitude}'
            setbone('left_leg', rotation=[wave, 0, 0]); setbone('right_leg', rotation=[f'-({wave})', 0, 0])
            setbone('left_arm', rotation=[f'-({wave})*0.75', 0, 0]); setbone('right_arm', rotation=[f'({wave})*0.75', 0, 0])
        elif pose in ('sit', 'sneak'):
            setbone('left_leg', rotation=[-75 if pose == 'sit' else -24, 10, 0])
            setbone('right_leg', rotation=[-75 if pose == 'sit' else -24, -10, 0])
            if pose == 'sneak': setbone('body', rotation=[24, 0, 0])
        elif pose in ('jump', 'fly', 'swim'):
            setbone('left_arm', rotation=[-20, 0, -28]); setbone('right_arm', rotation=[-20, 0, 28])
            setbone('left_leg', rotation=[-15, 0, 0]); setbone('right_leg', rotation=[15, 0, 0])
            if pose == 'swim': setbone('body', rotation=[65, 0, 0])
        elif pose == 'sleep':
            # No fake translation through beds; original server pose remains authoritative.
            setbone('head', rotation=[12, 0, 0])
        else:
            setbone('left_arm', rotation=[0, 0, 'math.sin(query.anim_time*90)*1.3'])
            setbone('right_arm', rotation=[0, 0, '-math.sin(query.anim_time*90)*1.3'])
        if not roles['left_leg'] and not roles['right_leg'] and roots and pose in ('idle','walk','run','fly'):
            # Legless TLM spirits float as a whole; every top-level bone gets
            # the same offset so the original disconnected rig stays together.
            for root in roots:
                if root in names:bones.setdefault(root,{})['position']=[0,'math.sin(query.anim_time*120)*0.7',0]
        clips[pose] = {'loop': True, 'animation_length': 1, 'bones': bones}
    look = {}
    if roles['head']: look[roles['head']] = {'rotation': ['query.target_x_rotation', 'query.target_y_rotation', 0]}
    clips['look'] = {'loop': True, 'bones': look}
    if roles['blink']:
        clips['blink'] = {'loop': True, 'bones': {roles['blink']: {'scale': [1, 'math.mod(query.life_time,4.3)>4.13?0.05:1', 1]}}}
    arm = roles['right_arm'] or roles['left_arm']
    clips['attack'] = {'animation_length': .4, 'bones': {arm: {'rotation': {'0.0': [-110, 0, 0], '0.14': [-25, 0, 0], '0.4': [0, 0, 0]}}} if arm else {}}
    ids = {name: 'animation.maw_native.'+prefix+'.'+name for name in clips}
    controller = 'controller.animation.maw_native.'+prefix
    states = {}
    for number, pose in enumerate(POSES):
        states[pose] = {'animations': [pose], 'blend_transition': .12,
            'transitions': [{p: f'query.variant == {i}'} for i, p in enumerate(POSES) if i != number]}
    descriptor = {'animations': {**ids, 'maw_body': controller},
        'scripts': {'animate': ['maw_body', 'look', *(['blink'] if 'blink' in clips else [])]}}
    return {'clips': {ids[k]: v for k, v in clips.items()}, 'ids': ids, 'descriptor': descriptor,
        'controller': {controller: {'initial_state': 'idle', 'states': states}},
        'nativeClips': native, 'unsupportedNativeClips': unsupported, 'roles': roles,
        'moving': bool(roles['left_leg'] or roles['right_leg'] or roots or any(p in native for p in ('walk','run')))}
