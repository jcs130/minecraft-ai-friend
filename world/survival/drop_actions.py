"""One component-preserving native toss, followed only by exact receipt reads."""
import json
import math
import re
import time
import uuid
from numen_gateway import GatewayError

PREFIX = 'QD_WORLD_INTERACTION_JSON '


def preflight(before, args):
    have = sum(row['count'] for row in before.get('inventory', [])
               if row.get('id') == args['item_id'] and type(row.get('slot')) is int
               and 0 <= row['slot'] < 36 and type(row.get('count')) is int)
    if have < args['count']:
        raise GatewayError('insufficient_main_inventory_items')


class DropActions:
    def __init__(self, gateway, sleep=time.sleep, max_polls=20):
        self.gateway, self.sleep = gateway, sleep
        self.max_polls = max(1, min(30, max_polls))

    def _read(self, raw, action_id, before, args, expected=None):
        try:
            rows = [line[len(PREFIX):] for line in raw.splitlines() if line.startswith(PREFIX)]
            if len(rows) != 1 or len(rows[0].encode('utf8')) > 16000:
                raise ValueError('invalid_drop_envelope')
            row = json.loads(rows[0])
            if (type(row.get('schema')) is not int or row.get('schema') != 1 or row.get('capability') != 'numen_interaction_receipt_v1'
                    or row.get('actorUuid') != before['bodyUuid'] or row.get('requestId') != action_id
                    or row.get('tool') != 'drop_items' or row.get('args') != args
                    or str(uuid.UUID(row.get('epoch', ''))) != row['epoch']
                    or type(row.get('observedAt')) is not int):
                raise ValueError('invalid_drop_identity')
            if expected is not None and any(row.get(k) != expected.get(k) for k in
                    ('epoch', 'actorUuid', 'requestId', 'tool', 'args', 'nativeTaskId')):
                raise ValueError('drop_receipt_changed')
            if row.get('status') == 'rejected' and row.get('dispatched') is False:
                if row.get('result', {}).get('success') is not False:
                    raise ValueError('invalid_drop_rejection')
                return row
            if (row.get('dispatched') is not True or not isinstance(row.get('nativeTaskId'), str)
                    or not re.fullmatch(r't[0-9]+', row['nativeTaskId'])):
                raise ValueError('drop_task_unconfirmed')
            if row.get('status') in ('accepted', 'running'):
                return row
            result = row.get('result')
            if (row.get('status') != 'terminal' or row.get('nativeState') not in ('SUCCESS', 'FAILED', 'TIMEOUT', 'CANCELLED')
                    or not isinstance(result, dict) or type(result.get('success')) is not bool
                    or result['success'] != (row['nativeState'] == 'SUCCESS')
                    or type(row.get('completedAt')) is not int):
                raise ValueError('drop_terminal_unconfirmed')
            data = result.get('data', {})
            if (data.get('capability') != 'component_preserving_drop_v1' or data.get('item_id') != args['item_id']
                    or data.get('requested_count') != args['count'] or data.get('pickup_confirmed') is not False
                    or data.get('dimension') != before['dimension']):
                raise ValueError('drop_effect_identity_invalid')
            if result['success']:
                entities = data.get('entities')
                if (not isinstance(entities, list) or not 1 <= len(entities) <= 36
                        or any(type(data.get(k)) is not int for k in ('dropped_count', 'inventory_before', 'inventory_after'))
                        or data['dropped_count'] != args['count'] or data['inventory_after'] < 0
                        or data['inventory_before'] - data['inventory_after'] != args['count']):
                    raise ValueError('drop_quantity_unconfirmed')
                seen = set()
                for entity in entities:
                    entity_id = entity.get('entityUuid')
                    if (str(uuid.UUID(entity_id)) != entity_id or entity_id in seen
                            or entity.get('itemId') != args['item_id'] or entity.get('entityObserved') is not True
                            or entity.get('componentsVerified') is not True
                            or not isinstance(entity.get('componentSha256'), str)
                            or not re.fullmatch('[0-9a-f]{64}', entity['componentSha256'])
                            or type(entity.get('count')) is not int or not 1 <= entity['count'] <= 64
                            or type(entity.get('sourceSlot')) is not int or not 0 <= entity['sourceSlot'] < 36
                            or any(type(entity.get(k)) not in (int, float) or not math.isfinite(entity[k]) for k in ('x', 'y', 'z'))):
                        raise ValueError('drop_entity_unconfirmed')
                    seen.add(entity_id)
                if sum(entity['count'] for entity in entities) != args['count']:
                    raise ValueError('drop_entities_quantity_mismatch')
            return row
        except (ValueError, TypeError, KeyError, AttributeError) as error:
            raise GatewayError('drop_receipt_unconfirmed') from error

    def dispatch(self, action_id, before, args):
        actor = before['bodyUuid']
        # The gateway already persisted this request's uncertainty marker.
        # This is the only mutation send, including after a lost initial ACK.
        expected = None
        try:
            row = self._read(self.gateway._native_drop(actor, action_id, args),
                             action_id, before, args)
            expected = row if row.get('status') != 'rejected' else None
        except (OSError, ValueError, TypeError):
            row = None
        for attempt in range(self.max_polls + 1):
            if row and row['status'] in ('terminal', 'rejected'):
                return {**row['result'], 'nativeDropReceipt': row}
            if attempt == self.max_polls:
                break
            self.sleep(.2)
            row = self._read(self.gateway._native_dropping(actor, action_id),
                             action_id, before, args, expected)
            if expected is None:
                expected = row
        raise GatewayError('drop_outcome_unknown')
