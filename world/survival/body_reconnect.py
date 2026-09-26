"""Bounded reconnection of an existing saved body; no inference or gameplay policy.

A failed perception is not evidence of a missing body. Read the native live
roster first, then call only the strict saved-UUID restore command. Persist the
external-effect boundary before sending; unknown outcomes are never replayed.
"""
import json
import math
import re
import time
import uuid

from numen_gateway import GatewayError, action_lock, read_json, read_controller_json, write_json

PREFIX = 'QD_NUMEN_RESTORE_JSON '
CAPABILITY = 'existing_body_restore_v1'
# A body-loss pause is exactly the state this reconnector exists to resolve.
# In-game death (a normal survival event) and mid-decision body loss both land
# here; the strict restore command's own dead-branch handles respawn, so the
# channel must stay open or the pause can never lift without an operator.
BODY_PAUSE_REASONS = frozenset({'body_lost_during_decision', 'body_dead'})
DEATH_PREFLIGHT_REJECTIONS = frozenset({'death_respawn_delay', 'death_safe_spawn_unavailable'})
# 这些 blocked 理由属于“需复核但身体可能已由别的路径回来”——允许按节律做只读
# roster 观察并自愈；绝不代表可以自行再次派发 restore（硬闸仍尊重）。
OBSERVATION_RECOVERABLE = frozenset({'saved_task_requires_review'})
# 有界自动召唤（幂等 summon 复用原 UUID/存档、不重放动作）：连续缺席这么多次才召、
# 一天最多这么多次，仍不行回落人工。硬闸理由不走此路。
SUMMON_AFTER_ABSENT = 3
MAX_AUTO_SUMMONS = 5


def episode_attempts(state, now):
    """Current unsuccessful episode, including safe preflight refusals for backoff."""
    attempts = state.get('attempts', [])
    if (not isinstance(attempts, list) or any(type(at) not in (int, float)
            or not math.isfinite(at) or at < 0 for at in attempts)):
        raise ValueError('restore_attempt_history_invalid')
    verified = state.get('verifiedAt')
    verified = verified if type(verified) in (int, float) and math.isfinite(verified) and 0 <= verified <= now else None
    return [at for at in attempts if now - at < 86400 and (verified is None or at > verified)]


def unverified_attempts(state, now):
    """Exclude only exact, validated pre-constructor refusals from dispatch quota."""
    attempts = episode_attempts(state, now)
    rejected = set()
    receipts = state.get('preflightRejections', [])
    for receipt in receipts if isinstance(receipts, list) else []:
        if not isinstance(receipt, dict):
            continue
        at, ended = receipt.get('attemptAt'), receipt.get('rejectedAt')
        if (receipt.get('phase') == 'rejected' and receipt.get('code') in DEATH_PREFLIGHT_REJECTIONS
                and type(at) in (int, float) and type(ended) in (int, float)
                and math.isfinite(at) and math.isfinite(ended) and 0 <= at <= ended <= now):
            rejected.add(at)
    return [at for at in attempts if at not in rejected]


def binding(settings):
    name = settings.get('bodyName')
    if not isinstance(name, str) or not re.fullmatch(r'[A-Za-z0-9_]{1,16}', name):
        raise ValueError('restore_identity_missing')
    result = {'bodyName': name}
    for key in ('bodyUuid', 'ownerUuid'):
        value = settings.get(key)
        if not isinstance(value, str) or str(uuid.UUID(value)) != value:
            raise ValueError('restore_identity_missing')
        result[key] = value
    return result


def roster_online(raw, expected):
    if not isinstance(raw, str) or len(raw.encode('utf8')) > 32768:
        raise ValueError('restore_roster_invalid')
    lines = [line.strip() for line in raw.strip().splitlines() if line.strip()]
    if not lines or not re.fullmatch(r'count=\d{1,3}', lines[0]):
        raise ValueError('restore_roster_invalid')
    count = int(lines[0][6:])
    if count > 64:
        raise ValueError('restore_roster_invalid')
    # The roster may append a catalogue section for companions that are in the registry
    # but not in the world (dead, or waiting on a respawn). Presence is the online
    # section only: counting a dead body as presence would report a lost body as found,
    # which is the one mistake this reconnector must not make.
    online = lines[1:1 + count]
    tail = lines[1 + count:]
    if len(online) != count or (tail and not re.fullmatch(r'dead=\d{1,3}', tail[0])):
        raise ValueError('restore_roster_invalid')
    matches = []
    for line in online:
        fields = line.split('|')
        if len(fields) < 5:
            raise ValueError('restore_roster_invalid')
        values = dict(part.split('=', 1) for part in fields[1:])
        if fields[0] == expected['bodyName'] or values.get('uuid') == expected['bodyUuid']:
            if (fields[0] != expected['bodyName'] or values.get('uuid') != expected['bodyUuid']
                    or values.get('owner') != expected['ownerUuid']):
                raise ValueError('restore_live_identity_conflict')
            matches.append(values)
    if len(matches) > 1:
        raise ValueError('restore_live_identity_conflict')
    return bool(matches)


