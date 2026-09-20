"""One read-only sensor surface shared by Qwen and the sandbox's proposals."""
import json

from embodiment import capabilities, validate_sensor
from numen_gateway import GatewayError


def sense(gateway, sensor='catalog', arguments=None):
    arguments = {} if arguments is None else arguments
    if sensor == 'catalog' and arguments == {}:
        return {'ok': True, **capabilities()}
    try:
        validate_sensor(sensor, arguments)
        if sensor == 'self':
            return gateway.snapshot()
        if sensor == 'scene':
            return gateway.observe(**arguments)
        if sensor == 'block':
            return gateway.inspect_block(**arguments)
        if sensor == 'container':
            return gateway.inspect_container(**arguments)
        # Native storage/menu exist already. Keep their documented text format
        # explicit rather than inventing universal meanings for mod data slots.
        before = gateway.snapshot()
        if before.get('ok') is not True:
            raise GatewayError('body_snapshot_unavailable')
        gateway._check_binding()
        if sensor == 'storage':
            from world_actions import WorldActions
            world = WorldActions(gateway)
            world._area(arguments, before)
            world._reach(arguments, before)
        reply = gateway._invoke('inspect_block_storage' if sensor == 'storage' else 'inspect_gui', arguments)
        if not isinstance(reply, dict) or reply.get('success') is not True or not isinstance(reply.get('message'), str):
            return {'ok': False, 'code': 'native_sensor_unavailable', 'sensor': sensor}
        if len(reply['message'].encode('utf8')) > 12000:
            raise ValueError('sensor_result_too_large')
        after = gateway.snapshot()
        if (after.get('ok') is not True or after.get('bodyUuid') != before.get('bodyUuid')
                or after.get('dimension') != before.get('dimension')):
            raise GatewayError('sensor_binding_changed')
        return {'ok': True, 'sensor': sensor, 'bodyUuid': before['bodyUuid'],
                'dimension': before['dimension'], 'observedAt': gateway._now(),
                'arguments': arguments, 'format': 'native_text', 'data': reply['message'],
                'source': 'numen.' + ('inspect_block_storage' if sensor == 'storage' else 'inspect_gui'),
                'semanticAdapter': False}
    except (ValueError, TypeError, OSError, KeyError) as error:
        return {'ok': False, 'sensor': sensor, 'code': str(error) if isinstance(error, (GatewayError, ValueError))
                else 'sensor_unavailable'}
