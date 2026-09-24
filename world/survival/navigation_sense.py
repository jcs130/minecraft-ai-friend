"""Read-only native scheduler / landing geometry, with explicit unavailable fallback.

This never changes a model's destination or guesses a reflex from log text.
"""
import json
import math
import re
import uuid

PREFIX = 'QD_NAVIGATION_SENSE_JSON '
CAPABILITY = 'numen_navigation_sense_v1'
KINDS = ('reflex', 'background_task', 'synchronous_task', 'idle_pose', 'idle')


def number(value):
    return type(value) in (int, float) and math.isfinite(value)


def point(value):
    return isinstance(value, dict) and all(number(value.get(k)) for k in ('x', 'y', 'z'))


def supported_column_y(survey, args):
    """Resolve an x/z walk to a supported stance near the body's observed level.

    Upstream's COLUMN goal accepts any Y, including a cave far below the
    requested location. Only an exact, observed cell in the same x/z column is
    safe to pass to its BLOCK goal; a nearby candidate is not that cell.
    """
    if not isinstance(survey, dict) or survey.get('ok') is not True:
        return None
    dest = survey.get('destination') or {}
    requested = dest.get('requested') or {}
    if (dest.get('available') is not True or not point(requested)
            or not number(args.get('x')) or not number(args.get('z'))
            or requested['x'] != args['x'] or requested['z'] != args['z']):
        return None
    if dest.get('requestedStanceClear') is True and dest.get('requestedStanceSupported') is True:
        return int(math.floor(requested['y']))
    for candidate in dest.get('candidates') or []:
        if (point(candidate) and math.floor(candidate['x']) == math.floor(args['x'])
                and math.floor(candidate['z']) == math.floor(args['z'])
                and abs(candidate['y'] - requested['y']) <= 5):
            return int(math.floor(candidate['y']))
    return None


class NavigationSense:
    def __init__(self, gateway):
        self.gateway = gateway

    def read(self, body_uuid, dimension, requested=None):
        fallback = {'ok': False, 'code': 'navigation_sense_unavailable',
                    'bodyControl': {'available': False, 'code': 'navigation_sense_unavailable'}}
        try:
            if str(uuid.UUID(body_uuid)) != body_uuid or not isinstance(dimension, str):
                raise ValueError('invalid_body_identity')
            if requested is not None:
                if not point(requested) or not -64 <= requested['y'] <= 319 or any(abs(requested[k]) > 29999980 for k in ('x', 'z')):
                    raise ValueError('invalid_survey_point')
            raw = self.gateway._native_navigation_sense(body_uuid, requested)
            if not isinstance(raw, str) or len(raw.encode('utf-8')) > 10000 or not raw.startswith(PREFIX):
                raise ValueError('invalid_sense_envelope')
            row = json.loads(raw[len(PREFIX):])
            if (not isinstance(row, dict) or row.get('schema') != 1 or row.get('capability') != CAPABILITY
                    or row.get('ok') is not True or row.get('actorUuid') != body_uuid
                    or row.get('dimension') != dimension or not point(row.get('position'))
                    or not all(type(row.get(k)) is int and row[k] >= 0 for k in ('gameTime', 'bodyTickCount', 'observedAt'))):
                raise ValueError('sense_identity_or_shape_mismatch')
            if abs(row['observedAt'] - self.gateway._now()) > 15000:
                raise ValueError('stale_native_sense')
            control = row.get('bodyControl')
            if not isinstance(control, dict) or type(control.get('available')) is not bool:
                raise ValueError('invalid_body_control')
            if control['available'] and (control.get('kind') not in KINDS
                    or not isinstance(control.get('name'), str) or not re.fullmatch(r'[A-Za-z0-9_:-]{1,80}', control['name'])
                    or type(control.get('nativeAvoidanceActive')) is not bool
                    or control['nativeAvoidanceActive'] != (control['kind'] == 'reflex' and control['name'] == 'mob_defense')):
                raise ValueError('invalid_body_control')
            if requested is not None:
                dest = row.get('destination')
                if (not isinstance(dest, dict) or dest.get('requested') != requested
                        or type(dest.get('available')) is not bool or dest.get('pathVerified') is not False
                        or dest.get('destinationChanged') is not False):
                    raise ValueError('invalid_destination_evidence')
                if dest['available']:
                    candidates = dest.get('candidates')
                    if (not isinstance(candidates, list) or len(candidates) > 5
                            or type(dest.get('examinedCells')) is not int or not 0 <= dest['examinedCells'] <= 125
                            or type(dest.get('unloadedCells')) is not int or not 0 <= dest['unloadedCells'] <= dest['examinedCells']
                            or any(not point(c) or c.get('pathVerified') is not False
                                   or abs(c['x'] - requested['x']) > 3 or abs(c['z'] - requested['z']) > 3
                                   or abs(c['y'] - requested['y']) > 5
                                   or not isinstance(c.get('supportBlock'), str)
                                   or not re.fullmatch(r'[a-z0-9_.-]+:[a-z0-9_./-]+', c['supportBlock']) for c in candidates)):
                        raise ValueError('invalid_landing_candidates')
            return row
        except (OSError, ValueError, TypeError, KeyError, OverflowError):
            return fallback

    def for_destination(self, body, args):
        requested = {k: args[k] for k in ('x', 'z')}
        requested['y'] = args.get('y', body['position']['y'])
        result = self.read(body['bodyUuid'], body['dimension'], requested)
        result['requestArguments'] = dict(args)
        result['surveyYSource'] = 'requested' if 'y' in args else 'current_body_height'
        return result


