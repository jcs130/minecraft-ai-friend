"""Real native TLM receipt-only callbacks against the isolated fake NPC."""
import json
import time


def fake_server_source():
    # The fake explicitly cannot reach a model: its QA Docker network is internal.
    # Hold all burst responses until the three distinct requests arrive, proving
    # the real bridge did not reject requests two and three as already active.
    return '''import hashlib,hmac,json,threading,time
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
lock=threading.Lock()
burst_ready=threading.Event()
burst_ids=set()
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args): pass
 def do_POST(self):
  raw=self.rfile.read(min(int(self.headers.get('Content-Length','0')),65537))
  key=Path('/fake/identity.key').read_text().strip().encode()
  request_id=self.headers.get('X-QD-Request-Id','')
  signed=request_id+'\\n'+self.headers.get('X-QD-Issued-At','')+'\\n'+hashlib.sha256(raw).hexdigest()
  valid=self.path=='/v1/maid/chat/completions' and hmac.compare_digest(hmac.new(key,signed.encode(),hashlib.sha256).hexdigest(),self.headers.get('X-QD-Signature',''))
  obj=json.loads(raw); identity=obj['qd_identity']
  latest=next((r['content'] for r in reversed(obj['messages']) if r['role']=='user'),'')
  queued=obj.get('qd_delivery')=='perception_queue_v1'
  burst=queued and any('PERCEPTION_QA_INPUT_'+str(i) in latest for i in range(1,4))
  marker='QA_REPLY_'+identity['maidUuid']
  invalid=queued and 'PERCEPTION_QA_INVALID_RECEIPT' in latest
  status=202 if queued else 200
  if not valid: status=403
  record={'validSignature':valid,'requestId':request_id,'bodySha256':hashlib.sha256(raw).hexdigest(),'identity':identity,'toolsAbsent':'tools' not in obj,'path':self.path,'delivery':obj.get('qd_delivery'),'latestUser':latest,'messageRoles':[r['role'] for r in obj['messages']],'oldContextIncluded':any('PERCEPTION_QA_OLD_CONTEXT_' in r['content'] for r in obj['messages']),'burst':burst,'invalidReceipt':invalid,'httpStatus':status}
  with lock:
   if burst: burst_ids.add(request_id)
   with Path('/fake/requests.jsonl').open('a') as stream: stream.write(json.dumps(record)+'\\n')
   if len(burst_ids)>=3: burst_ready.set()
  if burst: burst_ready.wait(5)
  if queued:
   payload={'schema':1,'object':'qiandeng.maid.input_receipt','request_id':'mismatched-request' if invalid else request_id,'state':'queued','persisted':True,'wake_requested':False,'assistant_reply':False}
  else: payload={'choices':[{'message':{'role':'assistant','content':marker}}]}
  with lock:
   with Path('/fake/responses.jsonl').open('a') as stream: stream.write(json.dumps({'requestId':request_id,'burstReceivedBeforeResponse':len(burst_ids),'httpStatus':status,'invalidReceipt':invalid})+'\\n')
  body=json.dumps(payload).encode()
  self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
ThreadingHTTPServer(('0.0.0.0',8091),Handler).serve_forever()
'''


