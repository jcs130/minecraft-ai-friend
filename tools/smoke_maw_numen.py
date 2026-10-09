"""Bounded zero-model Numen Lua smoke through the existing owned console.

Run with a connected QA owner and an explicit report path. Never invokes a
provider, grants OP, changes terrain, or dismisses a companion permanently.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import time
import uuid
from maw_service import load_config, submit, guard_console


def run(config_path: Path, owner: str, report_path: Path, *, fixture=False) -> dict:
    uuid.UUID(owner)
    if report_path.exists():
        raise ValueError('Report already exists; preserve prior evidence')
    config = load_config(config_path)
    server = Path(config['serverDir'])
    if fixture and server.name != 'registry-server':
        raise ValueError('Inventory fixtures are isolated-server only')
    log = server/'logs/latest.log'
    report = {'schemaVersion': 1, 'startedAt': time.time(), 'provider': 'official_numen_lua',
              'ownerUuid': owner, 'server': str(server), 'modelRequests': 0,
              'fixture': fixture, 'checks': {}, 'receipts': [], 'ok': False}
    body_id = None

    def command(text):
        text = guard_console(text)
        offset = log.stat().st_size
        delivered = submit(config, {'action': 'console', 'command': text,
                                   'requestId': 'numen-smoke-'+uuid.uuid4().hex})
        if not delivered.get('ok'):
            raise RuntimeError('Owned console delivery unavailable; do not repeat an unknown action')
        deadline = time.monotonic()+10
        while time.monotonic() < deadline:
            with log.open('rb') as stream:
                stream.seek(offset)
                for line in stream.read().decode('utf-8', 'replace').splitlines():
                    if 'MAW_AGENT ' in line:
                        value = json.loads(line.split('MAW_AGENT ', 1)[1]); report['receipts'].append(value)
                        return value
            time.sleep(.1)
        raise TimeoutError('Console delivered but outcome unknown; do not repeat')

    def lua(code):
        action_id = 'probe-'+uuid.uuid4().hex
        accepted = command(f'maw_agent lua {body_id} {action_id} {code}')
        if not accepted.get('ok'):
            raise RuntimeError(str(accepted))
        deadline = time.monotonic()+40
        receipt = accepted
        while receipt['phase'] != 'terminal' and time.monotonic() < deadline:
            time.sleep(.4)
            receipt = command(f'maw_agent receipt {body_id} {action_id}')
        if receipt['phase'] != 'terminal':
            raise TimeoutError('Lua result unknown; preserve intent without retry')
        outcome = receipt['outcome']
        native = json.loads(outcome['receipt'])
        if outcome['status'] != 'ok' or native['success'] is not True:
            raise RuntimeError(str(outcome))
        return action_id, code, receipt

    try:
        operations = command('maw_agent operations')
        assert operations['ok'] and operations['totalFunctions'] > 60
        assert any(r['id'] == 'numen.route' for r in operations['groups'])
        details = command('maw_agent operations numen.status')
        assert all(r['side'] == 'server' for r in details['functions'])
        report['checks']['runtimeOperations'] = True
        name = 'MawNumenQA1009' if fixture else 'MawNumenDemo'
        summoned = command(f'maw_agent summon {owner} {name}')
        assert summoned['ok'] and summoned['ownerUuid'] == owner
        body_id = summoned['bodyUuid']; report['bodyUuid'] = body_id
        again = command(f'maw_agent summon {owner} {name}')
        assert again['bodyUuid'] == body_id
        report['checks']['sameOwnerSameBody'] = True
        def body():
            rows = command('maw_agent list')['bodies']
            return next(r for r in rows if r['bodyUuid'] == body_id)
        before = body()
        if fixture:
            # Fixture owner stands near its body so upstream idle-follow and
            # nighttime combat reflexes cannot invalidate the short-walk check.
            moved_owner = submit(config, {'action': 'console',
                'command': f"tp {owner} {before['x']} {before['y']} {before['z']}",
                'requestId': 'numen-owner-fixture-'+uuid.uuid4().hex})
            assert moved_owner['ok']
            report['fixtureOwnerTeleport'] = moved_owner
            time.sleep(1)
            before = body()
        report['before'] = before
        lua('local s=numen.status.self(); print(s.name,s.hp,s.hunger,s.pos.x,s.pos.y,s.pos.z)')
        report['checks']['nativeLuaStatus'] = True
        if fixture:
            submit(config, {'action': 'console', 'command': f'give {name} minecraft:bread 2',
                            'requestId': 'numen-fixture-'+uuid.uuid4().hex})
        _, _, inv = lua('local items=numen.inv.items(); print(items)')
        report['inventoryReceipt'] = inv
        report['checks']['nativeInventory'] = True
        action_id, code, terminal = lua('local s=numen.status.self(); local p=numen.route.plan({to={x=math.floor(s.pos.x)+2,z=math.floor(s.pos.z)},costs={dig=false,place=false}}); if not p.ok then error(p.why) end; local moved=numen.move.go(p); print(moved.pos.x,moved.pos.y,moved.pos.z,moved.distance_left)')
        after = body(); report['after'] = after
        assert abs(after['x']-before['x']) > .5
        assert abs(after['x']-(int(before['x']//1)+2)) < 1.1
        report['checks']['moveTerminalAndActualPosition'] = True
        cached = command(f'maw_agent lua {body_id} {action_id} {code}')
        assert cached['cached'] and cached['phase'] == 'terminal'
        conflict = command(f'maw_agent lua {body_id} {action_id} print("wrong fingerprint")')
        assert conflict['ok'] is False and conflict['code'] == 'action_id_conflict'
        unchanged = body()
        assert abs(unchanged['x']-after['x']) < .1 and abs(unchanged['z']-after['z']) < .1
        report['checks']['sameIdNoReplayAndConflictRejected'] = True
        dormant = command(f'maw_agent dormant {body_id}')
        assert dormant['ok'] and dormant['online'] is False
        restored = command(f'maw_agent restore {body_id}')
        assert restored['ok'] and restored['bodyUuid'] == body_id and restored['ownerUuid'] == owner
        restored_body = body()
        assert abs(restored_body['x']-after['x']) < .1 and abs(restored_body['z']-after['z']) < .1
        _, _, restored_inv = lua('local items=numen.inv.items(); print(items)')
        assert restored_inv['outcome']['receipt'] == inv['outcome']['receipt']
        report['checks']['sameUuidPositionInventoryRestored'] = True
        report['ok'] = True
    except Exception as error:
        report['error'] = f'{type(error).__name__}: {error}'
        raise
    finally:
        if body_id:
            try:
                cleanup = command(f'maw_agent dormant {body_id}')
                report['cleanup'] = cleanup
                if not cleanup.get('ok'): report['ok'] = False
            except Exception as error:
                report['cleanupError'] = str(error); report['ok'] = False
        report['finishedAt'] = time.time()
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    return {'ok': report['ok'], 'checks': report['checks'], 'bodyUuid': body_id, 'modelRequests': 0}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--owner-uuid', required=True)
    parser.add_argument('--report', type=Path, required=True)
    parser.add_argument('--isolated-inventory-fixture', action='store_true')
    args = parser.parse_args()
    print(json.dumps(run(args.config, args.owner_uuid, args.report,
                         fixture=args.isolated_inventory_fixture), ensure_ascii=False))
