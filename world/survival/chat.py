"""Lease-bound nearby captions with a native receipt, independent of optional audio."""
import hashlib
import json
from pathlib import Path
import re
import unicodedata
import uuid

from numen_gateway import GatewayError, read_json, write_json

STORAGE = 'qiandeng:survivor_chat'
MESSAGE_ID = re.compile(r'say-[0-9a-f]{40}\Z')
RECENT_LIMIT = 256


def narration_context(state, now):
    """Read at most 256 local receipts; ``now`` is Unix seconds, as for clocks.

    This is evidence for the actor's next decision, never a speaking schedule.
    Unknown sends remain unknown and are never reconciled or replayed here.
    """
    root = Path(state) / 'public-chat'
    candidates = []
    for path in root.glob('say-*.json'):
        try:
            candidates.append((path.stat().st_mtime_ns, path))
        except OSError:
            continue
    candidates.sort(key=lambda item: item[0], reverse=True)
    partial = len(candidates) > RECENT_LIMIT or (root / 'archive').exists()
    rows = []
    for _, path in candidates[:RECENT_LIMIT]:
        try:
            row = read_json(path)
            if (isinstance(row, dict) and MESSAGE_ID.fullmatch(str(row.get('messageId', '')))
                    and type(row.get('createdAt')) is int):
                rows.append(row)
            else:
                partial = True
        except (OSError, ValueError):
            partial = True
    sent = [row for row in rows if row.get('textStatus') == 'sent']
    unknown = [row for row in rows if row.get('textStatus') == 'unknown']
    latest = max(sent, key=lambda row: row['createdAt']) if sent else None
    pending = max(unknown, key=lambda row: row['createdAt']) if unknown else None
    last_sent = None
    if latest:
        confirmed_at = latest.get('confirmedAt', latest['createdAt'])
        if type(confirmed_at) is not int:
            confirmed_at = latest['createdAt']
        last_sent = {'messageId': latest['messageId'], 'confirmedAt': confirmed_at,
                     'secondsAgo': max(0, int(now - confirmed_at / 1000)),
                     'text': str(latest.get('text', ''))[:80]}
    return {'lastSent': last_sent,
            'neverSent': False if sent else None if partial or unknown else True,
            'unknownMessageId': pending['messageId'] if pending else None,
            'historyPartial': partial, 'listenerConfirmed': False,
            'notice': '仅为附近公屏的服务器发送记录，不证明观众已看到或听到。'
                'unknown只可say_status查原messageId，不重复发送。'}