def check_perception(*, response, command, run, base, data, fake, checks, details):
    def qa(action):
        value = response('qdperceptionqa ' + action, 'QD_PERCEPTION_QA ')
        if not value.get('ok'): raise RuntimeError('perception_fixture_failed: ' + str(value))
        return value

    def records(name='requests.jsonl'):
        path = fake / name
        return [json.loads(line) for line in path.read_text('utf8').splitlines()] if path.exists() else []

    def native_reply(maid_uuid):
        # TLM ResponseChat(String) defaults ttsText to chatText; native history
        # saves ResponseChat.toString() as "%s---%s", even with TTS disabled.
        marker = 'QA_REPLY_' + maid_uuid
        return marker + '---' + marker

    def until(predicate, seconds=30):
        deadline = time.monotonic() + seconds
        value = None
        while time.monotonic() < deadline:
            value = qa('status')
            if predicate(value): return value
            time.sleep(0.5)
        raise RuntimeError('perception_observation_timeout: ' + str(value))

    initial = qa('setup'); details['initial'] = initial
    checks['isolated-exact-yui-numen-pair'] = (initial['yui']['maidUuid'] == 'e6ef6001-47c6-4f13-823c-1b724520d164'
        and initial['yui']['ownerUuid'] == 'd4ac9523-4962-43ed-98c5-19b49e104048'
        and initial['yui']['ownerType'] == 'com.dwinovo.numen.entity.NumenPlayer')
    checks['native-bridge-site-for-both-characters'] = all(initial[k]['siteClass'] == 'dev.qiandeng.maid.BridgeSite' for k in ('yui','other'))
    checks['initial-history-and-bubbles-empty'] = all(not initial[k]['assistantHistory'] and not initial[k]['userHistory'] and initial[k]['bubbleCount'] == 0 for k in ('yui','other'))
    burst = qa('burst'); details['burstSubmit'] = burst
    checks['native-normal-manager-three-inputs-same-tick'] = burst['submitted'] == 3 and len(burst['yui']['userHistory']) == 3
    checks['native-waiting-bubble-created'] = burst['yui']['bubbleCount'] > 0
    accepted = until(lambda s: len(records('responses.jsonl')) == 3 and s['yui']['bubbleCount'] == 0)
    details['afterAccepted'] = accepted
    requests = records(); receipts = records('responses.jsonl')
    checks['all-three-signed-inputs-accepted-concurrently'] = (len(requests) == 3 and len({r['requestId'] for r in requests}) == 3
        and all(r['validSignature'] and r['toolsAbsent'] and r['burst'] and r['httpStatus'] == 202 for r in requests)
        and all(r['burstReceivedBeforeResponse'] == 3 for r in receipts))
    checks['three-latest-inputs-preserved'] = all(any('PERCEPTION_QA_INPUT_' + str(i) in r['latestUser'] for r in requests) for i in (1,2,3))
    checks['queue-sends-only-current-user-input'] = all(r['messageRoles'] == ['user'] for r in requests)
    checks['receipt-does-not-create-assistant-history'] = accepted['yui']['assistantHistory'] == []
    checks['receipt-clears-native-waiting-bubbles'] = accepted['yui']['bubbleCount'] == 0
    logs = run([*base, 'logs', '--no-color', 'mc'], check=False).stdout
    checks['accepted-receipts-do-not-trigger-native-failure'] = all(code not in logs for code in ('maid_request_busy','bridge_input_busy','qwen_request_unavailable_no_retry','qwen_reply_invalid'))

    qa('normal')
    normal = until(lambda s: len(s['other']['assistantHistory']) == 1)
    details['afterNormalCharacter'] = normal
    other_requests = [r for r in records() if r['identity']['maidUuid'] == initial['other']['maidUuid']]
    checks['other-character-preserves-sync-200'] = (len(other_requests) == 1 and other_requests[0]['delivery'] is None
        and other_requests[0]['httpStatus'] == 200 and other_requests[0]['validSignature']
        and normal['other']['assistantHistory'] == [native_reply(initial['other']['maidUuid'])])

    qa('subclass')
    subclass = until(lambda s: len(s['yui']['assistantHistory']) == 1)
    details['afterYuiSubclass'] = subclass
    subrequests = [r for r in records() if 'PERCEPTION_QA_SUBCLASS' in r['latestUser']]
    checks['yui-callback-subclass-preserves-sync-200'] = (len(subrequests) == 1 and subrequests[0]['delivery'] is None
        and subrequests[0]['httpStatus'] == 200 and subrequests[0]['validSignature']
        and subclass['yui']['assistantHistory'] == [native_reply(initial['yui']['maidUuid'])])

    long_submit = qa('long_history')
    # Keep reports concise: old history contents themselves are not needed.
    details['longHistory'] = {'submitted':long_submit['submitted'],
        'nativeHistoryCharacters':long_submit['yui']['userHistoryCharacters']}
    long_status = until(lambda s: any('PERCEPTION_QA_AFTER_LONG_HISTORY' in r['latestUser']
        for r in records()) and not any('WaitingChatBubbleData' in kind for kind in s['yui']['bubbleKinds']))
    long_requests = [r for r in records() if 'PERCEPTION_QA_AFTER_LONG_HISTORY' in r['latestUser']]
    checks['long-native-history-does-not-block-new-input'] = (details['longHistory']['nativeHistoryCharacters'] > 12000
        and len(long_requests) == 1 and long_requests[0]['validSignature'] and long_requests[0]['httpStatus'] == 202
        and long_requests[0]['messageRoles'] == ['user'] and not long_requests[0]['oldContextIncluded']
        and long_status['yui']['assistantHistory'] == subclass['yui']['assistantHistory'])

    qa('invalid')
    deadline = time.monotonic() + 25
    while time.monotonic() < deadline:
        logs = run([*base, 'logs', '--no-color', 'mc'], check=False).stdout
        if 'qwen_reply_invalid' in logs: break
        time.sleep(0.5)
    invalid = qa('status'); details['afterInvalidReceipt'] = invalid
    checks['invalid-receipt-is-failure-not-assistant-speech'] = ('qwen_reply_invalid' in logs
        and invalid['yui']['assistantHistory'] == subclass['yui']['assistantHistory'])
    before_count = len(records()); time.sleep(2); after_count = len(records())
    checks['invalid-receipt-no-automatic-retry'] = before_count == after_count == 7
    details['requests'] = records(); details['responses'] = records('responses.jsonl')
    command('save-all flush')
    checks['isolated-save-written'] = (data / 'qa-world/level.dat').exists()