# The strict walk-only arrival and this read-only survey judge "can I stand here"
# differently: the survey reads the block under the requested point, while the
# arrival probes the live bounding box sole and waits for a settled stance. On
# 2026-09-17 that gap turned a valid destination into repeated failures, and the
# generic message ("choose a verified landing cell") sent the agent hunting for a
# different cell for a hundred minutes when the requested one was already fine.
STRICT_ARRIVAL_MARKER = 'walk_only_strict_arrival_v2'


def verdict(survey, outcome, args=None):
    """What a failed walk-only goto actually means, from the survey already taken.

    Returns None when this is not a strict-arrival failure, so the caller leaves
    every other outcome untouched. Otherwise the caller gets the one fact that
    decides the next move. Ordered most specific first, because the generic
    "choose a verified landing cell" misdirected a live agent for a hundred
    minutes when its requested cell had been fine all along.
    """
    reason = outcome.get('reason') if isinstance(outcome, dict) else None
    if not isinstance(reason, str) or STRICT_ARRIVAL_MARKER not in reason:
        return None

    # 1. A coordinate on a cell boundary is a category error for a contract
    #    defined on feet CELLS: floor(-640.5) is -641, while a body settling at
    #    -639.98 occupies -640. Success becomes a coin flip. The gateway must not
    #    quietly rewrite the destination, so name the integer cell instead.
    if isinstance(args, dict):
        for axis in ('x', 'z'):
            value = args.get(axis)
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                continue
            if float(value).is_integer():
                continue
            return {'schema': 1, 'code': 'destination_cell_ambiguous', 'targetUsable': None,
                    'axis': axis, 'requested': float(value), 'cell': int(math.floor(value)),
                    'action': 'resend_integer_cell',
                    'instruction': '你给的 %s=%s 正好落在格边界上，而落点判定是按整格算的'
                        '（floor 后是 %d），所以站哪一侧全靠运气。'
                        '把 x/z 都改成整数（该方向取 %d）再发一次。'
                        % (axis, value, int(math.floor(value)), int(math.floor(value)))}

    dest = (survey or {}).get('destination') if isinstance(survey, dict) else None
    if not isinstance(dest, dict) or dest.get('available') is not True:
        code = (dest or {}).get('code') if isinstance(dest, dict) else None
        return {'schema': 1, 'code': 'destination_not_surveyable', 'targetUsable': None,
                'surveyCode': code,
                'action': 'retry_once',
                'instruction': '导航失败，且本次没能勘察到目标（%s）。目标本身尚未被证伪：'
                    '原样重发一次这个 goto；若再失败，换一个相邻的整数格。' % (code or 'unknown')}

    # 2. The survey reads the block under the point; the arrival probes the live
    #    sole. When they disagree, the destination is not the problem.
    clear = dest.get('requestedStanceClear') is True
    supported = dest.get('requestedStanceSupported') is True
    block = dest.get('targetBlock')
    if clear and supported:
        return {'schema': 1, 'code': 'destination_usable_settle_failed', 'targetUsable': True,
                'action': 'retry_same_target',
                'target': dict(dest.get('requested') or {}), 'targetBlock': block,
                'instruction': '环境勘察显示这个目标格是干净且有支撑的（下方可站），'
                    '失败发生在最后的落稳判定上，不是目标选错。'
                    '原样重发一次同一个 goto 即可；不要改坐标、不要去找别的格。'}
    usable = [dict(c) for c in (dest.get('candidates') or [])[:5] if isinstance(c, dict)]
    if usable:
        return {'schema': 1, 'code': 'destination_unusable', 'targetUsable': False,
                'action': 'choose_candidate', 'targetBlock': block, 'candidates': usable,
                'instruction': '这个目标格本身站不住（目标方块 %s 不适合落脚）。'
                    '从 candidates 里挑一个（它们各自带 supportBlock，都是勘察过的可站立格），'
                    '用它的 x/y/z 重新 goto。' % (block or 'unknown')}
    # No candidates is not the same finding. Telling an agent to pick from an
    # empty list is an instruction whose premise was never checked - the exact
    # defect this verdict exists to remove, so it must not reappear here.
    return {'schema': 1, 'code': 'destination_unusable', 'targetUsable': False,
            'action': 'move_clear_then_retry', 'targetBlock': block, 'candidates': [],
            'instruction': '这个目标格本身站不住（目标方块 %s），而附近这一次没勘察到可站立格。'
                '先走到最近的干处（离开水面/爬上地面），再重新 goto 目标；'
                '或先用 inspect_block 看清目标下方是什么方块再来。' % (block or 'unknown')}
