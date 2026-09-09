"""Typed native rescue adapter, serialized with the existing Numen actuator.

The server owns landing selection, body binding, terrain checks and the durable
teleport receipt. This module never constructs a general-purpose teleport.
"""
from contextlib import contextmanager
import json
import os
from pathlib import Path
import sys
import uuid

from world_admin_tools import authorized_admin

KIRITO = 'd4ac9523-4962-43ed-98c5-19b49e104048'
YUI = 'e6ef6001-47c6-4f13-823c-1b724520d164'
PREFIX = 'QD_RESCUE_JSON '
QUOTE_AGE_MS = 180_000


class RescueBusy(ValueError):
    pass


def native_id(actor, request_id):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, 'qiandeng:admin:' + actor + ':' + request_id))


def native_reply(raw):
    if not isinstance(raw, str) or len(raw.encode('utf8')) > 8192 or not raw.strip().startswith(PREFIX):
        raise ValueError('rescue_reply_unconfirmed')
    data = json.loads(raw.strip()[len(PREFIX):])
    if not isinstance(data, dict) or data.get('schema') != 1:
        raise ValueError('rescue_reply_unconfirmed')
    return data


@contextmanager
def body_guard(run, state=None):
    """Use the same mutex as every Numen action; no mutation/ledger repair here."""
    root = Path(state or os.environ.get('SURVIVOR_RESCUE_STATE', '/survivor-state'))
    if not root.is_dir() or root.is_symlink():
        raise ValueError('survivor_state_unavailable')
    # Mounted read-only code; state is the original controller directory.
    source = str(Path(__file__).resolve().parents[1] / 'survival')
    if source not in sys.path:
        sys.path.insert(0, source)
    from numen_gateway import action_lock, read_json, GatewayError
    try:
        with action_lock(root):
            settings = read_json(root / 'settings.json')
            if settings.get('bodyUuid') != KIRITO or settings.get('bodyName') != 'Kirito':
                raise ValueError('rescue_body_binding_changed')
            if (root / 'unknown.json').exists():
                raise ValueError('body_outcome_unknown')
            if (root / 'inflight-action.json').exists():
                raise RescueBusy('body_receipt_in_flight')
            job = read_json(root / 'skill-job.json') if (root / 'skill-job.json').exists() else {}
            if job.get('status') in ('pending', 'running', 'dispatching'):
                raise RescueBusy('body_skill_in_flight')
            result = json.loads(run('numen_act invoke "Kirito" task_status {}'))
            # Numen's successful idle reply omits data; active replies include
            # data.task_id. Match the same contract as NumenGateway.snapshot.
            if (not isinstance(result, dict) or result.get('success') is not True
                    or ('data' in result and result['data'] is not None and not isinstance(result['data'], dict))):
                raise ValueError('body_idle_unconfirmed')
            if (result.get('data') or {}).get('task_id'):
                raise RescueBusy('body_task_in_flight')
            yield
    except GatewayError as error:
        if str(error) == 'action_busy':
            raise RescueBusy('body_action_busy') from error
        raise


class NativeRescue:
    def __init__(self, store, run, guard=None):
        self.store, self.run = store, run
        self.guard = guard or (lambda: body_guard(run))

    def _inspection(self, row, args):
        receipt = self.store.receipt(row['actor'], args['observationRequestId'])
        data = receipt.get('observation', {})
        quote = native_id(row['actor'], args['observationRequestId'])
        if (receipt.get('operation') != 'rescue_inspect' or receipt.get('status') != 'completed'
                or not isinstance(data, dict) or data.get('phase') != 'observed' or data.get('quoteId') != quote):
            raise ValueError('rescue_observation_required')
        age = self.store.stamp() - data.get('observedAt', 0)
        if not 0 <= age <= QUOTE_AGE_MS:
            raise ValueError('rescue_observation_expired')
        return quote, data

    @staticmethod
    def _result(data, action_id, quote, target):
        if (data.get('requestId') != action_id or data.get('quoteId') != quote or data.get('target') != target
                or data.get('phase') not in ('completed', 'rejected', 'unknown')):
            raise ValueError('rescue_receipt_identity_unconfirmed')
        phase = data['phase']
        if phase == 'completed':
            expected = KIRITO if target == 'kirito' else YUI
            before, after = data.get('before', {}), data.get('after', {})
            if (data.get('executionConfirmed') is not True or before.get('bodyUuid') != expected
                    or after.get('bodyUuid') != expected or before.get('dimension') != after.get('dimension')
                    or not isinstance(after.get('position'), list) or len(after['position']) != 3):
                raise ValueError('rescue_postcondition_unconfirmed')
        return phase, {'ok': phase == 'completed', 'code': data.get('code', phase),
                       'executionConfirmed': phase == 'completed', 'retryAutomatically': False,
                       'before': data.get('before'), 'after': data.get('after'),
                       'nativeRequestId': action_id, 'nativeReceipt': data}

    def perform(self, row, args):
        action_id, sent = native_id(row['actor'], row['id']), False
        try:
            if not authorized_admin(row['actor']):
                raise ValueError('admin_actor_required')
            if row['kind'] == 'rescue_inspect':
                data = native_reply(self.run('qdmaid rescue_inspect ' + action_id))
                if data.get('quoteId') != action_id or data.get('phase') not in ('observed', 'rejected'):
                    raise ValueError('rescue_inspection_unconfirmed')
                return ('completed' if data['phase'] == 'observed' else 'rejected'), {
                    'ok': data['phase'] == 'observed', 'code': data.get('code', data['phase']),
                    'executionConfirmed': False, 'observation': data}
            quote, observation = self._inspection(row, args)
            # Serializing both targets keeps the pair stable while native rescue
            # checks ownership and location on the Minecraft main thread.
            with self.guard():
                if not authorized_admin(row['actor']):
                    raise ValueError('admin_actor_required')
                if self.store.stamp() > row['expires']:
                    raise ValueError('expired_before_write')
                self.store.prepared(row, observation.get('pair', {}).get(args['target'], {}))
                sent = True
                data = native_reply(self.run('qdmaid rescue %s %s %s' % (action_id, quote, args['target'])))
                return self._result(data, action_id, quote, args['target'])
        except RescueBusy as error:
            return 'deferred', {'ok': True, 'code': str(error), 'executionConfirmed': False,
                                'notice': 'Waiting for the original body action to settle; no rescue was sent.'}
        except Exception as error:
            code = str(error) if isinstance(error, ValueError) and str(error).replace('_', '').isalnum() else 'precondition_unavailable'
            return ('unknown' if sent else 'rejected'), {
                'ok': False, 'code': 'outcome_unknown' if sent else code,
                'executionConfirmed': False, 'retryAutomatically': False, 'nativeRequestId': action_id}

    def reconcile(self, row):
        """Only query the original durable native receipt; never send rescue."""
        args = json.loads(row['args'])
        action_id = native_id(row['actor'], row['id'])
        data = native_reply(self.run('qdmaid rescue_status ' + action_id))
        status, receipt = self._result(data, action_id, native_id(row['actor'], args['observationRequestId']), args['target'])
        if status in ('completed', 'rejected'):
            self.store.reconcile_rescue(row, status, receipt)