class BodyReconnect:
    def __init__(self, gateway, clock=time.time):
        self.gateway, self.root, self.clock = gateway, gateway.state, clock
        self.path = self.root / 'body-reconnect.json'

    def tick(self, settings):
        try:
            with action_lock(self.root):
                return self._tick(settings)
        except GatewayError as error:
            if str(error) == 'action_busy':
                return {'status': 'waiting', 'reason': 'action_busy'}
            raise

    def confirm_online(self, settings, body=None):
        """Reconcile a previous uncertain restore using only the live roster.

        This path is safe while paused or holding a gameplay lease: it never
        enters the restore dispatcher and never clears another action's unknown
        marker. A healthy snapshot alone does not verify the saved owner.
        """
        if not self.path.exists():
            return None
        try:
            with action_lock(self.root):
                state = read_json(self.path)
                expected = binding(settings)
                if any(state.get(key) != value for key, value in expected.items()):
                    return {'status': 'blocked', 'reason': 'restore_binding_changed'}
                restored_death = state.get('status') == 'blocked' and state.get('reason') == 'body_dead'
                if restored_death and not (isinstance(body, dict) and body.get('ok') is True
                        and body.get('bodyUuid') == expected['bodyUuid']
                        and body.get('bodyName') == expected['bodyName']
                        and body.get('gameMode') == 'survival'
                        and type(body.get('hp')) in (int, float) and math.isfinite(body['hp']) and body['hp'] > 0):
                    return state
                if state.get('status') not in ('reserved', 'unknown', 'restoring') and not restored_death:
                    return state
                now = self.clock()
                if now < state.get('nextConfirmationAt', 0):
                    return state
                # Independent of restore backoff: a healthy body can confirm a
                # lost response promptly, but repeated read failures stay bounded.
                state.update(confirmationCheckedAt=now, nextConfirmationAt=now + 60)
                try:
                    online = roster_online(self.gateway._native_roster(), expected)
                    if online:
                        state.update(status='online', reason='identity_verified', verifiedAt=now,
                                     readFailures=0, confirmationReason='identity_verified')
                    elif not restored_death:
                        state.update(status='unknown', reason='restore_outcome_unknown',
                                     confirmationReason='restore_not_observed')
                except Exception as error:
                    conflict = str(error) == 'restore_live_identity_conflict'
                    state.update(status='blocked' if conflict or restored_death else 'unknown',
                                 reason='restore_live_identity_conflict' if conflict else 'body_dead' if restored_death else 'restore_outcome_unknown',
                                 confirmationReason=str(error) if isinstance(error, ValueError)
                                 else 'restore_roster_unavailable')
                write_json(self.path, state)
                return state
        except GatewayError as error:
            if str(error) == 'action_busy':
                return None
            raise

    def _auto_resume(self, control, resume_after_restore, now):
        """Lift a body-loss pause once the body is verifiably back.

        Mirrors control.py resume's exact write (enabled=True, pauseReason=None)
        so the supervised loop resumes decisions without an operator. Only the
        pause reasons that gate on body presence qualify; every other stop
        (operator, unknown marker, model policy) keeps its explicit resume.
        """
        if not resume_after_restore:
            return
        control.update(enabled=True, pauseReason=None,
                       autoResumedAt=now, autoResumeReason='body_restored')
        write_json(self.root/'control.json', control)

    def _tick(self, settings):
        now = self.clock()
        # Recheck authorization under the same lock as every game action.
        control = read_json(self.root/'control.json')
        controller = read_controller_json(self.root/'controller.json') if (self.root/'controller.json').exists() else {}
        lease = read_json(self.root/'lease.json') if (self.root/'lease.json').exists() else {}
        # Body-loss pauses keep the restore channel open: resolving the missing
        # body is the only way out of that pause, and the strict restore command
        # revalidates every guard (identity, task ledger, playerdata) itself.
        resume_after_restore = (control.get('enabled') is not True
                                and control.get('pauseReason') in BODY_PAUSE_REASONS)
        # blocked recovery runs BEFORE the active-decision authorization gate: a leftover
        # or in-flight decision must not starve it (that starvation was the second
        # “起不来/要等运维” root, observed live 2026-09-26). Identity is computed
        # best-effort here — a settings bundle that cannot bind is left to the gate and
        # dispatch below (which raise the same way as before), so this never newly raises.
        try:
            expected = binding(settings)
            state = read_json(self.path) if self.path.exists() else {'schema': 1, **expected, 'attempts': []}
        except ValueError:
            expected = None
        if expected is not None:
            if any(state.get(key) != value for key, value in expected.items()):
                return {'status': 'blocked', 'reason': 'restore_binding_changed'}
        # 硬闸（身份冲突/绑定变更）保持人工；“需复核”类理由按节律只读 roster 观察即可自愈，
        # 不再空转成永久死锁；身体确实缺席时有界自动 summon 兜底。恢复排在授权闸之前，
        # 但只读观察本身安全、自动 summon 另有 unknown/lease 护栏，绝不抢未决动作。
        if expected is not None and state.get('status') == 'blocked':
            if (state.get('reason') in OBSERVATION_RECOVERABLE
                    and now >= state.get('nextCheckAt', 0)):
                state['checkedAt'] = now
                state['nextCheckAt'] = now + 60
                try:
                    online = roster_online(self.gateway._native_roster(), expected)
                except Exception:
                    online = False   # 观察不确定：保持 blocked，下一轮再试，绝不自作派发
                if online:
                    state.update(status='online', reason='identity_verified',
                                 verifiedAt=now, readFailures=0)
                    self._auto_resume(control, resume_after_restore, now)
                    write_json(self.path, state)
                    return state
                # 身体确认不在：saved_task_requires_review 是 numen 侧那道“遗留动作待复核”
                # 挡住了按原身份 restore，但幂等 summon（按 bodyName 复用原 UUID 与存档、
                # 不重放任何动作）能自愈——过去只能等运维手动 summon。这里做**有界**自动召唤：
                # 连续缺席 SUMMON_AFTER_ABSENT 次、每天至多 MAX_AUTO_SUMMONS 次，仍失败则回落到
                # 人工；身份冲突/绑定变更等硬闸不走此路。
                absent = int(state.get('absentStreak', 0)) + 1
                state['absentStreak'] = absent
                summoned = state.get('autoSummons', [])
                summoned = [t for t in summoned if isinstance(t, (int, float)) and now - t < 86400]
                if (absent >= SUMMON_AFTER_ABSENT and len(summoned) < MAX_AUTO_SUMMONS
                        and not (self.root/'unknown.json').exists()
                        and lease.get('status') != 'unknown'
                        and not (lease.get('status') == 'open' and lease.get('expiresAt', 0) > now * 1000)):
                    state['autoSummons'] = summoned + [now]
                    try:
                        self.gateway._native_summon(expected['ownerUuid'], expected['bodyName'])
                        state['lastAutoSummonAt'] = now
                        state['nextCheckAt'] = now + 20   # 召唤后尽快复查 roster 是否回来
                    except Exception:
                        pass   # 召唤不确定：保持 blocked，靠节律与配额兜底，绝不无界重试
                write_json(self.path, state)
            return state
        # Normal restore dispatch stays behind the full authorization gate (blocked
        # recovery already ran above, so an active decision can no longer starve it).
        if ((control.get('enabled') is not True and not resume_after_restore)
                # A decision record left over from the moment the body disappeared must
                # not block the restore: a body-loss pause means that decision cannot
                # proceed at all, which is precisely why this channel is kept open for
                # it. Without this the two guards contradict each other and nothing
                # restores the body - observed live on 2026-09-18.
                or (controller.get('active') and not resume_after_restore)
                or (self.root/'unknown.json').exists() or lease.get('status') == 'unknown'
                or (lease.get('status') == 'open' and lease.get('expiresAt', 0) > now * 1000)):
            return {'status': 'waiting', 'reason': 'restore_not_authorized'}
        if expected is None:
            # binding failed above but the gate passed; raise/re-read as the original
            # post-gate dispatch did (restore_identity_missing propagates here).
            expected = binding(settings)
            state = read_json(self.path) if self.path.exists() else {'schema': 1, **expected, 'attempts': []}
            if any(state.get(key) != value for key, value in expected.items()):
                return {'status': 'blocked', 'reason': 'restore_binding_changed'}
        attempts = unverified_attempts(state, now)
        episode = episode_attempts(state, now)
        # Earlier versions counted successful maintenance restores against a daily
        # lifetime quota. Only that obsolete limit may bypass its old backoff;
        # uncertainty and all other read/rejection backoffs retain their boundary.
        verified = state.get('verifiedAt')
        cleared_old_limit = (state.get('status') == 'waiting' and state.get('reason') == 'restore_attempt_limit'
            and type(verified) in (int, float) and math.isfinite(verified) and 0 <= verified <= now
            and len(attempts) < 3 and any(at <= verified for at in state.get('attempts', [])))
        if now < state.get('nextCheckAt', 0) and not cleared_old_limit:
            return state
        state['checkedAt'] = now
        state['nextCheckAt'] = now + 60
        try:
            online = roster_online(self.gateway._native_roster(), expected)
        except Exception as error:
            uncertain = state.get('status') in ('reserved', 'unknown', 'restoring')
            state.update(status='unknown' if uncertain else 'waiting',
                         reason='restore_outcome_unknown' if uncertain else
                         (str(error) if isinstance(error, ValueError) else 'restore_roster_unavailable'))
            state['readFailures'] = min(8, state.get('readFailures', 0) + 1)
            state['nextCheckAt'] = now + min(900, 30 * 2 ** state['readFailures'])
            if str(error) == 'restore_live_identity_conflict':
                state['status'] = 'blocked'
            write_json(self.path, state)
            return state
        state['readFailures'] = 0
        if online:
            state.update(status='online', reason='identity_verified', verifiedAt=now)
            self._auto_resume(control, resume_after_restore, now)
            write_json(self.path, state)
            return state
        if state.get('status') in ('reserved', 'unknown', 'restoring'):
            # We cannot distinguish a failed native constructor from a lost reply.
            state.update(status='unknown', reason='restore_outcome_unknown')
            write_json(self.path, state)
            return state
        if len(attempts) >= 3:
            state.update(status='waiting', reason='restore_attempt_limit', nextCheckAt=min(attempts)+86400)
            write_json(self.path, state)
            return state
        state.update(status='reserved', reason='restore_reserved', attempts=state.get('attempts', [])+[now])
        write_json(self.path, state)
        try:
            raw = self.gateway._native_restore_existing(expected['bodyUuid'], expected['ownerUuid'], expected['bodyName'])
            if not isinstance(raw, str) or len(raw.encode('utf8')) > 4096 or not raw.strip().startswith(PREFIX):
                raise ValueError('restore_reply_invalid')
            result = json.loads(raw.strip()[len(PREFIX):])
            if (not isinstance(result, dict) or result.get('schema') != 1 or result.get('capability') != CAPABILITY
                    or any(result.get(key) != value for key, value in expected.items())
                    or type(result.get('ok')) is not bool):
                raise ValueError('restore_reply_invalid')
            if result['ok'] and result.get('phase') in ('restored', 'observed'):
                # Final confirmation is a separate native live-roster observation.
                state.update(status='restoring', reason='awaiting_identity_observation')
                write_json(self.path, state)
                if not roster_online(self.gateway._native_roster(), expected):
                    raise ValueError('restore_not_observed')
                state.update(status='online', reason='restored_identity_verified', verifiedAt=now)
                self._auto_resume(control, resume_after_restore, now)
            elif result['ok'] is False and result.get('phase') == 'rejected':
                code = result.get('code', 'restore_rejected')
                if code in DEATH_PREFLIGHT_REJECTIONS:
                    # The complete envelope and exact identity passed validation
                    # above. These two native codes occur before the constructor.
                    # Keep the original attempt and never invent verifiedAt.
                    state['preflightRejections'] = state.get('preflightRejections', []) + [
                        {'attemptAt':now, 'rejectedAt':self.clock(), 'phase':'rejected', 'code':code}]
                state.update(status='waiting' if code in ('restore_cooldown', 'dimension_unavailable', 'playerdata_unavailable',
                                                         'death_respawn_delay', 'death_safe_spawn_unavailable')
                             else 'blocked', reason=code)
                state['nextCheckAt'] = now + min(900, 60 * 2 ** min(4, len(episode) + 1))
            else:
                raise ValueError('restore_outcome_unknown')
        except Exception:
            state.update(status='unknown', reason='restore_outcome_unknown')
        write_json(self.path, state)
        return state
