"""Actual profile/book regression checks against an owned, already running synthetic Youer fixture.

Requires RecruitmentProbe and both candidate JARs. Refuses unmarked/live servers.
No player spawning, role deletion, receipt deletion, OP grant or automatic unknown replay.
"""
import argparse, importlib.util, json, uuid
from pathlib import Path

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--stage',type=Path,required=True);args=parser.parse_args()
    stage=args.stage.resolve()
    if (stage/'.resident-hybrid-qa').read_text()!='SYNTHETIC_RESIDENT_HYBRID_ONLY':raise ValueError('synthetic marker required')
    props=dict(line.split('=',1)for line in (stage/'server.properties').read_text().splitlines()if'='in line)
    if props['server-ip']!='127.0.0.1' or props['rcon.port']=='25575':raise ValueError('isolated loopback server required')
    spec=importlib.util.spec_from_file_location('stock',Path(__file__).with_name('stock-stage.py'));stock=importlib.util.module_from_spec(spec);spec.loader.exec_module(stock)
    def command(text):return stock.rcon(int(props['rcon.port']),props['rcon.password'],text)
    def read(text):
        raw=command('maidagent '+text)
        if not raw.startswith('MC_RESIDENT '):raise AssertionError(raw)
        return json.loads(raw.removeprefix('MC_RESIDENT '))
    row=read('resident-admin list')['residents'][0];id=row['id'];profile=row['profile'];changed=dict(profile,name='管理验收居民',mapVisible=False)
    request=str(uuid.uuid4());line='resident-admin apply '+id+' '+request+' '+str(row['revision'])+' '+json.dumps(changed,ensure_ascii=False)
    reply=read(line);assert reply['status']=='applied'
    assert read(line)['revision']==row['revision']+1
    assert all(n['uuid']!=id for n in read('resident-map')['npcs'])
    assert read('resident-admin receipt '+id+' '+request)['status']=='applied'
    restored=read('resident-admin apply '+id+' '+str(uuid.uuid4())+' '+str(row['revision']+1)+' '+json.dumps(profile,ensure_ascii=False));assert restored['status']=='applied'
    assert json.loads(command('companiontest book-fixture '+id))['blankBook']
    request=str(uuid.uuid4());action={'action':'cli','command':'archive create 原生验收书|这是隔离验收中写进本人背包的一本真实书籍。'}
    line='resident '+id+' act '+request+' '+json.dumps(action,ensure_ascii=False)
    assert read(line)['status']=='accepted'
    result=stock.until(lambda:(r if (r:=read('resident '+id+' receipt '+request))['status']!='accepted' else None),60)
    assert result['status']=='completed'
    inventory=json.loads(command('companiontest inventory '+id))
    assert any(i['id']=='minecraft:written_book'for i in inventory['items'])
    assert read(line)['status']=='completed'and json.loads(command('companiontest inventory '+id))==inventory
    assert 'request_id_conflict'in command('maidagent resident '+id+' act '+request+' '+json.dumps({'action':'cli','command':'archive status'}))
    print(json.dumps({'passed':True,'checks':['native_profile','duplicate_revision','map_privacy','original_receipt','restore_profile','real_book','duplicate_book','request_conflict'],'productionChanged':False}))

if __name__=='__main__':main()
