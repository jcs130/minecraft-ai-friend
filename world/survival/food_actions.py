"""Retain Numen's real timed eating result through the existing receipt bridge.

Never infer success from hunger or inventory, and never redispatch an old request.
"""
import json
import re

from numen_gateway import GatewayError


PREFIX = 'QD_WORLD_INTERACTION_JSON '


class FoodActions:
    def __init__(self, gateway):
        self.gateway = gateway

    def _read(self, raw, action_id, before, args, expected=None):
        try:
            rows = [line[len(PREFIX):] for line in raw.splitlines() if line.startswith(PREFIX)]
            if len(rows) != 1 or len(rows[0].encode('utf8')) > 12000:
                raise ValueError('invalid_food_envelope')
            row = json.loads(rows[0])
            if (row.get('schema') != 1 or row.get('capability') != 'numen_interaction_receipt_v1'
                    or row.get('actorUuid') != before['bodyUuid'] or row.get('requestId') != action_id
                    or row.get('tool') != 'eat' or row.get('args') != args
                    or not isinstance(row.get('epoch'), str) or not 1 <= len(row['epoch']) <= 128
                    or type(row.get('observedAt')) is not int):
                raise ValueError('invalid_food_identity')
            if expected is not None and any(row.get(key) != expected.get(key) for key in
                    ('epoch', 'actorUuid', 'requestId', 'tool', 'args', 'nativeTaskId')):
                raise ValueError('food_receipt_changed')
            if row.get('status') == 'rejected' and row.get('dispatched') is False:
                if not isinstance(row.get('result'), dict) or row['result'].get('success') is not False:
                    raise ValueError('invalid_food_rejection')
                return row
            if (row.get('dispatched') is not True or not isinstance(row.get('nativeTaskId'), str)
                    or not re.fullmatch(r't[0-9]+', row['nativeTaskId'])):
                raise ValueError('food_task_unconfirmed')
            if row.get('status') == 'terminal':
                result = row.get('result')
                if (row.get('nativeState') not in ('SUCCESS', 'FAILED', 'TIMEOUT', 'CANCELLED')
                        or not isinstance(result, dict) or type(result.get('success')) is not bool
                        or result['success'] != (row['nativeState'] == 'SUCCESS')
                        or type(row.get('completedAt')) is not int):
                    raise ValueError('invalid_food_terminal')
                return row
            if row.get('status') in ('accepted', 'running'):
                return row
            raise ValueError('food_outcome_unknown')
        except (ValueError, TypeError, KeyError, AttributeError) as error:
            raise GatewayError('food_receipt_unconfirmed') from error

    def dispatch(self, action_id, before, args):
        actor = before['bodyUuid']
        # action() has already durably reserved this exact ID under the shared lock.
        try:
            raw = self.gateway._native_eat(actor, action_id, args)
            row = self._read(raw, action_id, before, args)
        except (OSError, ValueError, TypeError):
            # A lost acknowledgement does not grant permission to consume again.
            raw = self.gateway._native_eating(actor, action_id)
            row = self._read(raw, action_id, before, args)
        if row['status'] in ('terminal', 'rejected'):
            return {**row['result'], 'nativeFoodReceipt': row}
        return {'success': True, 'message': 'Native eating accepted; await this exact food receipt.',
                'data': {'async': True, 'task_id': row['nativeTaskId'], 'task': 'eat'},
                'nativeFoodReceipt': row}

    def terminal(self, receipt):
        expected = receipt.get('result', {}).get('result', {}).get('nativeFoodReceipt')
        if not isinstance(expected, dict):
            raise GatewayError('food_receipt_unavailable')
        raw = self.gateway._native_eating(receipt['before']['bodyUuid'], receipt['actionId'])
        row = self._read(raw, receipt['actionId'], receipt['before'], receipt['args'], expected)
        return row if row['status'] == 'terminal' else None
