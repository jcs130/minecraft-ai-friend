"""Consume Kirito's party lane in his existing durable controller."""
import os
from pathlib import Path
import sys

SIDECAR = Path('/party-code') if Path('/party-code').is_dir() else Path(__file__).resolve().parents[1] / 'sidecar'
if str(SIDECAR) not in sys.path:
    sys.path.insert(0, str(SIDECAR))
from party_config import PartyConfig, recipient_tools
from party_messages import PartyMessages
from party_bridge import message_context
from party_world import GameSpeech, reconcile_world, delivery_result, speech_text


class SurvivorParty:
    def __init__(self, root=None, *, game=None):
        self.config = PartyConfig(root or os.environ.get('PARTY_STATE_DIR', '/party-state'))
        self._queue = None
        self.game = game or GameSpeech()

    @property
    def queue(self):
        if self._queue is None:
            self._queue = PartyMessages(self.config.root, self.config.binding)
        return self._queue

    def pending(self):
        if not self.config.configured():
            return None
        if self.queue.active_for_recipient('qd-survivor'):
            # Called at a controller boundary with no active turn. A leftover
            # UNKNOWN/submitted delivery must be reconciled, never bypassed.
            raise ValueError('party_delivery_unresolved')
        return self.queue.next_pending('qd-survivor')

    def heard_replies(self):
        return self.queue.heard_replies('qd-survivor') if self.config.configured() else []

    def consume_replies(self, event_ids, task_id):
        return self.queue.consume_replies('qd-survivor', event_ids, task_id)

    def validate_session(self, session, settings, reservation=None):
        if not self.config.configured():
            return True
        member = self.config.member('qd-survivor')
        expected = {'agentId': 'qd-survivor', 'bodyUuid': settings['bodyUuid'],
                    'ownerUuid': settings['ownerUuid'], 'sessionId': session.get('primarySessionId'),
                    'userId': session.get('userId'), 'channel': session.get('channel')}
        if (session.get('agentId') != 'qd-survivor' or session.get('bodyUuid') != settings['bodyUuid']
                or any(member.get(k) != v for k, v in expected.items())):
            raise ValueError('party_life_session_changed')
        if reservation is not None:
            self.config.validate_recipient('qd-survivor', reservation)
        return True

    def context(self, message):
        return message_context(message)

    def reserve(self, message):
        result = self.queue.reserve_dispatch(message['messageId'], 'qd-survivor')
        return result | {'ok': result.get('claimed') is True, 'blocked': result.get('claimed') is not True}

    def submitted(self, reservation, task_id):
        return self.queue.mark_submitted(reservation['reservationId'], task_id)

    def answered(self, reservation, task_id, text, *, allow_dispatch=True):
        if not text:
            return self.failed(reservation, task_id, 'native_no_final_answer')
        try:
            speech_text(text)
        except ValueError:
            return self.failed(reservation, task_id, 'native_answer_invalid_for_speech')
        row = self.queue.mark_answered(reservation['reservationId'], task_id, text)
        event = reconcile_world(self.queue, self.game, row['replyDelivery']['eventId'], allow_dispatch=allow_dispatch)
        return delivery_result(event)

    def failed(self, reservation, task_id, reason='native_task_failed'):
        self.queue.mark_failed(reservation['reservationId'], task_id, reason)
        return {'settled': True, 'heard': False, 'status': 'failed'}

    def deferred(self, reservation, reason):
        return self.queue.mark_deferred(reservation['reservationId'], reason)

    def request_context(self):
        from mcp_server import TOOL_NAMES
        ops = Path('/ops') if Path('/ops').is_dir() else Path(__file__).resolve().parents[1] / 'ops'
        if str(ops) not in sys.path:
            sys.path.insert(0, str(ops))
        from agent_learning import TOOL_NAMES as LEARNING_TOOLS
        return {'subagent_allowed_tools': recipient_tools('numen_survival', TOOL_NAMES, LEARNING_TOOLS)}
