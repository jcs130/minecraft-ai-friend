"""Physical companion checks used only by the isolated maid smoke harness."""
import time
import uuid
import base64
import hashlib
import json


def check_companion(*, response, command, invoke, run, base, data, fake, checks, details):
    def qa(action):
        value = response('qdmaidcompanionqa ' + action, 'QD_COMPANION_QA ')
        if not value.get('ok'):
            raise RuntimeError('companion_fixture_failed: ' + str(value.get('failure')))
        return value

    def until(predicate, seconds=45):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            value = qa('status')
            if predicate(value):
                return value
            time.sleep(1)
        raise RuntimeError('companion_observation_timeout: ' + str(value))

    initial = qa('setup'); details['initial'] = initial
    maid = {'maidUuid': initial['maidUuid'], 'ownerUuid': initial['expectedOwnerUuid']}
    config = 'qdmaid companion_chat ' + maid['maidUuid'] + ' ' + maid['ownerUuid']
    checks['fresh-unowned-body'] = not initial['tame'] and initial['actualOwnerUuid'] == ''
    checks['native-numen-survival-body'] = initial['ownerClass'] == 'com.dwinovo.numen.entity.NumenPlayer'
    rejected = response(config)
    checks['unowned-config-rejected'] = not rejected['ok'] and rejected['code'] == 'unowned_maid'
    adopt = 'qdmaid companion_adopt ' + uuid.uuid4().hex + ' ' + maid['maidUuid'] + ' ' + maid['ownerUuid']
    def attempt():
        return 'qdmaid companion_adopt ' + uuid.uuid4().hex + ' ' + maid['maidUuid'] + ' ' + maid['ownerUuid']
    qa('adopt_far'); far_reject = response(attempt()); qa('adopt_near')
    checks['adopt-distance-no-auto-path'] = not far_reject['ok'] and far_reject['code'] == 'within_three_blocks_required'
    qa('adopt_wall'); sight_reject = response(attempt()); qa('adopt_clear_wall')
    checks['adopt-line-of-sight'] = not sight_reject['ok'] and sight_reject['code'] == 'line_of_sight_required'
    qa('adopt_no_item'); item_reject = response(attempt()); qa('adopt_restore_item')
    checks['adopt-native-item-required'] = not item_reject['ok'] and item_reject['code'] == 'held_native_taming_item_required'
    adoption = response(adopt); details['adoptionReceipt'] = adoption
    replay = response(adopt)
    checks['adopt-durable-receipt-replay'] = replay['ok'] and replay.get('replayedReceipt') is True
    fresh_reject = response(attempt())
    checks['adopt-fresh-id-does-not-repeat'] = not fresh_reject['ok'] and fresh_reject['code'] == 'already_owned'
    adopted = until(lambda s: s['actualOwnerUuid'] == maid['ownerUuid']); details['adopted'] = adopted
    checks['normal-numen-cake-adoption'] = adopted['tame'] and adopted['ownerResolved']
    checks['cake-consumed-exactly-once'] = initial['cakeCount'] - adopted['cakeCount'] == 1
    checks['native-maid-count-and-event'] = adopted['maidCount'] - initial['maidCount'] == 1 and adopted['tameEvents'] == 1
    checks['adopt-offhand-preserves-main-item'] = adoption['hand'] == 'OFF_HAND' and adopted['mainHand'] == initial['mainHand'] == 'minecraft:iron_sword'
    checks['adopt-does-not-path-or-call-model'] = adoption.get('autoPathing') is False and adoption.get('modelCalled') is False
    rejected = response('qdmaidcompanionqa adopt', 'QD_COMPANION_QA ')
    checks['adoption-not-repeated'] = not rejected['ok'] and rejected['cakeCount'] == adopted['cakeCount'] and rejected['tameEvents'] == 1
    wrong = response('qdmaid companion_chat ' + maid['maidUuid'] + ' ' + str(uuid.uuid4()))
    checks['wrong-owner-config-rejected'] = not wrong['ok'] and wrong['code'] == 'owner_changed'
    qa('disable_native_chat'); disabled = response(config); qa('enable_native_chat')
    checks['global-disabled-not-overridden'] = not disabled['ok'] and disabled['code'] == 'native_chat_globally_disabled'
    configured = response(config); repeated = response(config); details['configured'] = configured
    checks['native-chat-configured-without-gui'] = configured['ok'] and configured['llmModel'] == 'qd-maid-dialogue' and configured['state']['nativeChatSetting']
    checks['enabled-codingplan-selected-with-deepseek-disabled'] = configured['llmSite'] == 'codingplan'
    checks['chat-config-idempotent'] = repeated['ok'] and repeated['code'] == 'already_configured'
    checks['no-model-triggered-by-config'] = configured.get('modelCalled') is False and not (fake / 'requests.jsonl').exists()
    checks['tts-preserved'] = qa('status')['ttsSite'] == initial['ttsSite']
    def speech(speaker, listener, text='一起出发吧。', event_id=None, channel='nearby'):
        event_id = event_id or str(uuid.uuid4())
        body = {'schema': 1, 'eventId': event_id, 'speakerUuid': speaker, 'listenerUuid': listener,
                'text': text, 'textSha256': hashlib.sha256(text.encode('utf8')).hexdigest(), 'channel': channel}
        encoded = base64.urlsafe_b64encode(json.dumps(body, ensure_ascii=False).encode('utf8')).decode().rstrip('=')
        value = response('qdmaid party_say ' + encoded)
        if channel == 'msg' and value['phase'] == 'unknown':
            # Nested vanilla commands complete through their native success callback.
            value = response('qdmaid party_speech_status ' + event_id)
        return value, body
    spoken, speech_input = speech(maid['ownerUuid'], maid['maidUuid']); details['nearbySpeech'] = spoken
    checks['physical-near-speech-heard'] = spoken['heard'] and spoken['phase'] == 'heard' and spoken['distance'] <= 24 and spoken['radius'] == 24
    record = json.loads((data / 'data/qiandeng-maid-bridge/party-speech' / (speech_input['eventId'] + '.json')).read_text('utf8'))
    checks['physical-hearing-event-with-text-and-position'] = record['input'] == speech_input and record['eventType'] == 'nearby_speech_heard' and len(record['receipt']['listenerPosition']) == 3
    backwards, _ = speech(maid['maidUuid'], maid['ownerUuid'], '听见了，等我一起。')
    checks['physical-maid-reply-same-world-path'] = backwards['heard'] and backwards['speakerUuid'] == maid['maidUuid']
    replay, _ = speech(maid['ownerUuid'], maid['maidUuid'], event_id=speech_input['eventId'])
    checks['physical-speech-replay-no-broadcast'] = replay['heard'] and replay['code'] == 'already_heard' and replay['emittedAt'] == spoken['emittedAt']
    conflict, _ = speech(maid['ownerUuid'], maid['maidUuid'], '换了内容', speech_input['eventId'])
    checks['physical-speech-id-content-conflict'] = not conflict['heard'] and conflict['code'] == 'request_id_conflict'
    forged, _ = speech(maid['ownerUuid'], maid['ownerUuid'])
    checks['physical-speech-forged-pair-refused'] = not forged['heard'] and forged['code'] == 'numen_owned_maid_pair_required'
    msg_maid, _ = speech(maid['ownerUuid'], maid['maidUuid'], channel='msg')
    checks['vanilla-msg-cannot-target-maid-no-public-fallback'] = not msg_maid['heard'] and msg_maid['code'] == 'unsupported_player_target'
    qa('far_owner'); distant, distant_input = speech(maid['ownerUuid'], maid['maidUuid'])
    private, private_input = speech(maid['maidUuid'], maid['ownerUuid'], '这是一条游戏私聊。', channel='msg')
    details['nativePrivateMessage'] = private
    checks['unavailable-msg-not-treated-as-heard'] = not private['heard'] and private['code'] == 'native_msg_unavailable' and private['channel'] == 'msg' and private['radius'] is None
    private_record = json.loads((data / 'data/qiandeng-maid-bridge/party-speech' / (private_input['eventId'] + '.json')).read_text('utf8'))
    checks['unavailable-msg-persisted-without-fallback'] = private_record['eventType'] == 'private_message_rejected' and not private_record['receipt']['heard']
    qa('adopt_near')
    checks['physical-speech-out-of-range-refused'] = not distant['heard'] and distant['code'] == 'outside_hearing_radius'
    refused, _ = speech(maid['ownerUuid'], maid['maidUuid'], event_id=distant_input['eventId'])
    checks['physical-speech-not-queued-until-near'] = not refused['heard'] and refused['code'] == 'outside_hearing_radius'
    qa('speech_other_dimension'); dimension, _ = speech(maid['ownerUuid'], maid['maidUuid'])
    private_dimension, _ = speech(maid['maidUuid'], maid['ownerUuid'], channel='msg')
    checks['unavailable-msg-cannot-evade-dimension-boundary'] = not private_dimension['heard'] and private_dimension['code'] == 'native_msg_unavailable'
    qa('speech_restore_dimension')
    checks['physical-speech-dimension-boundary'] = not dimension['heard'] and dimension['code'] == 'different_dimension'
    qa('owner_offline'); unloaded, _ = speech(maid['maidUuid'], maid['ownerUuid']); qa('restore_owner')
    checks['physical-speech-unloaded-recipient-refused'] = not unloaded['heard'] and unloaded['code'] == 'maid_not_loaded'
    absent = response('qdmaid party_speech_status ' + str(uuid.uuid4()))
    checks['physical-speech-missing-status-not-heard'] = absent['phase'] == 'not_found' and absent['speakerUuid'] is None and not absent['heard']
    qa('close_menu')
    invoke(maid, 'follow', {'follow': True}); invoke(maid, 'sit', {'sit': False})
    qa('follow_walk')
    walking = until(lambda s: s['ownerX'] > 7.5 and s['maidX'] > 2.5 and s['distance'] < 4.5, 75)
    details['walking'] = walking
    checks['numen-walk-and-native-maid-follow'] = walking['ownerX'] > 7.5 and walking['maidX'] > 2.5 and walking['following']
    invoke(maid, 'sit', {'sit': True}); seated = qa('status'); qa('far_owner'); time.sleep(5)
    sitting = qa('status'); details['sitting'] = sitting
    checks['native-sitting-blocks-follow'] = sitting['sitting'] and abs(sitting['maidX'] - seated['maidX']) < 1.0 and sitting['distance'] > 10
    invoke(maid, 'sit', {'sit': False})
    far = until(lambda s: s['distance'] < 5, 45); details['farFollow'] = far
    checks['far-native-rejoin'] = far['distance'] < 5
    # The native task may walk or teleport; this assertion deliberately does not claim which.
    qa('owner_offline'); time.sleep(2); offline = qa('status'); details['offline'] = offline
    checks['offline-owner-unresolved'] = not offline['ownerOnline'] and not offline['ownerResolved']
    unavailable = response(config)
    checks['offline-config-rejected'] = not unavailable['ok'] and unavailable['code'] == 'online_numen_owner_required'
    restored = qa('restore_owner'); details['ownerRestored'] = restored
    checks['same-numen-uuid-inventory-count-restored'] = restored['ownerUuid'] == maid['ownerUuid'] and restored['cakeCount'] == adopted['cakeCount'] and restored['maidCount'] == adopted['maidCount']
    command('save-all flush')
    run([*base, 'stop', '-t', '60', 'mc'], timeout=100)
    run([*base, 'start', 'mc'], timeout=60)
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        try:
            restarted = qa('restore_owner')
            if restarted.get('maidLoaded'):
                break
        except (RuntimeError, ValueError):
            pass
        time.sleep(3)
    else:
        raise RuntimeError('companion_restart_timeout')
    details['afterRestart'] = restarted
    checks['restart-body-owner-chat-preserved'] = restarted['actualOwnerUuid'] == maid['ownerUuid'] and restarted['ownerResolved'] and restarted['llmSite'] == 'codingplan' and restarted['llmModel'] == 'qd-maid-dialogue' and restarted['nativeSetting']
    checks['restart-inventory-count-preserved'] = restarted['cakeCount'] == adopted['cakeCount'] and restarted['maidCount'] == adopted['maidCount']
    persisted = response(adopt)
    checks['adoption-receipt-survives-server-restart'] = persisted['ok'] and persisted.get('replayedReceipt') is True and qa('status')['cakeCount'] == adopted['cakeCount']
    heard_after_restart = response('qdmaid party_speech_status ' + speech_input['eventId'])
    checks['physical-heard-event-survives-restart'] = heard_after_restart['heard'] and heard_after_restart['emittedAt'] == spoken['emittedAt'] and heard_after_restart['textSha256'] == speech_input['textSha256']
    private_after_restart = response('qdmaid party_speech_status ' + private_input['eventId'])
    checks['unavailable-msg-rejection-survives-restart'] = not private_after_restart['heard'] and private_after_restart['channel'] == 'msg' and private_after_restart['code'] == 'native_msg_unavailable'
    checks['physical-hearing-confirmation-time-ordered'] = spoken['observedAt'] >= spoken['emittedAt']
    checks['zero-generated-model-or-tts-calls'] = not (fake / 'requests.jsonl').exists()
