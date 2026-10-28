"""Cold, byte-preserving 1:1 conversion into the Essentials bank used by Vortex/Vault.

The CLI has fixed production paths. Tests call the functions with temporary fixtures.
No passwords, inventories, XP, quest progress, names or UUIDs are rewritten.
"""
from pathlib import Path
from decimal import Decimal
import argparse, hashlib, json, os, re, uuid

RELEASE = 'rpg-unified-release-20261028-r1'
SERVER = Path('E:/MC/server')
OPS = Path('E:/MC/ops')
LEGACY = 'plugins/AgentFriend/config.yml'
MARKER = 'plugins/QiandengjiRpg/economy-migration-v1.json'

def digest(data):
    return hashlib.sha256(data).hexdigest()

def durable(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + '.gold-installing')
    with temp.open('wb') as stream:
        stream.write(data); stream.flush(); os.fsync(stream.fileno())
    os.replace(temp, path)

def legacy_rows(raw):
    text = raw.decode('utf-8-sig')
    headers = list(re.finditer(r'(?m)^dungeon-emerald-wallet:[ \t]*(?:\r?\n|$)', text))
    if len(headers) != 1:
        raise ValueError('Expected exactly one legacy wallet mapping')
    start = headers[0].end()
    tail = re.search(r'(?m)^[^ \t\r\n#][^\r\n]*:', text[start:])
    end = start + tail.start() if tail else len(text)
    rows = []
    for match in re.finditer(r'(?m)^  ([a-f0-9-]{36}):[ \t]*([0-9]+)[ \t]*(?:#[^\r\n]*)?\r?$', text[start:end]):
        account = str(uuid.UUID(match[1])); amount = int(match[2])
        if account != match[1] or amount > 1_000_000_000 or any(r[0] == account for r in rows):
            raise ValueError('Invalid or duplicate legacy account')
        rows.append((account, amount, start + match.start(2), start + match.end(2)))
    actual = [line for line in text[start:end].splitlines() if line.strip() and not line.lstrip().startswith('#')]
    if len(actual) != len(rows):
        raise ValueError('Unrecognized legacy wallet field; refusing partial conversion')
    return text, rows

def plan(server):
    original = (server / LEGACY).read_bytes()
    text, rows = legacy_rows(original)
    marker = server / MARKER
    if marker.exists():
        saved = json.loads(marker.read_text(encoding='utf-8'))
        if saved.get('schema') != 1 or saved.get('state') != 'COMMITTED' or any(r[1] for r in rows):
            raise ValueError('Migration already recorded but legacy balance reappeared')
        return [], saved
    files = []; accounts = []
    for account, amount, _, _ in rows:
        if not amount:
            continue
        relative = f'plugins/Essentials/userdata/{account}.yml'
        data = (server / relative).read_bytes()
        # Essentials serializes the bank's decimal as a quoted scalar. Keep all
        # other bytes, including user settings, dates and unrelated metadata.
        matches = list(re.finditer(rb'(?m)^money: *([\'\"]?)(-?[0-9]+(?:\.[0-9]+)?)\1 *(?=\r?$)', data))
        if len(matches) != 1:
            raise ValueError('Expected one native bank money field')
        match = matches[0]; before = Decimal(match[2].decode('ascii')); after = before + amount
        if not before.is_finite() or after > Decimal('10000000000000'):
            raise ValueError('Native bank limit exceeded')
        replacement = format(after, 'f').encode('ascii')
        changed = data[:match.start(2)] + replacement + data[match.end(2):]
        files.append((relative, data, changed))
        accounts.append({'uuid': account, 'legacy': amount, 'before': str(before), 'after': str(after)})
    for _, amount, start, end in reversed(rows):
        if amount:
            text = text[:start] + '0' + text[end:]
    changed = text.encode('utf-8-sig' if original.startswith(b'\xef\xbb\xbf') else 'utf-8')
    files.append((LEGACY, original, changed))
    receipt = {'schema': 1, 'state': 'COMMITTED', 'rate': '1:1', 'bank': 'Vortex/Vault/Essentials',
               'accounts': accounts, 'total': sum(r[1] for r in rows),
               'files': [{'path': p, 'before': digest(a), 'after': digest(b)} for p, a, b in files]}
    return files, receipt

