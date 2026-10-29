"""Freeze a minimal release and both rollback copies; never stops or changes services."""
from pathlib import Path
import hashlib,json,shutil,yaml
ROOT=Path(__file__).resolve().parents[3]
REPAIR=Path('E:/MC/ops/repairs/aincrad-protection-20261027')
PROD=Path('E:/MC/server')
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def main():
    dst=REPAIR/'candidate';assert not dst.exists();dst.mkdir()
    rollback=REPAIR/'rollback';rollback.mkdir()
    files=[]
    def add(target,body):
        f=dst/target;f.parent.mkdir(parents=True,exist_ok=True);f.write_bytes(body)
        live=PROD/('plugins/'+target if target.endswith('.jar') else target)
        row={'target':target,'source':str(f),'sha256':sha(f)}
        if live.exists():
            row['beforeSha256']=sha(live);back=rollback/target;back.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(live,back)
        files.append(row)
    def data(p):return yaml.safe_load(p.read_text(encoding='utf8'))
    def dump(d):return yaml.safe_dump(d,allow_unicode=True,sort_keys=False).encode('utf8')
    add('AgentFriend-0.4.47.17.jar',(REPAIR/'build/AgentFriend-0.4.47.17.jar').read_bytes())
    policy=data(PROD/'plugins/AgentFriend/block-access.yml')
    assert len(policy['villages'])==8 and not any(r['world']=='aincrad' for r in policy['villages'])
    policy['villages'].append(dict(world='aincrad',**{'min-x':-29999984,'min-z':-29999984,'max-x':29999984,'max-z':29999984}))
    add('plugins/AgentFriend/block-access.yml',dump(policy))
    base=ROOT/'paper/config-candidates/aincrad-protection'
    region=data(PROD/'plugins/WorldGuard/worlds/aincrad/regions.yml')
    assert set(region['regions'])=={'qd_block_access_outside_0','qd_block_access_editors'}
    region['regions'].pop('qd_block_access_outside_0')
    region['regions'].update(data(base/'regions.yml')['regions'])
    add('plugins/WorldGuard/worlds/aincrad/regions.yml',dump(region))
    wg=data(PROD/'plugins/WorldGuard/worlds/aincrad/config.yml');wg.setdefault('regions',{}).update(data(base/'config.yml')['regions'])
    add('plugins/WorldGuard/worlds/aincrad/config.yml',dump(wg))
    add('plugins/Denizen/scripts/qd_aincrad.dsc',(base/'qd_aincrad.dsc').read_bytes())
    guide=data(PROD/'plugins/AgentFriend/agent-guide.yml')
    guide['rules'][2:2] = [
      '艾恩葛朗特是独立探索世界，不用徒步赶路。/aincrad 看往返说明；已学 travel 且有6魔力后 /warp aincrad 到起始之城，/warp village 回主村庄。禁止拆建、爆破和倒液体；可开门、开箱、战斗。',
      '远程个人箱：先 /mycli skills info travel，未学用 /mycli skills learn travel（1技能点）；有2魔力后 /mycli arena stash 打开，stash pages选页。无需先传送。成功开页耗2魔力；arena rewards list查待入箱，stash list查箱格，等窗口槽位确认再存取。'
    ]
    add('plugins/AgentFriend/agent-guide.yml',dump(guide))
    old=PROD/'plugins/AgentFriend-0.4.47.16.jar';assert sha(old)=='c24f822a4c034bb5c780790674c1bb1b622deec19bc7553d44fcbaa14427f0bb'
    shutil.copy2(old,rollback/old.name)
    plan=dict(schema=1,id='aincrad-protection-20261027',version='0.4.47.17',files=files,removeJars=[{'name':old.name,'sha256':sha(old)}],releaseNotes=['艾恩葛朗特全图建筑保护已生效，普通探索、开门、开箱和战斗保留。','快速进入：/warp aincrad；回主村庄：/warp village；条件与往返说明：/aincrad。','远程个人箱：学习 travel 后 /mycli arena stash；成功开页耗2魔力。'])
    (REPAIR/'plan.json').write_text(json.dumps(plan,ensure_ascii=False,indent=2),encoding='utf8')
    mirror=Path('F:/MC/ops/repairs/aincrad-protection-20261027');mirror.mkdir(parents=True,exist_ok=True)
    for name in ('candidate','rollback'):
        shutil.copytree(REPAIR/name,mirror/name)
        for f in (REPAIR/name).rglob('*'):
            if f.is_file():assert sha(f)==sha(mirror/name/f.relative_to(REPAIR/name))
    shutil.copy2(REPAIR/'plan.json',mirror/'plan.json')
    print(json.dumps({'files':len(files),'rollbackFiles':len(list(rollback.rglob('*.*'))),'mirrored':True,'installed':False}))
if __name__=='__main__':main()