class ChatTools:
    def __init__(self, gateway, skills, speech):
        self.gateway, self.skills, self.speech = gateway, skills, speech
        self.root = Path(gateway.state) / 'public-chat'

    @staticmethod
    def validate(text, voice):
        if (not isinstance(text, str) or not 1 <= len(text.strip()) <= 160
                or any(unicodedata.category(c) in ('Cc', 'Cs', 'Cf', 'Zl', 'Zp') for c in text)
                or type(voice) is not bool):
            raise GatewayError('invalid_say_arguments')
        return text.strip()

    @staticmethod
    def native_path(actor, message_id):
        if str(uuid.UUID(actor)) != actor or not MESSAGE_ID.fullmatch(message_id):
            raise GatewayError('invalid_say_identity')
        return 'actor_' + uuid.UUID(actor).hex + '.event_' + message_id[4:]

    def _save(self, row):
        write_json(self.root / (row['messageId'] + '.json'), row)

    def _path(self, message_id):
        path = self.root / (message_id + '.json')
        return path if path.exists() else self.root / 'archive' / path.name

    def _archive_oldest_confirmed(self, rows):
        """Bound native storage without discarding historical or unknown evidence."""
        if len(rows) < RECENT_LIMIT:
            return
        known = [row for row in rows if row.get('textStatus') in ('sent', 'not_sent')]
        if not known:
            return
        row = min(known, key=lambda item: item['createdAt'])
        native_path = self.native_path(row['actor'], row['messageId'])
        write_json(self.root / 'archive' / (row['messageId'] + '.json'), row)
        try:
            # Only a confirmed own receipt is removed; this is idempotent metadata
            # cleanup, never a second dispatch. Failure keeps the current record.
            self.gateway.rcon.cmd('data remove storage ' + STORAGE + ' ' + native_path)
        except Exception:
            return
        (self.root / (row['messageId'] + '.json')).unlink()

    def _read_native(self, row):
        """A read can resolve a lost response; it can never repeat tellraw."""
        if row['textStatus'] != 'unknown':
            return
        try:
            raw = self.gateway.rcon.cmd('data get storage ' + STORAGE + ' '
                                        + self.native_path(row['actor'], row['messageId']))
            # Native data-get returns the final SNBT scalar. Do not infer success
            # from an empty RCON reply or arbitrary text mentioning a number.
            marker = 'Storage ' + STORAGE + ' has the following contents: '
            value = raw.strip().split(marker, 1)
            if len(value) != 2 or value[0] or value[1] not in ('0b', '1b'):
                return
            row['textStatus'] = 'sent' if value[1] == '1b' else 'not_sent'
            row['confirmedAt'] = int(self.gateway.clock() * 1000)
            self._save(row)
        except (OSError, ValueError, ConnectionError):
            return

    def _result(self, row):
        audio = {'requested': row['voice'], 'status': 'not_requested', 'playbackCompleted': False}
        if row.get('audio'):
            audio.update(row['audio'])
            if audio.get('utteranceId'):
                try:
                    audio.update(self.speech.status(audio['utteranceId']))
                except Exception:
                    audio.update(status='unknown', playbackCompleted=False)
        elif row['voice']:
            audio['status'] = 'not_submitted'
        sent = row['textStatus'] == 'sent'
        return {'ok': sent, 'code': 'chat_sent' if sent else 'chat_' + row['textStatus'],
                'messageId': row['messageId'], 'textDelivery': {
                    'status': row['textStatus'], 'serverConfirmed': row['textStatus'] != 'unknown',
                    'serverSent': sent, 'clientDisplayConfirmed': False, 'scope': 'nearby', 'radius': 24},
                'audio': audio, 'partnerInput': False, 'retryAutomatically': False,
                'instruction': '文字与音频分别看回执；文字sent表示服务器已发给附近玩家，不证明真人已阅读。'
                    '音频失败不影响已发送文字。给结衣传话或求助用party_send；此工具不会唤醒伙伴。'
                    'unknown只能say_status查原messageId，不重新发送。'}

    def say(self, turn_id, text, voice=True):
        def send(_):
            text_value = self.validate(text, voice)
            name, actor = self.gateway._check_binding()
            if not isinstance(name, str) or not re.fullmatch(r'[A-Za-z0-9_]{1,16}', name):
                raise GatewayError('invalid_say_identity')
            message_id = 'say-' + hashlib.sha256((actor + '\0' + turn_id).encode()).hexdigest()[:40]
            path = self._path(message_id)
            native_path = self.native_path(actor, message_id)
            if path.exists():
                row = read_json(path)
                if row.get('text') != text_value or row.get('voice') != voice or row.get('actor') != actor:
                    raise GatewayError('say_request_conflict')
                self._read_native(row)
                return self._result(row)
            now = int(self.gateway.clock() * 1000)
            paths = list(self.root.glob('say-*.json')) if self.root.exists() else []
            existing = [read_json(path) for path in paths]
            if len(existing) >= 4096:
                raise GatewayError('say_journal_full')
            for previous in existing:
                if now - previous.get('createdAt', 0) < 10000:
                    raise GatewayError('say_rate_limited')
            self._archive_oldest_confirmed(existing)
            # Only constant command tokens and validated identities enter syntax.
            # Quotes, slashes, selectors and braces in text remain JSON literals.
            component = [{'text': '[附近] '}, {'selector': actor}, {'text': '：' + text_value}]
            command = ('execute as ' + actor + ' at @s store success storage ' + STORAGE + ' '
                       + native_path + ' byte 1 run tellraw @a[distance=..24,name=!' + name + '] '
                       + json.dumps(component, ensure_ascii=False, separators=(',', ':')))
            if len(command.encode('utf-8')) > 1446:
                raise GatewayError('say_command_too_large')
            row = {'schema': 1, 'messageId': message_id, 'actor': actor, 'text': text_value,
                   'voice': voice, 'createdAt': now, 'textStatus': 'unknown'}
            # Persist before the only write. Any exception/crash leaves a read-only
            # reconciliation path; even "not found" never authorizes replay.
            self._save(row)
            try:
                self.gateway.rcon.cmd(command)
            except Exception:
                pass
            self._read_native(row)
            if voice and row['textStatus'] == 'sent':
                # Already holding SkillTools' action lock: use the broker directly,
                # never recurse into SpeechTools.speak and deadlock the same lease.
                audio_id = 'speech-' + hashlib.sha256((actor + '\0turn:' + turn_id).encode()).hexdigest()[:40]
                row['audio'] = {'utteranceId': audio_id, 'status': 'unknown', 'playbackCompleted': False}
                self._save(row)
                try:
                    dimension = self.gateway._invoke('get_self_status').get('dimension')
                    row['audio'] = self.speech.broker.submit(actor, 'turn:' + turn_id, text_value, dimension)
                except Exception as exc:
                    row['audio']['code'] = 'audio_submit_' + type(exc).__name__
                self._save(row)
            return self._result(row)
        return self.skills._write(turn_id, send)

    def status(self, message_id):
        from numen_gateway import action_lock
        try:
            if not isinstance(message_id, str) or not MESSAGE_ID.fullmatch(message_id):
                raise ValueError('invalid_say_identity')
            with action_lock(self.gateway.state):
                row = read_json(self._path(message_id))
                if row.get('actor') != self.gateway._settings()['bodyUuid']:
                    raise ValueError('say_not_owned')
                self._read_native(row)
                return self._result(row)
        except (OSError, ValueError, KeyError):
            return {'ok': False, 'code': 'say_receipt_unavailable', 'retryAutomatically': False}
