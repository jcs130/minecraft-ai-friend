"""Read the original bounded native mining task; idle or inventory never proves it."""
import json
import math
import re
import uuid

from numen_gateway import GatewayError

PREFIX = 'QD_WORLD_INTERACTION_JSON '


class MineActions:
    def __init__(self, gateway):
        self.gateway = gateway

    def _read(self, raw, action_id, before, args, expected=None):
        try:
            lines = [line[len(PREFIX):] for line in raw.splitlines() if line.startswith(PREFIX)]
            if len(lines) != 1 or len(lines[0].encode('utf8')) > 16000:
                raise ValueError('invalid_mine_envelope')
            row = json.loads(lines[0])
            if (type(row.get('schema')) is not int or row['schema'] != 1
                    or row.get('capability') != 'numen_interaction_receipt_v1'
                    or row.get('actorUuid') != before['bodyUuid'] or row.get('requestId') != action_id
                    or row.get('tool') != 'mine' or row.get('args') != args
                    or str(uuid.UUID(row.get('epoch', ''))) != row['epoch']
                    or type(row.get('observedAt')) is not int):
                raise ValueError('invalid_mine_identity')
            if expected is not None and any(row.get(key) != expected.get(key) for key in
                    ('epoch', 'actorUuid', 'requestId', 'tool', 'args', 'nativeTaskId', 'miningSelection')):
                raise ValueError('mine_receipt_changed')
            if row.get('status') == 'rejected' and row.get('dispatched') is False:
                if not isinstance(row.get('result'), dict) or row['result'].get('success') is not False:
                    raise ValueError('invalid_mine_rejection')
                return row
            selection = row.get('miningSelection', {})
            origin = selection.get('origin', {})
            if (row.get('dispatched') is not True or not isinstance(row.get('nativeTaskId'), str)
                    or not re.fullmatch(r't[0-9]+', row['nativeTaskId'])
                    or selection.get('radius') != 16 or selection.get('loadedOnly') is not True
                    or selection.get('candidateLimit') != 64 or type(selection.get('candidateCount')) is not int
                    or not 1 <= selection['candidateCount'] <= 64 or type(selection.get('truncated')) is not bool
                    or selection.get('dimension') != before['dimension']
                    or any(type(origin.get(k)) not in (int, float) or not math.isfinite(origin[k]) for k in ('x', 'y', 'z'))):
                raise ValueError('mine_task_unconfirmed')
            if row.get('status') in ('accepted', 'running'):
                return row
            result = row.get('result')
            if (row.get('status') != 'terminal' or row.get('nativeState') not in ('SUCCESS', 'FAILED', 'TIMEOUT', 'CANCELLED')
                    or not isinstance(result, dict) or type(result.get('success')) is not bool
                    or result['success'] != (row['nativeState'] == 'SUCCESS')
                    or type(row.get('completedAt')) is not int):
                raise ValueError('invalid_mine_terminal')
            data = result.get('data', {})
            # Precondition failures can lack progress data; successes must carry the
            # native item tally. Preserve the real failure message in either case.
            if result['success'] or data:
                if (type(data.get('requested')) is not int or data['requested'] != args['count']
                        or type(data.get('gathered')) is not int or data['gathered'] < 0
                        or not isinstance(data.get('target'), str)):
                    raise ValueError('invalid_mine_quantity')
            return row
        except (ValueError, TypeError, KeyError, AttributeError) as error:
            failure = GatewayError('mine_receipt_unconfirmed')
            failure.native_reply = raw if isinstance(raw, str) else None
            raise failure from error

    def dispatch(self, action_id, before, args):
        actor = before['bodyUuid']
        try:
            row = self._read(self.gateway._native_mine(actor, action_id, args), action_id, before, args)
        except (OSError, ValueError, TypeError) as initial_error:
            # One write only. A missing or malformed ACK permits only reading the
            # durable original request; it never permits another mining command.
            try:
                row = self._read(self.gateway._native_mining(actor, action_id), action_id, before, args)
            except (OSError, ValueError, TypeError):
                raise initial_error
        if row['status'] in ('terminal', 'rejected'):
            return {**row['result'], 'nativeMineReceipt': row}
        return {'success': True, 'message': 'Native mining accepted within 16 blocks; await this exact receipt. '
                    'Candidate selection is bounded; native navigation is not a physical area barrier.',
                'data': {'async': True, 'task_id': row['nativeTaskId'], 'task': 'mine'},
                'nativeMineReceipt': row}

    def terminal(self, receipt):
        expected = receipt.get('result', {}).get('result', {}).get('nativeMineReceipt')
        if not isinstance(expected, dict):
            raise GatewayError('mine_receipt_unavailable')
        row = self._read(self.gateway._native_mining(receipt['before']['bodyUuid'], receipt['actionId']),
            receipt['actionId'], receipt['before'], receipt['args'], expected)
        return row if row['status'] == 'terminal' else None
