"""Check real Java status via a supplied LAN address and local-only admin binds.

Run on the server to verify its LAN endpoint and Docker publishing. This does
not establish reachability from another PC or rule out Wi-Fi client isolation.
"""
import argparse
from datetime import datetime, timezone
import ipaddress
import json
from pathlib import Path
import subprocess

from check_mc_endpoints import probe

ROOT = Path(__file__).resolve().parents[1]


def check(host):
    address = ipaddress.IPv4Address(host)
    if not address.is_private or address.is_loopback or address.is_unspecified:
        raise ValueError('Supply the actual private LAN IPv4 address')
    record = {'checkedAt': datetime.now(timezone.utc).isoformat(), 'host': host,
              'externalClientTested': False, 'checks': {},
              'scope': 'Host-to-own-LAN diagnostic, not an external PC test. WSL mirrored with hostAddressLoopback=false can time out here even when a remote LAN PC can connect.'}
    try:
        record['checks']['java_status'] = probe(25565, host)
    except (OSError, ValueError, KeyError) as error:
        record['checks']['java_status'] = {'ok': False, 'errorType': type(error).__name__}
    result = subprocess.run(['docker', 'compose', 'ps', '--format', 'json'], cwd=ROOT,
                            capture_output=True, text=True, encoding='utf8', timeout=20,
                            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0), check=True)
    rows = [json.loads(line) for line in result.stdout.splitlines()]
    exposed = [(row['Service'], p['PublishedPort'], p['Protocol']) for row in rows
               for p in row.get('Publishers', []) if p.get('PublishedPort')
               and p.get('URL') not in ('127.0.0.1', '::1')]
    record['checks']['only_game_ports_exposed'] = {
        'ok': sorted(exposed) == [('mc', 24455, 'udp'), ('mc', 25565, 'tcp')],
        'ports': exposed}
    voice = (ROOT / 'server/mc/config/voicechat/voicechat-server.properties').read_text('utf8')
    record['checks']['voice_uses_connected_host'] = {
        'ok': 'voice_host=24455' in voice.splitlines(), 'audioPlaybackTested': False}
    record['ok'] = all(row['ok'] for row in record['checks'].values())
    output = ROOT / 'runtime/lan-access-20260913/smoke.json'
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding='utf8')
    print(json.dumps(record, ensure_ascii=False))
    return 0 if record['ok'] else 1


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('host', help='LAN IPv4 address, e.g. 192.168.3.133')
    raise SystemExit(check(parser.parse_args().host))
