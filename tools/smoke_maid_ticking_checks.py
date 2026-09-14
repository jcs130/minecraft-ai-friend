"""Exercise entity tick recovery and native TLM follow in the isolated QA world."""
import time
import uuid


def check_ticking(*, response, command, invoke, run, base, data, fake, checks, details):
    def qa(action):
        value = response('qdmaidtickqa ' + action, 'QD_COMPANION_TICK_QA ')
        if not value.get('ok'): raise RuntimeError('tick_fixture_failed: ' + str(value))
        return value

    def until(predicate, seconds=40):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            value = qa('status')
            if predicate(value): return value
            time.sleep(0.5)
        raise RuntimeError('tick_fixture_timeout: ' + str(value))

    command('gamerule doMobSpawning false')
    command('forceload add 1024 1024 1072 1024')
    initial = qa('setup'); details['initial'] = initial
    maid = {'maidUuid': initial['maidUuid'], 'ownerUuid': initial['ownerUuid']}
    adopted = response('qdmaid companion_adopt ' + uuid.uuid4().hex + ' ' + maid['maidUuid'] + ' ' + maid['ownerUuid'])
    details['adopted'] = adopted
    checks['native-adoption'] = adopted['ok'] and adopted['phase'] == 'applied'
    qa('place_behind')
    command('forceload remove all')
    frozen = until(lambda s: s['maidLoaded'] and not s['lastPositionEntityTicking'])
    time.sleep(1.2); frozen_again = qa('status')
    details['frozen'] = [frozen, frozen_again]
    checks['loaded-periphery-not-ticking-reproduced'] = (frozen_again['maidLoaded']
        and not frozen_again['lastPositionEntityTicking'] and frozen_again['distance'] > 24
        and frozen_again['bodyTickCount'] == frozen['bodyTickCount']
        and frozen_again['serverTick'] > frozen['serverTick'])
    resumed = qa('follow'); details['resumed'] = resumed
    recovered = until(lambda s: s.get('distance', 999) < 10 and s['lastPositionEntityTicking'])
    details['recovered'] = recovered
    checks['native-tlm-follows-after-entity-ticks-resume'] = (recovered['ticking']['eligible']
        and recovered['bodyTickCount'] > frozen['bodyTickCount'] and recovered['actualOwnerUuid'] == maid['ownerUuid'])
    time.sleep(1.2); second = qa('status'); details['steady'] = second
    checks['body-continues-ticking'] = (second['bodyTickCount'] > recovered['bodyTickCount']
        and second['lastPositionEntityTicking'] and second['ticking']['radius'] == 2
        and second['ticking']['timeoutTicks'] == 40 and second['ticking']['refreshTicks'] == 20)
    shifted = qa('shift_owner'); details['shifted'] = shifted
    followed = until(lambda s: s.get('distance', 999) < 10 and s['lastPositionEntityTicking'])
    details['followed'] = followed
    checks['native-follow-crosses-region-boundary'] = (followed['position'][0] > 1072
        and followed['bodyTickCount'] > second['bodyTickCount'] and followed['ticking']['eligible'])
    offline = qa('owner_offline'); details['offline'] = offline
    expired = until(lambda s: not s['lastPositionEntityTicking'] and s['serverTick'] - offline['serverTick'] > 45)
    details['expired'] = expired
    checks['owner-offline-stops-renewal-and-ticket-expires'] = (not expired['ownerOnline']
        and not expired['lastPositionEntityTicking'] and not (expired.get('ticking') or {}).get('eligible', False))
    checks['no-forced-chunks-remain'] = 'No force loaded chunks were found' in command('forceload query')
    checks['no-model-or-tts-requests'] = not (fake / 'requests.jsonl').exists()
