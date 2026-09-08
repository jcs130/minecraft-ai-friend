"""Known-body restore boundaries; no live RCON, model, or world changes."""
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'world/survival'))
import test_survival_controller as fixtures
from body_reconnect import BodyReconnect, PREFIX, binding, roster_online
from numen_gateway import read_json, write_json

OWNER = 'e5005711-be9f-44b7-aaad-6993c0ba5df4'
BINDING = {'bodyName':'Kirito', 'bodyUuid':fixtures.BODY_UUID, 'ownerUuid':OWNER}
ONLINE = 'count=1\nKirito|uuid='+fixtures.BODY_UUID+'|owner='+OWNER+'|dim=minecraft:overworld|pos=-543,69,840\n'


class Rcon:
    def __init__(self):
        self.calls = []
        self.roster = 'count=0'
        self.response = {'schema':1,'capability':'existing_body_restore_v1', **BINDING,
                         'ok':True,'phase':'restored','code':'restored_existing','observedAt':1800000000000}
        self.on_restore = None

    def cmd(self, command):
        self.calls.append(command)
        if command == 'numen_act list':
            if isinstance(self.roster, Exception): raise self.roster
            return self.roster
        if self.on_restore: self.on_restore()
        if isinstance(self.response, Exception): raise self.response
        if self.response.get('ok'): self.roster = ONLINE
        return PREFIX+json.dumps(self.response)


class BodyReconnectTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        self.state = Path(temporary.name); self.clock = fixtures.FakeClock()
        self.gateway = fixtures.FakeGateway(self.state, self.clock); self.gateway.rcon = Rcon()
        self.rcon = self.gateway.rcon
        write_json(self.state/'control.json', {'enabled':True})
        write_json(self.state/'controller.json', {'active':None})
        self.restore = BodyReconnect(self.gateway, self.clock)

    def commands(self):
        return [c for c in self.rcon.calls if c != 'numen_act list']

    def test_existing_uuid_reserved_before_command_and_confirmed_by_roster(self):
        def observe_reservation():
            self.assertEqual(read_json(self.restore.path)['status'], 'reserved')
            self.assertEqual(read_json(self.restore.path)['attempts'], [self.clock()])
        self.rcon.on_restore = observe_reservation
        result = self.restore.tick(BINDING)
        self.assertEqual(result['status'], 'online')
        self.assertEqual(self.commands(), ['numen_restore_existing '+fixtures.BODY_UUID+' '+OWNER+' Kirito'])
        self.assertEqual(self.rcon.calls.count('numen_act list'), 2)

    def test_active_paused_unknown_or_open_lease_never_restores(self):
        for file, value in [('control.json', {'enabled':False}), ('controller.json', {'active':{'taskId':'existing'}}),
                            ('unknown.json', {'tool':'mine'}), ('lease.json', {'status':'unknown'}),
                            ('lease.json', {'status':'open','expiresAt':self.clock()*1000+1000})]:
            write_json(self.state/file, value)
            self.assertEqual(self.restore.tick(BINDING)['reason'], 'restore_not_authorized')
            (self.state/file).unlink()
            write_json(self.state/'control.json', {'enabled':True})
            write_json(self.state/'controller.json', {'active':None})
        self.assertFalse(self.rcon.calls)

    def test_online_body_with_failed_snapshot_is_not_restored(self):
        self.rcon.roster = ONLINE
        self.assertEqual(self.restore.tick(BINDING)['status'], 'online')
        self.assertFalse(self.commands())

    def test_unknown_submission_is_not_retried_after_process_restart(self):
        self.rcon.response = TimeoutError('response lost')
        self.assertEqual(self.restore.tick(BINDING)['status'], 'unknown')
        for _ in range(4):
            self.clock.now += 900
            BodyReconnect(self.gateway, self.clock).tick(BINDING)
        self.assertEqual(len(self.commands()), 1)
        self.rcon.roster = ONLINE; self.clock.now += 900
        self.assertEqual(self.restore.tick(BINDING)['status'], 'online')

    def test_interrupted_reservation_never_issues_another_command(self):
        write_json(self.restore.path, {'schema':1, **BINDING,'status':'reserved','attempts':[self.clock()]})
        self.assertEqual(self.restore.tick(BINDING)['status'], 'unknown')
        self.assertFalse(self.commands())

    def test_roster_failure_cannot_erase_unknown_external_effect_boundary(self):
        for status in ('reserved', 'restoring', 'unknown'):
            write_json(self.restore.path, {'schema':1, **BINDING,'status':status,'attempts':[self.clock()]})
            self.rcon.roster = TimeoutError()
            self.assertEqual(self.restore.tick(BINDING)['status'], 'unknown')
            self.clock.now += 1000
            self.rcon.roster = 'count=0'
            self.assertEqual(BodyReconnect(self.gateway, self.clock).tick(BINDING)['status'], 'unknown')
            self.assertFalse(self.commands())

    def test_missing_or_wrong_owned_save_blocks_without_fallback(self):
        for code in ('playerdata_missing','registry_identity_mismatch','body_dead','saved_task_requires_review'):
            self.restore.path.unlink(missing_ok=True)
            self.rcon.response.update(ok=False, phase='rejected', code=code)
            self.assertEqual(self.restore.tick(BINDING)['reason'], code)
            self.clock.now += 1000
            self.assertEqual(self.restore.tick(BINDING)['status'], 'blocked')
        self.assertEqual(len(self.commands()), 4)
        self.assertFalse(any('summon' in c for c in self.rcon.calls))

    def test_restored_reply_wrong_uuid_is_unknown(self):
        self.rcon.response['bodyUuid'] = OWNER
        self.assertEqual(self.restore.tick(BINDING)['status'], 'unknown')

    def test_live_name_or_owner_conflict_never_mutates(self):
        self.rcon.roster = ONLINE.replace(OWNER, fixtures.BODY_UUID)
        self.assertEqual(self.restore.tick(BINDING)['status'], 'blocked')
        self.assertFalse(self.commands())

    def test_roster_transport_failure_is_persistent_backoff_not_restore(self):
        self.rcon.roster = TimeoutError()
        result = self.restore.tick(BINDING)
        self.assertEqual(result['reason'], 'restore_roster_unavailable')
        self.assertEqual(result['nextCheckAt'], self.clock()+60)
        BodyReconnect(self.gateway, self.clock).tick(BINDING)
        self.assertEqual(len(self.rcon.calls), 1)
        self.assertFalse(self.commands())

    def test_only_three_known_rejected_attempts_per_rolling_day(self):
        self.rcon.response.update(ok=False,phase='rejected',code='dimension_unavailable')
        for _ in range(5):
            self.restore.tick(BINDING); self.clock.now += 1000
        self.assertEqual(len(self.commands()), 3)
        self.assertEqual(read_json(self.restore.path)['reason'], 'restore_attempt_limit')

    def test_identity_changes_require_review(self):
        self.rcon.roster = ONLINE; self.restore.tick(BINDING)
        self.assertEqual(self.restore.tick({**BINDING,'ownerUuid':fixtures.BODY_UUID})['reason'], 'restore_binding_changed')
        self.assertFalse(self.commands())

    def test_malformed_or_truncated_roster_is_not_absence(self):
        for raw in ('', 'Unknown command', 'count=1', 'count=0\nextra', 'count=65'):
            with self.assertRaises(ValueError): roster_online(raw, BINDING)
        for key, value in [('bodyUuid','1-1-1-1-1'),('ownerUuid',None),('bodyName','Kirito execute')]:
            with self.assertRaises((ValueError, AttributeError)): binding({**BINDING,key:value})

    def test_read_only_confirmation_preserves_unrelated_boundaries(self):
        protected = {'control.json': {'enabled':False},
                     'controller.json': {'active': {'taskId':'existing'}, 'decisions':[{'startedAt':1}]},
                     'lease.json': {'status':'unknown', 'turnId':'unresolved-action'},
                     'unknown.json': {'tool':'mine', 'turnId':'unresolved-action'}}
        for name, value in protected.items(): write_json(self.state/name, value)
        original = {name:(self.state/name).read_bytes() for name in protected}
        self.rcon.roster = ONLINE+'\n'  # Production RCON has plain text and trailing blank lines.
        for status in ('reserved', 'restoring', 'unknown'):
            with self.subTest(status=status):
                write_json(self.restore.path, {'schema':1, **BINDING, 'status':status,
                           'attempts':[self.clock()-30], 'nextCheckAt':self.clock()+900})
                with patch.object(self.restore, '_tick', side_effect=AssertionError('restore dispatcher called')):
                    result = self.restore.confirm_online(BINDING)
                self.assertEqual(result['status'], 'online')
                self.assertEqual(result['attempts'], [self.clock()-30])
                self.assertEqual(result['verifiedAt'], self.clock())
                self.assertEqual(result['nextCheckAt'], self.clock()+900)
                self.assertEqual({name:(self.state/name).read_bytes() for name in protected}, original)
        self.assertEqual(self.rcon.calls, ['numen_act list']*3)

    def test_read_only_confirmation_missing_or_settled_record_never_reads_roster(self):
        self.assertIsNone(self.restore.confirm_online(BINDING))
        self.assertFalse(self.restore.path.exists())
        for status in ('online', 'waiting', 'blocked'):
            record = {'schema':1, **BINDING, 'status':status, 'attempts':[]}
            write_json(self.restore.path, record)
            before = self.restore.path.read_bytes()
            self.assertEqual(self.restore.confirm_online(BINDING), record)
            self.assertEqual(self.restore.path.read_bytes(), before)
        self.assertFalse(self.rcon.calls)

    def test_read_only_confirmation_uncertainty_is_throttled_and_never_restores(self):
        for raw in (TimeoutError('timeout'), 'count=0', 'invalid response'):
            with self.subTest(raw=type(raw).__name__):
                self.rcon.calls.clear(); self.rcon.roster = raw
                write_json(self.restore.path, {'schema':1, **BINDING, 'status':'reserved',
                           'attempts':[self.clock()-30]})
                self.assertEqual(self.restore.confirm_online(BINDING)['status'], 'unknown')
                restarted = BodyReconnect(self.gateway, self.clock)
                self.assertEqual(restarted.confirm_online(BINDING)['status'], 'unknown')
                self.assertEqual(self.rcon.calls, ['numen_act list'])
                self.clock.now += 60; self.rcon.roster = ONLINE
                self.assertEqual(restarted.confirm_online(BINDING)['status'], 'online')
                restarted.confirm_online(BINDING)
                self.assertEqual(self.rcon.calls, ['numen_act list']*2)

    def test_read_only_confirmation_binding_or_roster_conflict_cannot_confirm(self):
        record = {'schema':1, **BINDING, 'status':'unknown', 'attempts':[self.clock()]}
        write_json(self.restore.path, record)
        self.assertEqual(self.restore.confirm_online({**BINDING, 'ownerUuid':fixtures.BODY_UUID})['reason'],
                         'restore_binding_changed')
        self.assertFalse(self.rcon.calls)
        self.assertEqual(read_json(self.restore.path), record)
        self.rcon.roster = ONLINE.replace(OWNER, fixtures.BODY_UUID)
        result = self.restore.confirm_online(BINDING)
        self.assertEqual(result['status'], 'blocked')
        self.assertEqual(result['reason'], 'restore_live_identity_conflict')
        self.assertEqual(self.rcon.calls, ['numen_act list'])

    def test_native_death_recovery_can_clear_only_body_dead_after_live_identity_check(self):
        self.rcon.roster = ONLINE
        self.gateway.body.update(gameMode='survival', hp=20)
        record = {'schema':1, **BINDING, 'status':'blocked', 'reason':'body_dead', 'attempts':[self.clock()-120]}
        write_json(self.restore.path, record)
        before_control = (self.state/'control.json').read_bytes()
        result = self.restore.confirm_online(BINDING, self.gateway.body)
        self.assertEqual(result['status'], 'online')
        self.assertEqual(result['reason'], 'identity_verified')
        self.assertEqual(result['attempts'], record['attempts'])
        self.assertEqual((self.state/'control.json').read_bytes(), before_control)
        self.assertEqual(self.rcon.calls, ['numen_act list'])
        self.assertFalse(self.commands())

    def test_death_recovery_does_not_clear_other_blocks_or_unhealthy_body(self):
        self.rcon.roster = ONLINE
        for reason in ('registry_identity_mismatch', 'saved_task_requires_review', 'playerdata_missing'):
            record = {'schema':1, **BINDING, 'status':'blocked', 'reason':reason, 'attempts':[]}
            write_json(self.restore.path, record)
            self.assertEqual(self.restore.confirm_online(BINDING, self.gateway.body), record)
        for body in (None, dict(self.gateway.body, hp=0), dict(self.gateway.body, hp=float('inf')),
                     dict(self.gateway.body, bodyUuid=OWNER), dict(self.gateway.body, gameMode='creative')):
            record = {'schema':1, **BINDING, 'status':'blocked', 'reason':'body_dead', 'attempts':[]}
            write_json(self.restore.path, record)
            self.assertEqual(self.restore.confirm_online(BINDING, body), record)
        self.assertFalse(self.rcon.calls)

    def test_dead_roster_absence_or_timeout_does_not_authorize_restore(self):
        for roster in ('count=0', TimeoutError()):
            self.rcon.roster = roster
            record = {'schema':1, **BINDING, 'status':'blocked', 'reason':'body_dead', 'attempts':[]}
            write_json(self.restore.path, record)
            result = self.restore.confirm_online(BINDING, self.gateway.body)
            self.assertEqual(result['status'], 'blocked')
            self.assertEqual(result['reason'], 'body_dead')
        self.assertFalse(self.commands())


