"""Bounded, read-only Paper activity projection. No game commands or game writes.

Requires the existing PyYAML. Output is a replacement snapshot, never a batch to
add again. Logs contribute only anchored AgentFriend server receipts; no chat is
exported. CoreProtect is opened mode=ro and only registered public boxes are read.
"""
from __future__ import annotations
import argparse
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
import gzip
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import time
import uuid
import os
import yaml

ZONE = timezone(timedelta(hours=8))
CATEGORIES = dict(farming="农业", crafting="制造", construction="建设", exploration="探索",
                  combat="战斗", fishing="垂钓", trade="商贸", culture="文化与创作",
                  logistics="补给与交付", magic="魔法", mixed="综合委托", other="其他/待分类")
GOALS = {
    **dict.fromkeys("harvest replant".split(), "farming"),
    **dict.fromkeys("craft".split(), "crafting"),
    **dict.fromkeys("build road bridge redstone lanterns".split(), "construction"),
    **dict.fromkeys("explore peak biome biome_border dimension structure return map_hunt".split(), "exploration"),
    **dict.fromkeys("kills witch_kills floor party_floor light_floor mark_kills parry site_clear".split(), "combat"),
    "fish": "fishing", "trade": "trade", "donate": "logistics", "skill_cast": "magic",
    "photo": "culture", "photo_hang": "culture", "healing": "magic",
}
ID = re.compile(r"[a-z0-9][a-z0-9_.-]{0,95}\Z")
NAME = re.compile(r"[.A-Za-z0-9_ -]{1,32}\Z")
LOG_HEAD = re.compile(r"^\[(\d{2}:\d{2}:\d{2})\] \[Server thread/INFO\]: \[AgentFriend\] (.*)$")
CLAIM = re.compile(r"Guild (claimed|accepted): player=([a-f0-9-]{36}), contract=([a-z0-9_.-]+)(?:, fame=(\d+))?$")
LIFE = re.compile(r"Life guild claim: player=([a-f0-9-]{36}), id=([a-z0-9_.-]+)$")
TRANSFER = re.compile(r"Guild donation ([.A-Za-z0-9_ -]{1,32}) stashSlot=(\d+) chest=([0-3]) item=([A-Z0-9_]+) count=(\d+)$")


def identity(value):
    try: return str(uuid.UUID(str(value)))
    except (ValueError, AttributeError): return None


