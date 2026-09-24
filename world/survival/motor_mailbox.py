"""Bounded durable commands. Caller owns action_lock for *_locked operations.

Cognition authorizes proposals, never the body. Claimed work is never replayed.
Latest observations stay in the controller; only commands/receipts are queued.
"""
import copy
import hashlib
import json
import re
import time
from numen_gateway import action_lock, read_json, write_json, TURN_ID, _read_json, receipt_evidence


def enabled(root):
    path = root / 'settings.json'
    return path.exists() and read_json(path).get('asyncMotor') is True


def binding(root):
    c = read_json(root / 'control.json')
    return {k:c.get(k) for k in ('mission','missionChangedAt','goalAgendaSelection')}


def open_cognition(root, turn_id, expires_at, clock=time.time):
    if not isinstance(turn_id,str) or not TURN_ID.fullmatch(turn_id):raise ValueError('invalid_turn_id')
    if not clock()*1000 < expires_at <= clock()*1000+600000:raise ValueError('invalid_cognition_expiry')
    with action_lock(root):
        control = read_json(root / 'control.json')
        if control.get('enabled') is not True or (control.get('drain') or {}).get('status') == 'requested':
            raise ValueError('cognition_admission_closed')
        path = root / 'cognition-lease.json'
        previous = read_json(path) if path.exists() else {}
        if previous.get('status') == 'open' and previous.get('expiresAt', 0) > clock()*1000:
            raise ValueError('cognition_already_open')
        if (root / 'unknown.json').exists():
            raise ValueError('outcome_unknown')
        lease = {'schema':1,'turnId':turn_id,'expiresAt':expires_at,'status':'open',
                 'actionsUsed':0,'actionLimit':6,'bodyAccess':'queued','goalBinding':binding(root)}
        write_json(root/'cognition-lease.json',lease)
    return lease


def cognition(root, turn_id, clock=time.time):
    path=root/'cognition-lease.json'
    if not enabled(root) or not path.exists():return None
    lease=read_json(path)
    if lease.get('turnId')!=turn_id:return None
    if lease.get('schema')!=1 or lease.get('status')!='open':raise ValueError('cognition_closed')
    if lease.get('expiresAt',0)<=clock()*1000:raise ValueError('cognition_expired')
    if lease.get('goalBinding')!=binding(root):raise ValueError('cognition_goal_changed')
    if (root/'unknown.json').exists():raise ValueError('outcome_unknown')
    if read_json(root/'control.json').get('enabled') is not True:raise ValueError('autonomy_disabled')
    return lease


def close_cognition(root, turn_id):
    with action_lock(root,blocking=True):
        path=root/'cognition-lease.json'
        if path.exists():
            lease=read_json(path)
            if lease.get('turnId')==turn_id:
                write_json(path,lease|{'status':'closed'})


def view(root):
    p=root/'motor-inbox.json'
    data=_read_json(p, 1024*1024) if p.exists() else {'schema':1,'requests':[]}
    if data.get('schema')!=1 or not isinstance(data.get('requests'),list) or len(data['requests'])>40:
        raise ValueError('invalid_motor_inbox')
    return data


def command_summary(payload):
    """Keep action intent after settlement removes the executable payload."""
    if not isinstance(payload, dict):
        return {}
    if 'tool' not in payload:
        return {key: copy.deepcopy(payload[key]) for key in ('name', 'version') if key in payload}
    result = {'tool': payload['tool']}
    args = payload.get('args', {})
    if len(json.dumps(args, ensure_ascii=False).encode()) <= 1024:
        result['args'] = copy.deepcopy(args)
    else:
        result['args'] = {key: value for key, value in args.items()
                          if type(value) in (int, float, bool, type(None))
                          or isinstance(value, str) and len(value) <= 100}
        result['argsTruncated'] = True
    return result