def apply(server, backup, mirror, evidence, replace=durable):
    files, receipt = plan(server)
    if not files:
        return {'alreadyComplete': True, 'accounts': len(receipt['accounts']), 'total': receipt['total']}
    if evidence.exists():
        raise ValueError('Migration evidence already exists; inspect rather than replay')
    for snapshot in (backup, mirror):
        if not (snapshot / '.complete').is_file():
            raise ValueError('Complete cold snapshot required on both disks')
        for relative, before, _ in files:
            if (snapshot / 'server' / relative).read_bytes() != before:
                raise ValueError('Cold backup differs from current bank or legacy state')
    evidence.mkdir(parents=True)
    for n, (_, before, _) in enumerate(files):
        durable(evidence / f'{n}.before', before)
    durable(evidence / 'plan.json', (json.dumps(receipt, indent=2) + '\n').encode())
    durable(evidence / 'IN_PROGRESS', b'Cold money migration in progress.\n')
    applied = []
    try:
        for n, (relative, before, after) in enumerate(files):
            target = server / relative
            if target.read_bytes() != before:
                raise ValueError('Bank changed during cold migration')
            applied.append((target, before))
            replace(target, after)
            if target.read_bytes() != after:
                raise ValueError('Native bank write verification failed')
        replace(server / MARKER, (json.dumps(receipt, indent=2) + '\n').encode())
        durable(evidence / 'committed.json', b'{"committed":true}\n')
        (evidence / 'IN_PROGRESS').unlink()
    except BaseException:
        failures = []
        for target, before in reversed(applied):
            try:
                durable(target, before)
                if target.read_bytes() != before: raise ValueError('rollback mismatch')
            except BaseException:
                failures.append(str(target))
        try:
            (server / MARKER).unlink(missing_ok=True)
        except BaseException:
            failures.append(MARKER)
        if failures:
            durable(evidence / 'RECOVERY_BLOCKED.json', json.dumps(failures).encode())
        else:
            durable(evidence / 'rolled-back-on-failure.json', b'{"rolledBack":true}\n')
            (evidence / 'IN_PROGRESS').unlink(missing_ok=True)
        raise
    return {'accounts': len(receipt['accounts']), 'total': receipt['total'], 'alreadyComplete': False}

def rollback(server, evidence):
    if not (evidence / 'committed.json').exists():
        return
    receipt = json.loads((evidence / 'plan.json').read_text())
    for row in receipt['files']:
        if digest((server / row['path']).read_bytes()) != row['after']:
            raise ValueError('Post-migration data changed; refusing stale rollback')
    for n, row in reversed(list(enumerate(receipt['files']))):
        before = (evidence / f'{n}.before').read_bytes()
        if digest(before) != row['before']: raise ValueError('Rollback evidence mismatch')
        durable(server / row['path'], before)
    (server / MARKER).unlink(missing_ok=True)
    durable(evidence / 'rolled-back.json', b'{"rolledBack":true}\n')

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['apply', 'rollback'])
    parser.add_argument('--release', required=True)
    parser.add_argument('--backup', type=Path, required=True)
    parser.add_argument('--mirror', type=Path, required=True)
    args = parser.parse_args()
    if args.release != RELEASE or not (OPS / 'auto-start.paused').exists():
        raise ValueError('Reviewed release and cold maintenance required')
    for snapshot, root in ((args.backup, Path('E:/MC/backups/scheduled')), (args.mirror, Path('F:/MC-backups/scheduled'))):
        if snapshot.resolve().parent != root.resolve() or not re.fullmatch(r'[0-9]{8}-[0-9]{6}', snapshot.name):
            raise ValueError('Unexpected cold backup path')
    import socket
    with socket.socket() as probe:
        if probe.connect_ex(('127.0.0.1', 25565)) == 0:
            raise ValueError('Paper must be stopped')
    evidence = OPS / 'repairs' / RELEASE / 'economy-migration'
    gate = OPS / 'rpg-economy-recovery.blocked'
    if gate.exists() and args.action == 'apply':
        raise ValueError('Prior interrupted economy maintenance needs inspection')
    # Also survives host power loss between two account writes. All normal
    # startup paths check this file, including the watchdog's Start action.
    durable(gate, b'Inspect cold economy evidence before startup.\n')
    try:
        result = apply(SERVER, args.backup, args.mirror, evidence) if args.action == 'apply' else rollback(SERVER, evidence)
    except BaseException:
        if args.action == 'apply' and not (evidence / 'IN_PROGRESS').exists() and not (evidence / 'RECOVERY_BLOCKED.json').exists():
            gate.unlink(missing_ok=True)
        raise
    gate.unlink(missing_ok=True)
    print(json.dumps(result or {'rolledBack': True}))

if __name__ == '__main__':
    main()
