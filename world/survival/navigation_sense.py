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