def brief_receipt(receipt):
    """Reduce repeated acquisition detail, keeping exact outcomes and identity.

    This is a read projection only. The full journal and status(detail="full")
    retain the original receipt; omitted scans are never inferred to be empty.
    """
    if not isinstance(receipt, dict):
        return receipt
    result = copy.deepcopy(receipt)
    # Full observations are redundant with the freshly acquired status body.
    for key in ('before', 'after'):
        result.pop(key, None)
    if result.get('status') == 'completed' and result.get('completionConfirmed') is True:
        result.pop('navigationSense', None)
        result.pop('outcomeDetail', None)
    elif isinstance(result.get('navigationSense'), dict):
        sense = result['navigationSense']
        result['navigationSense'] = {key: value for key, value in sense.items()
                                    if key in ('ok', 'code', 'observedAt', 'position', 'destination')}
        target = sense.get('destination')
        if isinstance(target, dict):
            target = {key: value for key, value in target.items() if key not in
                      ('notice', 'examinedCells', 'unloadedCells', 'targetBlock')}
            candidates = target.get('candidates')
            if isinstance(candidates, list) and len(candidates) > 3:
                target['candidates'] = candidates[:3]
                target['candidatesTruncated'] = True
            result['navigationSense']['destination'] = target
    if isinstance(result.get('lastExecution'), dict):
        result['lastExecution'] = brief_receipt(result['lastExecution'])
    return result


def compact_public(value):
    """Project every queue identity, with short recent outcome evidence."""
    if not isinstance(value, dict):
        return value
    result = copy.deepcopy(value)
    recent = result.get('recent', [])
    for index, row in enumerate(recent):
        if not isinstance(row, dict) or not isinstance(row.get('receipt'), dict):
            continue
        # Unsettled identities/evidence are never historical summaries, even if
        # an older producer put an unknown receipt under a terminal queue row.
        if row.get('status') not in ('completed', 'failed') or row['receipt'].get('status') == 'unknown':
            continue
        receipt = row['receipt'] = brief_receipt(row['receipt'])
        if index < len(recent) - 2:
            # Keep intent, exact outcome/IDs, partial gains and repeat lineage.
            # Old terrain is not a fresh route. New/unknown outcome fields stay
            # intact; only these known observation/boilerplate fields are omitted.
            for key in ('navigationPreflight', 'areaPreflight', 'positionAfter', 'notice'):
                receipt.pop(key, None)
            sense = receipt.get('navigationSense')
            if isinstance(sense, dict):
                receipt['navigationSense'] = {key: item for key, item in sense.items()
                                             if key in ('ok', 'code', 'observedAt')}
                if isinstance(sense.get('destination'), dict):
                    receipt['navigationSense']['destination'] = {
                        key: item for key, item in sense['destination'].items() if key in ('available', 'code')}
            verdict = receipt.get('navigationVerdict')
            if isinstance(verdict, dict):
                receipt['navigationVerdict'] = {key: item for key, item in verdict.items()
                                               if key in ('code', 'targetUsable', 'surveyCode')}
            outcome = receipt.get('navigationOutcome')
            if isinstance(outcome, dict):
                receipt['navigationOutcome'] = {key: item for key, item in outcome.items()
                    if key not in ('requested', 'final_x', 'final_y', 'final_z',
                                   'horizontalDistance', 'navigation_mode')
                    and (key != 'reason' or outcome.get('success') is not True)}
            row['receiptDetail'] = 'historical outcome; observations omitted, not absent; status(detail="full")'
    # Active/unknown rows remain exact; these identify work that must not replay.
    result['receiptDetail'] = 'brief; status(detail="full") retains full receipt details'
    return result


def confirmed_completion(row):
    receipt = row.get('receipt')
    return (row.get('status') == 'completed' and isinstance(receipt, dict)
            and receipt.get('status') == 'completed' and receipt.get('completionConfirmed') is True)


