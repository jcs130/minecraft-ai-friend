"""Import selected identities/providers into a NEW isolated operations runtime.

No old sessions, tools, jobs or authentication are copied. Secret values are
handled only in memory and under the ignored target secret directory.
"""
import argparse
import base64
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import secrets
import subprocess
import sys
from cryptography.fernet import Fernet
from init_qwenpaw import write_private, isolated_url

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / 'server/operations-agent-state'
ROLES = {'mc-god', 'default', 'mc-herald', 'mc-priest', 'mc-guard-kirito', 'mc-guard-naruto'}
PERSONALITY = {
    'mc-god': '保留创世天神的庄重、克制和全局判断。你统筹运营优先级与验收，结论短而明确。',
    'default': '司灯：台账驱动，协调不代决，区分待办、风险、决议和待呈。原来源没有 SOUL.md，本文件是本次职责适配。',
    'mc-herald': '灯语：面向玩家体验，细查运行异常、反馈链和行为证据，避免把进程健康当作玩法通过。',
    'mc-priest': '祭司：重视世界观、剧情与活动设计；提案应说明所需现有地点、资源、预算和验收条件。',
    'mc-guard-kirito': '桐人：冷静、简洁，以攻略者眼光检查操作步骤、规则一致性和可复现的问题。',
    'mc-guard-naruto': '鸣人：热血、直白、重同伴，用大白话关注新手理解、协作、探索和失败后的恢复体验。',
}


def prepare():
    plan = json.loads((ROOT / 'config/operations-team-plan.json').read_text(encoding='utf8'))
    if TARGET.exists() and any(TARGET.iterdir()): raise ValueError('target_not_empty')
    assert {r['id'] for r in plan['roles']} == ROLES
    image = plan['target']['image']
    actual = subprocess.check_output(['docker','image','inspect',image,'--format','{{.Id}}'], text=True).strip()
    assert actual == plan['target']['imageId']
    master = secrets.token_hex(32)
    cipher = Fernet(base64.urlsafe_b64encode(bytes.fromhex(master)))
    selections = {r['providerId']: Path(r['sourceSecretRoot']) for r in plan['privateProviderMigration']['sourceSelections']}
    providers, profiles, provenance = {}, [], []
    for role in plan['roles']:
        source = Path(role['source']['agentConfig'])
        source_bytes = source.read_bytes()
        data = json.loads(source_bytes.decode('utf-8-sig'))
        active = role['modelSelection']
        if data.get('active_model') != active: raise ValueError('source_model_changed')
        pid, mid = active['provider_id'], active['model']
        secret = selections[pid]
        found = [(kind, secret/'providers'/kind/(pid+'.json')) for kind in ('builtin','custom')]
        found = [(kind,path) for kind,path in found if path.is_file()]
        if len(found) != 1: raise ValueError('ambiguous_provider')
        kind, path = found[0]
        provider = json.loads(path.read_text(encoding='utf-8-sig'))
        url, local = isolated_url(provider['base_url'])
        if local or provider.get('chat_model','OpenAIChatModel') != 'OpenAIChatModel': raise ValueError('unreviewed_provider_adapter')
        if (kind,pid) not in providers:
            key = provider.get('api_key','')
            if key.startswith('ENC:'):
                old = Fernet(base64.urlsafe_b64encode(bytes.fromhex((secret/'.master_key').read_text(encoding='ascii').strip())))
                key = old.decrypt(key[4:].encode()).decode()
            if not key: raise ValueError('provider_key_missing')
            providers[kind,pid] = {'id':pid,'name':provider.get('name') or pid,'base_url':url,
                'chat_model':'OpenAIChatModel','api_key':'ENC:'+cipher.encrypt(key.encode()).decode(),
                'is_custom':kind=='custom','is_local':False,'require_api_key':True,
                'support_model_discovery':False,'models':[],'extra_models':[],
                'generate_kwargs':{'max_tokens':2048}}
        providers[kind,pid]['extra_models'].append({'id':mid,'name':mid})
        profiles.append({'id':role['id'],'name':role['label'],'role':role['role'],
            'reportsTo':role['reportsTo'],'active_model':deepcopy(active),'provider_kind':kind})
        provenance.append({'id':role['id'],'sourceConfigSha256':hashlib.sha256(source_bytes).hexdigest(),
            'prompts':[{'name':name,'sha256':hashlib.sha256((source.parent/name).read_bytes()).hexdigest()}
                for name in ('AGENTS.md','PROFILE.md','SOUL.md') if (source.parent/name).is_file()]})
    # Validate/decrypt all input before creating the target. Never replace a live runtime.
    secret = TARGET/'secret'
    secret.mkdir(parents=True, exist_ok=False)
    (secret/'.master_key').write_text(master,encoding='ascii')
    for (kind,pid),value in providers.items(): write_private(secret/'providers'/kind/(pid+'.json'),value)
    manifest = {'project':'qiandengji-ops','profiles':profiles,'sourceProvenance':provenance,
        'sourcePromptPolicy':'reviewed adaptation; no old runtime instructions, skills, jobs or histories copied'}
    write_private(TARGET/'init-manifest.json',manifest)
    policy = (ROOT/'world/ops/operations-team-policy.md').read_text(encoding='utf8')
    for role in profiles:
        folder = TARGET/'work/workspaces'/role['id']; folder.mkdir(parents=True)
        (folder/'AGENTS.md').write_text(policy,encoding='utf8')
        (folder/'TEAM.md').write_text(policy,encoding='utf8')
        (folder/'SOUL.md').write_text(PERSONALITY[role['id']]+'\n',encoding='utf8')
        (folder/'PROFILE.md').write_text(f"# {role['name']}\n\n运行组：qiandengji-ops\n职责：{role['role']}\n汇报给：{role['reportsTo']}\n\n当前身份用于运营分析与提案，没有游戏身体控制权限。\n",encoding='utf8')
    command=['docker','run','--rm','--network','none','--entrypoint','python']
    for key,value in {'HOME':'/state/home','QWENPAW_WORKING_DIR':'/state/work','COPAW_WORKING_DIR':'/state/work',
                     'QWENPAW_SECRET_DIR':'/state/secret','COPAW_SECRET_DIR':'/state/secret',
                     'QWENPAW_DISABLE_KEYRING':'1','QWENPAW_KEYRING_ACCOUNT':'qiandengji-ops'}.items():
        command.extend(['-e',key+'='+value])
    command += ['-v',TARGET.as_posix()+':/state','-v',(ROOT/'world/ops').as_posix()+':/ops:ro',image,'/ops/init_operations_runtime.py']
    result=subprocess.run(command,capture_output=True,text=True,encoding='utf8',timeout=120)
    reports=[]
    for line in result.stdout.splitlines():
        try:
            value=json.loads(line)
            if value.get('project')=='qiandengji-ops': reports.append(value)
        except (ValueError,AttributeError): pass
    if result.returncode or not reports or not reports[-1].get('ok'): raise RuntimeError('image_roundtrip_failed')
    print(json.dumps(reports[-1],ensure_ascii=False))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute',choices=['qiandengji'],required=True)
    parser.parse_args()
    try: prepare()
    except Exception as exc:
        print(json.dumps({'ok':False,'project':'qiandengji-ops','errorType':type(exc).__name__,
            'error':'Import failed; private staging retained, no operations service started'}))
        sys.exit(1)