class BodyReconnectControllerTests(unittest.TestCase):
    setUp = fixtures.ControllerTests.setUp
    create = fixtures.ControllerTests.create
    write = fixtures.ControllerTests.write

    def test_budget_full_restores_then_waits_without_new_model_or_skill(self):
        self.controller.settings['ownerUuid'] = OWNER
        self.gateway.rcon = Rcon()
        self.controller.data['decisions'] = [{'startedAt':self.clock()-10}, {'startedAt':self.clock()-20}]
        decisions = copy.deepcopy(self.controller.data['decisions'])
        original = copy.deepcopy(self.gateway.body)
        self.gateway.body = {'ok':False,'online':False}
        self.controller.tick()
        self.assertEqual(self.controller.data['bodyReconnect']['status'], 'online')
        self.assertEqual(self.controller.data['status'], 'body_offline')
        self.gateway.body = original
        self.controller.tick()
        self.assertEqual(self.controller.data['status'], 'budget_wait')
        self.assertEqual(self.controller.data['decisions'], decisions)
        self.assertFalse(self.backend.submitted)
        self.assertFalse(self.skills.calls)
        self.assertFalse(self.gateway.actions)

    def test_healthy_body_reconciles_unknown_with_full_real_decision_budget(self):
        self.controller.settings.update(ownerUuid=OWNER, decisionsPerDay=48)
        self.gateway.rcon = Rcon(); self.gateway.rcon.roster = ONLINE
        decisions = [{'startedAt':self.clock()-i-1} for i in range(48)]
        self.controller.data['decisions'] = copy.deepcopy(decisions)
        self.write('body-reconnect.json', {'schema':1, **BINDING, 'status':'unknown',
                   'attempts':[self.clock()-120], 'nextCheckAt':self.clock()+900})
        self.controller.tick()
        self.assertEqual(read_json(self.state/'body-reconnect.json')['status'], 'online')
        self.assertEqual(self.controller.data['bodyReconnect']['status'], 'online')
        self.assertEqual(self.controller.data['status'], 'budget_wait')
        self.assertEqual(self.controller.data['decisions'], decisions)
        self.assertEqual(self.gateway.rcon.calls, ['numen_act list'])
        self.assertFalse(self.backend.submitted)
        self.assertFalse(self.skills.calls)
        self.assertFalse(self.gateway.actions)

    def test_paused_healthy_body_confirmation_cannot_resume_or_clear_unknown_action(self):
        self.controller.settings['ownerUuid'] = OWNER
        self.gateway.rcon = Rcon(); self.gateway.rcon.roster = ONLINE
        self.controller.data['status'] = 'paused'
        self.write('control.json', {'schema':1, 'enabled':False})
        self.write('unknown.json', {'turnId':'other', 'tool':'mine'})
        self.write('lease.json', {'status':'unknown', 'turnId':'other'})
        self.write('body-reconnect.json', {'schema':1, **BINDING, 'status':'unknown', 'attempts':[]})
        untouched = {name:(self.state/name).read_bytes() for name in ('control.json','unknown.json','lease.json')}
        self.controller.tick()
        self.assertEqual(self.controller.data['status'], 'paused')
        self.assertEqual(self.controller.data['bodyReconnect']['status'], 'online')
        self.assertEqual({name:(self.state/name).read_bytes() for name in untouched}, untouched)
        self.assertEqual(self.gateway.rcon.calls, ['numen_act list'])
        self.assertFalse(self.backend.submitted)
        self.assertFalse(self.gateway.invoked)
        self.assertFalse(self.gateway.actions)


if __name__ == '__main__': unittest.main()
