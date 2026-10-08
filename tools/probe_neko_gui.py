"""Read-only same-player web/native GUI smoke check; does not prove pixel parity."""
import argparse
import json
import time
from pathlib import Path
from urllib.request import urlopen


def check_gui(web, trial, now_ms):
    player = trial.get('current', {}).get('playerUuid')
    presentation = web.get('presentation') or {}
    menu = presentation.get('nativeMenu') or {}
    skills = presentation.get('skills') or {}
    rows = menu.get('slots')
    layout = menu.get('slotLayout')
    checks = {
        'web-live': web.get('ok') is True and web.get('ready') is True,
        'trial-live': trial.get('phase') in ('playing', 'observing'),
        'same-player': bool(player) and presentation.get('playerUuid') == player and menu.get('playerUuid') == player,
        'native-menu': isinstance(rows, list) and len(rows) > 0 and all(isinstance(row, dict) and row.get('slot') == i for i, row in enumerate(rows)),
        'native-slot-coordinates': isinstance(rows, list) and isinstance(layout, list) and len(rows) == len(layout)
                                   and all(isinstance(row, dict) and row.get('slot') == i and type(row.get('x')) is int and type(row.get('y')) is int for i, row in enumerate(layout)),
        'live-ars-state': skills.get('playerUuid') == player and skills.get('source') == 'ars_nouveau_receipt'
                          and skills.get('stale') is False and isinstance(skills.get('observedAt'), (int, float))
                          and 0 <= now_ms - skills['observedAt'] <= 5000,
        'no-unknown-native-write': not trial.get('current', {}).get('native', {}).get('mutationBlocked', True)
                                   and trial.get('current', {}).get('native', {}).get('unresolved') == [],
    }
    return {'schemaVersion': 1, 'scope': 'same_player_gui_data_not_pixel_parity', 'ok': all(checks.values()), 'checks': checks,
            'playerUuid': player, 'menuType': menu.get('menuType'), 'windowId': menu.get('windowId'),
            'stateId': menu.get('stateId'), 'mana': skills.get('mana'), 'qwenpawConnected': trial.get('qwenpawConnected')}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:28990')
    parser.add_argument('--state-directory', type=Path, required=True)
    args = parser.parse_args()
    trial = json.loads((args.state_directory / 'status.json').read_text(encoding='utf-8'))
    try:
        with urlopen(args.url.rstrip('/') + '/healthz', timeout=5) as response:
            web = json.load(response)
        report = check_gui(web, trial, time.time() * 1000)
    except (OSError, ValueError) as error:
        report = {'schemaVersion': 1, 'scope': 'same_player_gui_data_not_pixel_parity', 'ok': False, 'error': str(error)}
    print(json.dumps(report, ensure_ascii=False, indent=2))
    raise SystemExit(0 if report['ok'] else 1)


if __name__ == '__main__':
    main()