def key(*parts):
    return hashlib.sha256(json.dumps(parts, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()[:32]


def stamp(value):
    return value.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')


def from_ms(value):
    if type(value) not in (int, float) or value <= 0: return None
    try: return datetime.fromtimestamp(value / 1000, ZONE)
    except (ValueError, OSError, OverflowError): return None


def category(goals):
    tags = sorted({GOALS.get(str(g).lower(), 'other') for g in goals})
    known = set(tags) - {'other'}
    if known and known <= {'farming', 'trade'} and 'farming' in known: primary = 'farming'
    else: primary = next(iter(known)) if len(known) == 1 else 'mixed' if len(known) > 1 else 'other'
    return primary, tags or ['other']


def stable_yaml(file, max_bytes=8*1024*1024):
    for _ in range(2):
        before = file.stat()
        if not file.is_file() or before.st_size > max_bytes: raise ValueError('source_size_limit')
        data = file.read_bytes(); after = file.stat()
        if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns): continue
        value = yaml.safe_load(data.decode('utf-8-sig'))
        if not isinstance(value, dict): raise ValueError('source_not_mapping')
        return value, stamp(datetime.fromtimestamp(after.st_mtime, ZONE))
    raise ValueError('source_changing')


def catalogue(server, static):
    result = dict(static)
    errors = []
    folder = server/'plugins/AgentFriend'
    for name in ('task-market.yml', 'resident-contracts.yml', 'route-contracts.yml'):
        try:
            doc, _ = stable_yaml(folder/name)
            for task, definition in doc.get('tasks', {}).items():
                if not ID.fullmatch(task) or not isinstance(definition, dict): continue
                goals = [s.get('goal') for s in definition.get('steps', []) if isinstance(s, dict)]
                primary, tags = category(goals)
                result[task] = {'title': str(definition.get('title', task))[:160], 'category': primary, 'tags': tags}
        except (OSError, ValueError, yaml.YAMLError): errors.append(name)
    try:
        doc,_=stable_yaml(folder/'dynamic-board.yml')
        for template,row in doc.get('templates',{}).items():
            if isinstance(row,dict) and ID.fullmatch(template):
                primary,tags=category([row.get('goal')])
                result['template:'+template]={'title':str(row.get('title',template))[:160],'category':primary,'tags':tags}
    except (OSError,ValueError,yaml.YAMLError):errors.append('dynamic-board.yml')
    return result, errors


def task_info(task, definitions, steps=None):
    found = definitions.get(task, {})
    if not found:
        dynamic=re.fullmatch(r'db_\d{8}_([a-z0-9_.-]+)',task)
        if dynamic:found=definitions.get('template:'+dynamic[1],{})
    primary, tags = category([r.get('goal') for r in steps if isinstance(r, dict)]) if steps else (found.get('category', 'other'), found.get('tags', ['other']))
    return {'title': found.get('title', task), 'category': primary, 'tags': tags}


def log_events(lines, day, definitions, names):
    """Recognize only final server receipts, never user chat / failed claims."""
    commissions, donations = [], []
    occurrences = defaultdict(int)
    for line in lines:
        head = LOG_HEAD.fullmatch(line.rstrip('\r\n'))
        if not head: continue
        clock, body = head.groups()
        try: at = datetime.fromisoformat(day+'T'+clock+'+08:00')
        except ValueError: continue
        found = CLAIM.fullmatch(body)
        if found:
            action, player, task, fame = found.groups()
            if not identity(player): continue
            status = 'completed' if action == 'claimed' else 'accepted'
            commissions.append({'id':key('guild',player,task,stamp(at),status,fame), 'playerUuid':player,
                'system':'guild','taskId':task, **task_info(task,definitions),'status':status,
                'occurredAt':stamp(at),'day':day,'source':'server_success_log'})
            continue
        found = LIFE.fullmatch(body)
        if found:
            player, task = found.groups()
            if not identity(player): continue
            commissions.append({'id':key('life',player,task,day),'playerUuid':player,'system':'life',
                'taskId':task, **task_info(task,definitions),'status':'completed','occurredAt':stamp(at),
                'day':day,'source':'server_success_log'})
            continue
        found = TRANSFER.fullmatch(body)
        if found:
            name, slot, box, material, amount = found.groups(); amount = int(amount)
            if not 0 < amount <= 999999: continue
            occurrences[(clock,body)] += 1
            donations.append({'id':key('transfer',day,clock,body,occurrences[(clock,body)]),'playerUuid':names.get(name.lower()),
                'name':name,'day':day,'occurredAt':stamp(at),'source':'admin_transfer','material':'minecraft:'+material.lower(),
                'deposited':amount,'withdrawn':0,'net':amount,'transactions':1})
    return commissions, donations


def read_logs(server, first, last, definitions, names, max_files=200, max_bytes=64*1024*1024):
    paths = []
    for p in (server/'logs').iterdir():
        m = re.fullmatch(r'(\d{4}-\d{2}-\d{2})-\d+\.log\.gz', p.name)
        if m and first <= m[1] <= last: paths.append((m[1],p))
        elif p.name == 'latest.log':
            day = datetime.fromtimestamp(p.stat().st_mtime, ZONE).date().isoformat()
            if first <= day <= last: paths.append((day,p))
    paths.sort(key=lambda r:(r[0], 10**9 if r[1].name=='latest.log' else int(r[1].name.split('-')[-1].split('.')[0])),reverse=True)
    requested_by_day=Counter(d for d,_ in paths)
    requested_files=len(paths)
    complete = len(paths) <= max_files; paths = paths[:max_files]
    rows, donations, scanned, total, errors = [], [], [], 0, []
    for day, p in paths:
        try:
            opener = gzip.open if p.suffix == '.gz' else open
            with opener(p,'rb') as f: raw = f.read(min(16*1024*1024, max_bytes-total)+1)
            if len(raw) > min(16*1024*1024,max_bytes-total):
                complete=False; errors.append('byte_budget:'+p.name); break
            total += len(raw)
            # A live writer's unfinished line is not a receipt yet.
            if raw and not raw.endswith(b'\n'): raw=raw[:raw.rfind(b'\n')+1]
            a,b=log_events(raw.decode('utf8',errors='replace').splitlines(),day,definitions,names)
            rows.extend(a); donations.extend(b); scanned.append((day,p.name))
        except (OSError, EOFError): complete=False;errors.append('unreadable:'+p.name)
    read_by_day=Counter(d for d,_ in scanned)
    all_days=[(date.fromisoformat(first)+timedelta(days=i)).isoformat()
              for i in range((date.fromisoformat(last)-date.fromisoformat(first)).days+1)]
    return rows, donations, {'available':bool(scanned),'complete':complete and bool(scanned),
        'reason':None if complete and scanned else 'logs_missing_or_budget','filesRead':len(scanned),
        'bytesRead':total,'errors':errors[:10],'from':first,'through':last,
        'requestedFiles':requested_files,'unreadFiles':requested_files-len(scanned),
        'daysRead':sorted(read_by_day),'completeDays':sorted(d for d,n in requested_by_day.items() if read_by_day[d]==n),
        'partialDays':sorted(d for d,n in requested_by_day.items() if 0<read_by_day[d]<n),
        'unreadDays':sorted(d for d in requested_by_day if not read_by_day[d]),
        'missingDays':[d for d in all_days if d not in requested_by_day],
        'dayFiles':[{'day':d,'requested':requested_by_day[d],'read':read_by_day[d]} for d in sorted(requested_by_day)],
        'selection':'newest_files_first_whole_files; stop_at_byte_budget',
        'completenessBasis':'existing local log files only; absent or previously deleted history remains unknown'}


def merge_history(config, rows, definitions, first, last):
    """Join a saved run to its final log, rather than count two completions."""
    result = {r['id']:dict(r) for r in rows}
    deliveries = []
    for player, assessment in config.get('task-market',{}).get('assessments',{}).items():
        if not identity(player) or not isinstance(assessment,dict): continue
        for history in assessment.get('history',[]):
            if not isinstance(history,dict): continue
            at=from_ms(history.get('at')); task=history.get('task'); run=history.get('run')
            status=history.get('outcome'); steps=history.get('steps',[])
            if not at or not first<=at.date().isoformat()<=last or status not in ('completed','abandoned') or not isinstance(task,str) or not ID.fullmatch(task) or not run: continue
            matches=[r for r in result.values() if r['playerUuid']==player and r['taskId']==task and r['status']==status and abs((datetime.fromisoformat(r['occurredAt'].replace('Z','+00:00'))-at).total_seconds())<=2]
            if matches:
                if len(matches)==1:
                    matches[0].update(task_info(task,definitions,steps)); matches[0]['source']='server_log_and_saved_run'
            else:
                event={'id':key('market',player,run,status),'playerUuid':player,'system':'guild','taskId':task,
                    **task_info(task,definitions,steps),'status':status,'occurredAt':stamp(at),'day':at.date().isoformat(),'source':'saved_market_run'}
                result[event['id']]=event
            for step in steps:
                if not isinstance(step,dict) or step.get('goal')!='donate': continue
                amount=step.get('target'); material=step.get('site')
                if type(amount) is not int or amount<=0 or not isinstance(material,str) or not re.fullmatch('[A-Z0-9_]+',material):continue
                deliveries.append({'id':key('delivery',player,run,step.get('step')),'playerUuid':player,'name':None,
                    'day':at.date().isoformat(),'occurredAt':None,'source':'commission_delivery','material':'minecraft:'+material.lower(),
                    'deposited':amount,'withdrawn':0,'net':amount,'transactions':1,
                    'timeBasis':'run_end_day; exact stage delivery time unavailable'})
    return list(result.values()), deliveries


def public_boxes(config, extra):
    hall=config.get('guild-hall',{})
    if not hall.get('services-built') or not all(type(hall.get(a)) is int for a in ('x','y','z')):return []
    x,y,z=(hall[a] for a in ('x','y','z'))
    # Standard hall doubles are built on the X axis. Extra origins are explicit;
    # no guessed neighboring private box is included for an extra double.
    points={(x+16+i,y+1,z+7+c*2) for c in range(4) for i in (0,1)}
    for category_name in ('weapons','armor','supplies','misc'):
        for p in extra.get('extras',{}).get(category_name,[]):
            if isinstance(p,list) and len(p)==3 and all(type(a) is int for a in p) and abs(p[0]-(x+16))<=24 and abs(p[2]-(z+10))<=24 and y<=p[1]<=y+16: points.add(tuple(p))
    return sorted(points)


def read_storage(db_path, boxes, first, now, seconds=2, row_limit=10000):
    if not boxes: return [], {'available':False,'complete':False,'reason':'public_boxes_unavailable'}
    started=time.monotonic(); conn=None
    try:
        conn=sqlite3.connect(db_path.resolve().as_uri()+'?mode=ro',uri=True,timeout=.2)
        conn.row_factory=sqlite3.Row
        conn.set_progress_handler(lambda: 1 if time.monotonic()-started>seconds else 0,1000)
        conn.execute('PRAGMA query_only=ON')
        world=conn.execute('SELECT id FROM co_world WHERE world=?',('world',)).fetchone()
        if not world: raise ValueError('public_world_unavailable')
        rows=[]; before=int(datetime.fromisoformat(first+'T00:00:00+08:00').timestamp())
        for x,y,z in boxes:
            sql='''SELECT c.rowid AS id,c.time,u.uuid,u.user AS name,m.material,c.amount,c.action
                FROM co_container c JOIN co_user u ON c.user=u.id JOIN co_material_map m ON c.type=m.id
                WHERE c.wid=? AND c.x=? AND c.y=? AND c.z=? AND c.time>=? AND c.time<=?
                  AND c.rolled_back=0 AND c.action IN (0,1) AND c.amount>0 ORDER BY c.time,c.rowid LIMIT ?'''
            rows.extend(conn.execute(sql,(world[0],x,y,z,before,int(now.timestamp()),row_limit+1-len(rows))).fetchall())
            if len(rows)>row_limit:break
        complete=len(rows)<=row_limit; rows=rows[:row_limit]
        result=[]
        for r in rows:
            player=identity(r['uuid']); name=r['name']
            if not player or not isinstance(name,str) or not NAME.fullmatch(name) or name.startswith('#'):continue
            at=datetime.fromtimestamp(r['time'],ZONE); amount=r['amount']; added=amount if r['action']==1 else 0; removed=amount if r['action']==0 else 0
            material=str(r['material']).lower();material=material if ':' in material else 'minecraft:'+material
            result.append({'id':key('coreprotect',r['id']),'playerUuid':player,'name':name,'day':at.date().isoformat(),
                'occurredAt':stamp(at),'source':'public_chest','material':material,'deposited':added,'withdrawn':removed,'net':added-removed,'transactions':1})
        return result,{'available':True,'complete':complete,'reason':None if complete else 'row_budget',
            'boxes':len(boxes),'rowsRead':len(rows),'from':first,'readMs':round((time.monotonic()-started)*1000)}
    except (sqlite3.Error,OSError,ValueError):return [],{'available':False,'complete':False,'reason':'storage_read_unavailable_or_timeout'}
    finally:
        if conn:conn.close()


def collect(server, static, days=30, now=None):
    now=now or datetime.now(ZONE); last=now.astimezone(ZONE).date().isoformat(); first=(now.astimezone(ZONE).date()-timedelta(days=days-1)).isoformat()
    out={'schemaVersion':1,'serverId':'qiandengji','observedAt':stamp(now),'available':False,
         'window':{'from':first,'through':last,'timezone':'Asia/Shanghai','days':days},'coverage':{},
         'categories':[{'id':k,'label':v} for k,v in CATEGORIES.items()], 'players':[],'commissions':[],'donations':[],'active':[],
         'notices':['这是当前保留记录的观察窗口，不是全历史完整账本。',
                    '公共箱存取不是无条件等同捐赠；各来源分别统计，物品件数不等于经济价值。',
                    '接单、交付和放弃的历史覆盖不同，不直接相除称完成率。',
                    '任务交付仅收录已保存市场阶段；普通供货交付与其他公共箱可能未被该源完整记录。']}
    folder=server/'plugins/AgentFriend'
    try: config,saved=stable_yaml(folder/'config.yml')
    except (OSError,ValueError,yaml.YAMLError):
        out['coverage']['config']={'available':False,'complete':False,'reason':'saved_state_unavailable'};return out
    out['available']=True;out['gameSavedAt']=saved
    out['coverage']['config']={'available':True,'complete':True,'reason':None,'savedAt':saved}
    definitions,errors=catalogue(server,static)
    for row in config.get('dynamic-board',{}).get('today',{}).get('cards',[]):
        if isinstance(row,dict) and isinstance(row.get('id'),str):
            primary,tags=category([row.get('goal')]);definitions[row['id']]={'title':str(row.get('title',row['id']))[:160],'category':primary,'tags':tags}
    out['coverage']['catalogue']={'available':True,'complete':not errors,'reason':'definition_unavailable' if errors else None,'files':errors}
    try:cache=json.loads((server/'usercache.json').read_text(encoding='utf8'))
    except (ValueError,OSError):cache=[]
    names={identity(r.get('uuid')):r['name'] for r in cache if isinstance(r,dict) and identity(r.get('uuid')) and isinstance(r.get('name'),str) and NAME.fullmatch(r['name'])}
    by_name={name.lower():player for player,name in names.items()}
    guild=config.get('guild-players',{}); life=config.get('life-guild',{})
    for player in sorted(set(guild)|set(life)):
        if not identity(player):continue
        total=guild.get(player,{}).get('completed')
        out['players'].append({'playerUuid':player,'name':names.get(player),'cumulativeGuildCompleted':total if type(total) is int and total>=0 else None})
        for system,source in [('guild',guild),('life',life)]:
            active=source.get(player,{}).get('active')
            if not isinstance(active,dict) or not isinstance(active.get('id'),str):continue
            task=active['id']; accepted=from_ms(active.get('accepted'))
            out['active'].append({'playerUuid':player,'system':system,'taskId':task,**task_info(task,definitions), 'acceptedAt':stamp(accepted) if accepted else None})
    try:rows,donations,cov=read_logs(server,first,last,definitions,by_name)
    except OSError:rows,donations,cov=[],[],{'available':False,'complete':False,'reason':'logs_unavailable'}
    out['coverage']['logs']=cov
    rows,delivered=merge_history(config,rows,definitions,first,last)
    out['coverage']['commissions']={'available':True,'complete':len(rows)<=5000 and cov['complete'],
        'reason':None if len(rows)<=5000 and cov['complete'] else 'partial_source_or_row_budget',
        'historyLimitPerPlayer':50,'classification':'frozen_verified_steps_then_current_catalogue'}
    rows.sort(key=lambda r:(r['occurredAt'],r['id']),reverse=True);out['commissions']=rows[:5000]
    try:extras,_=stable_yaml(folder/'guild-shared-chests.yml',65536)
    except (OSError,ValueError,yaml.YAMLError):extras={};out['notices'].append('扩容共享箱定义不可用，仅核对原共享箱。')
    storage,cov=read_storage(server/'plugins/CoreProtect/database.db',public_boxes(config,extras),first,now)
    out['coverage']['publicStorage']=cov
    all_donations={r['id']:r for r in donations+delivered+storage}
    out['donations']=sorted(all_donations.values(),key=lambda r:(r['day'],r['occurredAt'] or '',r['id']),reverse=True)[:10000]
    out['coverage']['donations']={'available':cov['available'] or bool(donations+delivered),
        'complete':len(all_donations)<=10000 and cov['complete'] and out['coverage']['logs']['complete'],
        'reason':'coverage_limited_to_recorded_sources','unrecorded':'unlogged legacy deliveries, other boxes, early stages of still-active runs'}
    return out


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--server',type=Path,required=True);p.add_argument('--out',type=Path,required=True)
    p.add_argument('--catalogue',type=Path,default=Path(__file__).with_name('world-activity-catalogue.json'))
    p.add_argument('--days',type=int,default=30,choices=range(1,31));args=p.parse_args()
    outpath=args.out.resolve();server=args.server.resolve()
    if outpath.is_relative_to(server):p.error('output must be outside the game server directory')
    static=json.loads(args.catalogue.read_text(encoding='utf8'))['tasks']
    result=collect(server,static,args.days)
    args.out.parent.mkdir(parents=True,exist_ok=True);temp=args.out.with_name(args.out.name+'.'+str(os.getpid())+'.tmp')
    try:
        with temp.open('x',encoding='utf8',newline='\n') as f:
            json.dump(result,f,ensure_ascii=False,separators=(',',':'),allow_nan=False);f.flush();os.fsync(f.fileno())
        temp.replace(args.out)
    finally:
        if temp.exists():temp.unlink()
    print(json.dumps({'available':result['available'],'observedAt':result['observedAt'],'commissions':len(result['commissions']),
                      'donations':len(result['donations']),'active':len(result['active']),'coverage':result['coverage']},ensure_ascii=False))

if __name__=='__main__':main()