def request_result(row):
    """A duplicate is a receipt read, not another admission or a fresh action."""
    status = row['status']
    confirmed = confirmed_completion(row)
    result = {'ok': status in ('queued', 'claimed', 'completed', 'dispatched'),
              'code': 'motor_' + status, 'requestId': row['requestId'], 'status': status,
              'executionConfirmed': confirmed, 'retryAutomatically': False}
    if isinstance(row.get('receipt'), dict):
        result['receipt'] = brief_receipt(row['receipt'])
    if row.get('previousRequestId'):
        result['previousRequestId'] = row['previousRequestId']
    if confirmed and row.get('kind') == 'action':
        result['nextRepeat'] = {'previousRequestId': row['requestId']}
        result['instruction'] = ('这次动作已确认完成；先观察当前需要。若同轮确需再次执行相同动作，'
                                 '显式传previous_request_id=nextRepeat.previousRequestId；'
                                 '相同previous_request_id的重试只查询同一次后继，不会再执行。')
    elif status == 'queued':
        result['instruction'] = '执行请求已入队，身体由快循环调度；可say后remember(finish_turn=true,summary=...)结束本轮。查询status核对回执，不重复排队。'
    elif status == 'dispatched':
        result.update(dispatchConfirmed=row.get('receipt', {}).get('dispatchConfirmed') is True, effectConfirmed=False)
        result['instruction'] = '原生已受理施法，效果尚未确认；只观察当前原生法术与身体状态，不重发此请求。'
    else:
        result['instruction'] = '这是原请求的当前状态；未获确认完成，不可重发。读取status和准确回执后再决定下一步。'
    return result


def enqueue_locked(root, turn_id, kind, payload, clock=time.time, *, previous_request_id=None):
    lease=cognition(root,turn_id,clock)
    if not lease:raise ValueError('cognition_required')
    if kind not in ('action','skill') or not isinstance(payload,dict):raise ValueError('invalid_motor_command')
    encoded=json.dumps(payload,sort_keys=True,separators=(',',':'),allow_nan=False)
    if len(encoded.encode())>20000:raise ValueError('motor_command_too_large')
    base_identity=hashlib.sha256((turn_id+'\0'+kind+'\0'+encoded).encode()).hexdigest()
    payload_hash=hashlib.sha256(encoded.encode()).hexdigest()
    identity=base_identity
    data=view(root)
    if previous_request_id is not None:
        if kind != 'action' or not isinstance(previous_request_id, str) or not re.fullmatch(r'[0-9a-f]{64}', previous_request_id):
            raise ValueError('motor_previous_invalid')
        previous = next((r for r in data['requests'] if r['requestId'] == previous_request_id), None)
        if previous is None:
            raise ValueError('motor_previous_not_found')
        # Legacy base IDs already bind the full payload, even after settlement
        # removed it. New successors retain the hash; compact command args are
        # only a display projection and cannot prove an exact payload match.
        if (previous.get('turnId') != turn_id or previous.get('kind') != kind
                or not (previous.get('payloadHash') == payload_hash or previous_request_id == base_identity)):
            raise ValueError('motor_previous_mismatch')
        if not confirmed_completion(previous):
            return request_result(previous) | {'repeatAccepted': False, 'repeatCode': 'motor_previous_not_completed'}
        identity = hashlib.sha256((base_identity + '\0after\0' + previous_request_id).encode()).hexdigest()
    old=next((r for r in data['requests'] if r['requestId']==identity),None)
    if old is None:
        if lease['actionsUsed']>=6:raise ValueError('cognition_command_limit')
        if sum(r['status'] in ('queued','claimed','unknown') for r in data['requests'])>=8:
            raise ValueError('motor_inbox_full')
        row={'requestId':identity,'turnId':turn_id,'kind':kind,'payload':json.loads(encoded),
             'command':command_summary(payload),'payloadHash':payload_hash,
             'goalBinding':lease['goalBinding'],'status':'queued','createdAt':clock(),
             'expiresAt':min(clock()+300,lease['expiresAt']/1000), 'motorTurnId':'motor-'+identity[:32]}
        if previous_request_id is not None:
            row['previousRequestId'] = previous_request_id
        # Budget first: a crash cannot buy more commands; no external effect here.
        write_json(root/'cognition-lease.json',lease|{'actionsUsed':lease['actionsUsed']+1})
        retained=[r for r in data['requests'] if r['status'] in ('queued','claimed','unknown')]
        history=[r for r in data['requests'] if r['status'] not in ('queued','claimed','unknown')][-24:]
        data['requests']=history+retained+[row];write_json(root/'motor-inbox.json',data)
        old=row
    return request_result(old)


