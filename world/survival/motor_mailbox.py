"""Bounded durable commands. Caller owns action_lock for *_locked operations.

Cognition authorizes proposals, never the body. Claimed work is never replayed.
Latest observations stay in the controller; only commands/receipts are queued.
"""
import hashlib
import json
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


def enqueue_locked(root, turn_id, kind, payload, clock=time.time):
    lease=cognition(root,turn_id,clock)
    if not lease:raise ValueError('cognition_required')
    if kind not in ('action','skill') or not isinstance(payload,dict):raise ValueError('invalid_motor_command')
    encoded=json.dumps(payload,sort_keys=True,separators=(',',':'),allow_nan=False)
    if len(encoded.encode())>20000:raise ValueError('motor_command_too_large')
    identity=hashlib.sha256((turn_id+'\0'+kind+'\0'+encoded).encode()).hexdigest()
    data=view(root)
    old=next((r for r in data['requests'] if r['requestId']==identity),None)
    if old is None:
        if lease['actionsUsed']>=6:raise ValueError('cognition_command_limit')
        if sum(r['status'] in ('queued','claimed','unknown') for r in data['requests'])>=8:
            raise ValueError('motor_inbox_full')
        row={'requestId':identity,'turnId':turn_id,'kind':kind,'payload':json.loads(encoded),
             'goalBinding':lease['goalBinding'],'status':'queued','createdAt':clock(),
             'expiresAt':min(clock()+300,lease['expiresAt']/1000), 'motorTurnId':'motor-'+identity[:32]}
        # Budget first: a crash cannot buy more commands; no external effect here.
        write_json(root/'cognition-lease.json',lease|{'actionsUsed':lease['actionsUsed']+1})
        retained=[r for r in data['requests'] if r['status'] in ('queued','claimed','unknown')]
        history=[r for r in data['requests'] if r['status'] not in ('queued','claimed','unknown')][-24:]
        data['requests']=history+retained+[row];write_json(root/'motor-inbox.json',data)
        old=row
    return {'ok':True,'code':'motor_queued','requestId':identity,'status':old['status'],
            'executionConfirmed':False,'retryAutomatically':False,
            'instruction':'执行请求已入队，身体由快循环调度；可继续规划或结束本轮。查询status核对回执，不重复排队。'}


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
    if status not in ('completed','failed','unknown','cancelled'):raise ValueError('invalid_motor_terminal')
    data=view(root);row=next(r for r in data['requests'] if r['requestId']==identity)
    if row['status'] not in ('claimed','unknown'):raise ValueError('motor_already_terminal')
    # The original gateway/practice journal owns full observations. Keeping
    # them again here would grow a bounded command queue into a context log.
    if row['kind']=='action' and receipt.get('actionId'):
        receipt = receipt_evidence(receipt)
    row.update(status=status,receipt=receipt,finishedAt=time.time())
    if status != 'unknown':
        row.pop('payload', None)
    write_json(root/'motor-inbox.json',data)


def public(root):
    rows=view(root)['requests']
    recent = []
    for row in rows[-6:]:
        result = {k:row.get(k) for k in ('requestId','turnId','kind','status')}
        receipt = row.get('receipt')
        result['receipt'] = receipt
        recent.append(result)
    return {'version':1,'pending':sum(r['status']=='queued' for r in rows),
            'active':[{k:r.get(k) for k in ('requestId','kind','status','createdAt','motorTurnId')}
                      for r in rows if r['status'] in ('claimed','unknown')],
            'recent':recent,'capacity':8}
