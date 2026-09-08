"""Speech tools bound to the same body and turn lease as the survivor."""
import os
from pathlib import Path
import sys

_source_shared = Path(__file__).resolve().parents[1] / 'sidecar'
if _source_shared.is_dir():
    sys.path.append(str(_source_shared))

from character_speech import SpeechBroker


class SpeechTools:
    def __init__(self, gateway, skill_tools, broker=None):
        self.gateway, self.skills = gateway, skill_tools
        self._broker = broker

    @property
    def broker(self):
        if self._broker is None:
            path = os.environ.get('GV_BASE')
            if path != '/godvoice':
                raise ValueError('speech_queue_unconfigured')
            self._broker = SpeechBroker(Path(path), clock=self.gateway.clock)
        return self._broker

    def speak(self, turn_id, text, interrupt=False):
        def submit(lease):
            from numen_gateway import GatewayError
            try:
                _, actor = self.gateway._check_binding()
                status = self.gateway._invoke('get_self_status')
                return self.broker.submit(actor, 'turn:' + turn_id, text,
                                          status.get('dimension'), interrupt)
            except ValueError as exc:
                raise GatewayError(str(exc)) from exc
        # Speech cannot issue movement, close the action lease or spend a model call.
        # Id derives from actor+turn, so at most one utterance is accepted per turn.
        return self.skills._write(turn_id, submit)

    def cancel(self, turn_id):
        def stop(lease):
            from numen_gateway import GatewayError
            try:
                actor = self.gateway._settings()['bodyUuid']
                return self.broker.cancel(actor)
            except ValueError as exc:
                raise GatewayError(str(exc)) from exc
        return self.skills._write(turn_id, stop)

    def status(self, utterance_id):
        try:
            return self.broker.receipt(self.gateway._settings()['bodyUuid'], utterance_id)
        except (ValueError, OSError, KeyError):
            return {'ok': False, 'code': 'speech_receipt_unavailable', 'retryAutomatically': False}