def claim_locked(root, clock=time.time):
    data=view(root)
    if any(r['status'] in ('claimed','unknown') for r in data['requests']):return None
    changed=False;selected=None;current=binding(root)
    for row in data['requests']:
        if row['status']!='queued':continue
        if row['expiresAt']<=clock() or row['goalBinding']!=current:
            row.update(status='expired',finishedAt=clock())
            row.pop('payload', None)
            changed=True;continue
        row.update(status='claimed',claimedAt=clock());selected=row;changed=True;break
    if changed:write_json(root/'motor-inbox.json',data)
    return selected


def expire_queued_locked(root, clock=time.time):
    """Retire unsent commands when the operator drains the body owner."""
    data = view(root)
    changed = 0
    for row in data['requests']:
        if row['status'] == 'queued':
            row.update(status='expired', finishedAt=clock())
            row.pop('payload', None)
            changed += 1
    if changed:
        write_json(root/'motor-inbox.json', data)
    return changed


def finish_locked(root, identity, status, receipt):
    if status not in ('completed','failed','unknown','cancelled','dispatched'):raise ValueError('invalid_motor_terminal')
    data=view(root);row=next(r for r in data['requests'] if r['requestId']==identity)
    if row['status'] not in ('claimed','unknown'):raise ValueError('motor_already_terminal')
    if 'command' not in row and isinstance(row.get('payload'), dict):
        row['command'] = command_summary(row['payload'])
    # The original gateway/practice journal owns full observations. Keeping
    # them again here would grow a bounded command queue into a context log.
    cast_request = (receipt.get('result', {}).get('result', {}).get('data', {}).get('receipt', {})
                    if status == 'dispatched' else {})
    if row['kind']=='action' and receipt.get('actionId'):
        receipt = receipt_evidence(receipt)
    if status == 'dispatched':
        receipt.update(dispatchConfirmed=True, effectConfirmed=False, castRequestId=cast_request['requestId'],
            notice='Native casting was accepted; spell effects are not confirmed. '
                   'Observe current native spell/body status before deciding further actions; do not replay this request.')
    row.update(status=status,receipt=receipt,finishedAt=time.time())
    if status != 'unknown':
        row.pop('payload', None)
    write_json(root/'motor-inbox.json',data)


def public(root, detail='full'):
    if detail not in ('full', 'brief'):
        raise ValueError('invalid_motor_detail')
    rows=view(root)['requests']
    recent = []
    for row in rows[-6:]:
        result = {k:row.get(k) for k in ('requestId','turnId','kind','status')}
        receipt = row.get('receipt')
        result['receipt'] = receipt
        command = row.get('command') or command_summary(row.get('payload'))
        if command:
            result['command'] = command
        if row.get('previousRequestId'):
            result['previousRequestId'] = row['previousRequestId']
        if row.get('kind') == 'action' and confirmed_completion(row):
            result['nextRepeat'] = {'previousRequestId': row['requestId']}
        recent.append(result)
    result = {'version':1,'pending':sum(r['status']=='queued' for r in rows),
            'active':[{k:r.get(k) for k in ('requestId','kind','status','createdAt','motorTurnId')}
                      for r in rows if r['status'] in ('claimed','unknown')],
            'recent':recent,'capacity':8}
    return compact_public(result) if detail == 'brief' else result
