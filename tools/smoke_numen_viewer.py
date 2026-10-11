"""Real isolated body/viewer acceptance, invoked inside the Numen server smoke.

No model calls, no production world actions. The parent owns the Java server;
this helper owns and always stops its finite web child.
"""
from __future__ import annotations
import json
import hashlib
import os
from pathlib import Path
import subprocess
import time
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from society_lab import REPO

def run(root, output, node, body, bearer, other_token, native_request, tool, console, terminal, visual=False):
    checks={};report={'checks':checks,'paidModelRequests':0,'productionWorldActions':0,'ok':False}
    config=json.loads((root/'services/agent.json').read_text('utf-8'))
    config={k:config[k] for k in ('viewerHostModule','assetDirectory')}
    config.update(port=28992,upstreamPort=28990,registryDirectory=str(root/'gateway/permanent/registry'),readyFile=str(output/'viewer-ready.json'))
    cfg=output/'viewer-config.json';cfg.write_text(json.dumps(config),encoding='utf-8')
    env={**os.environ,'NODE_PATH':str(root/'gateway/permanent/node/node_modules')}
    log=(output/'viewer-host.log').open('w',encoding='utf-8')
    child=subprocess.Popen([str(node),str(REPO/'tools/smoke_numen_viewer_host.mjs'),str(cfg)],cwd=REPO,env=env,stdin=subprocess.PIPE,stdout=log,stderr=subprocess.STDOUT,text=True,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    def request(path,data=None,cookie=None):
        headers={'Content-Type':'application/json'}
        if cookie:headers['Cookie']=cookie
        req=Request('http://127.0.0.1:28992'+path,None if data is None else json.dumps(data).encode(),headers=headers)
        try:
            with urlopen(req,timeout=20) as r:return r.status,r.headers,r.read().decode('utf-8')
        except HTTPError as e:return e.code,e.headers,e.read().decode('utf-8')
    def status(cookie):return json.loads(request(f'/numen/view/{body}/status.json',cookie=cookie)[2])
    def until(check,timeout=20):
        deadline=time.monotonic()+timeout;last=None
        while time.monotonic()<deadline:
            last=check()
            if last:return last
            time.sleep(.2)
        raise AssertionError('viewer condition timed out')
    def observed(predicate,timeout=20):
        def sample():
            value=status(cookie)
            return value if predicate(value) else None
        return until(sample,timeout)
    cookie=None
    try:
        until(lambda:(output/'viewer-ready.json').exists(),30)
        checks['login_page']=request('/numen/view/')[0]==200 and '接入令牌' in request('/numen/view/')[2]
        checks['anonymous_body_denied']=request(f'/numen/view/{body}/status.json')[0]==401
        checks['bad_token_denied']=request('/numen/view/login',{'token':'0'*64})[0]==401
        s,h,_=request('/numen/view/login',{'token':bearer});cookie=h['Set-Cookie'].split(';')[0]
        checks['owner_cookie_http_only']=s==200 and 'HttpOnly' in h['Set-Cookie'] and 'SameSite=Strict' in h['Set-Cookie']
        checks['owner_list_private']=body in request('/numen/view/',cookie=cookie)[2] and bearer not in request('/numen/view/',cookie=cookie)[2]
        checks['cross_owner_native_view_denied']=native_request('/viewer',{'companion':body}, {'Authorization':'Bearer '+other_token})[1].get('code')=='body_not_owned'
        checks['no_arbitrary_world_columns']=native_request('/viewer',{'companion':body,'columns':[[999999,999999]]}, {'Authorization':'Bearer '+bearer})[1].get('code')=='viewer_column_outside_body'
        checks['column_budget_enforced']=native_request('/viewer',{'companion':body,'columns':[[0,0],[0,0],[0,0]]}, {'Authorization':'Bearer '+bearer})[1].get('code')=='viewer_column_budget'
        html=request(f'/numen/view/{body}/',cookie=cookie)[2]
        checks['scoped_latest_page']=f'<base href="/numen/view/{body}/">' in html and f'src="/numen/view/{body}/index.js"' in html
        current=observed(lambda v:v.get('identity',{}).get('playerUuid')==body and v.get('viewer',{}).get('loadedColumns',0)>=9)
        checks['actual_numen_first_person_body']=current['mode']=='numen_server_body' and current['readOnly'] and current['identity']['playerUuid']==body and current['selfPlayer']['uuid']==body
        checks['real_inventory_and_mana']=current['presentation']['inventory']['playerUuid']==body and len(current['presentation']['inventory']['slots'])==46 and current['presentation']['skills']['mana']['max']>0
        checks['native_packets_and_registry']=current['viewer']['entityDataAvailable'] and current['viewer']['packetCount']>5
        checks['served_build_fingerprinted']=len(current['build']['consoleBundleSha256'])==64 and current['build']['buildSource']['sourceFiles']>10
        report['initial']={k:current[k] for k in ('mode','identity','selfPlayer','build')}
        lease=tool('claim_control',{'companion':body,'controller_id':'qa-controller'})['lease']['leaseId']
        tool('set_permission',{'companion':body,'lease_id':lease,'mode':'bypass'})
        p=current['selfPlayer']['position'];old_id=current['identity']['entityId']
        code='local s=numen.status.self(); local p=numen.route.plan({to={x=math.floor(s.pos.x)+2,z=math.floor(s.pos.z)},costs={dig=false,place=false}}); if not p.ok then error(p.why) end; local m=numen.move.go(p); print(m.pos.x,m.pos.y,m.pos.z)'
        tool('lua',{'companion':body,'lease_id':lease,'action_id':'qa-viewer-walk','code':code});receipt=terminal('qa-viewer-walk')
        moved=observed(lambda v:abs((v.get('selfPlayer') or {}).get('position',{}).get('x',p['x'])-p['x'])>1)
        checks['actual_move_updates_camera']=receipt['ok'] and moved['identity']['playerUuid']==body
        console('damage MawHeadBody 4');time.sleep(.15)
        hurt=observed(lambda v:0<(v.get('presentation',{}).get('self') or {}).get('health',999)<(v.get('presentation',{}).get('self') or {}).get('maxHealth',0))
        checks['actual_damage_updates_hud']=hurt['presentation']['self']['health']<hurt['presentation']['self']['maxHealth']
        console('effect give MawHeadBody minecraft:instant_health 1 5 true')
        tool('mod_action',{'companion':body,'lease_id':lease,'action_id':'qa-viewer-curios','operation':'curios.open'});opened=terminal('qa-viewer-curios')
        menu=observed(lambda v:(v.get('presentation',{}).get('nativeMenu') or {}).get('menuType')=='curios:curios_container')['presentation']['nativeMenu']
        checks['actual_mod_menu_updates']=opened['ok'] and menu['playerUuid']==body and menu['windowId']>0
        checks['curios_native_paging_state']=menu.get('curios',{}).get('menuOpen') is True and menu['curios']['containerId']==menu['windowId']
        if visual:
            # Explicit visual fixture: choose a model this renderer actually
            # supports via YSM's ordinary-player CAS operation, never substitute
            # another body for an unsupported original model in the renderer.
            ysm=tool('mod_query',{'companion':body,'operation':'ysm.catalog','arguments':{'offset':0,'limit':24}})['state']
            current=ysm['current']
            choice=next(row for row in ysm['models'] if row['selectable'] and row['modelId']=='misc/2_steve')
            texture='tartaric_acid'
            selection={'modelId':choice['modelId'],'texture':texture,**{'expected'+k[0].upper()+k[1:]:current[k] for k in ('modelId','texture','enabled','mandatory')}}
            tool('mod_action',{'companion':body,'lease_id':lease,'action_id':'qa-viewer-ysm','operation':'ysm.select','arguments':selection})
            checks['visual_fixture_real_ysm_selection']=terminal('qa-viewer-ysm')['ok']
            # An explicitly labelled, loopback-only QA login. This known test
            # credential never enters the production account store.
            private=output/'server/config/maw-numen-private/accounts.json'
            accounts=json.loads(private.read_text('utf-8'));qa_hash=hashlib.sha256(('a'*64).encode()).hexdigest()
            accounts['accounts'].append({'ownerUuid':accounts['accounts'][0]['ownerUuid'],'tokenHash':qa_hash,'label':'temporary-loopback-browser-fixture'})
            private.write_text(json.dumps(accounts),encoding='utf-8')
            (output/'viewer-visual-ready.json').write_text(json.dumps({'bodyId':body,'url':'http://127.0.0.1:28992/numen/view/','qaFixture':'a repeated 64 times; isolated loopback server only'}),encoding='utf-8')
            deadline=time.monotonic()+240
            while time.monotonic()<deadline and not (output/'viewer-visual-done').exists():time.sleep(.5)
            accounts['accounts']=[a for a in accounts['accounts'] if a['tokenHash']!=qa_hash]
            private.write_text(json.dumps(accounts),encoding='utf-8')
            report['browserVisualReleased']=(output/'viewer-visual-done').exists()
        tool('mod_action',{'companion':body,'lease_id':lease,'action_id':'qa-viewer-close','operation':'menu.close','arguments':{'windowId':menu['windowId'],'expectedStateId':menu['stateId']}});checks['actual_mod_menu_closes']=terminal('qa-viewer-close')['ok']
        console('kill MawHeadBody')
        restored=observed(lambda v:v.get('selfPlayer') and v['identity']['entityId']!=old_id,25)
        checks['death_respawn_auto_follows_original_uuid']=restored['selfPlayer']['uuid']==body and restored['viewer']['epoch']>current['viewer']['epoch']
        checks['viewer_never_takes_controller']=tool('claim_control',{'companion':body,'controller_id':'different-controller'}).get('code')=='controller_busy'
        tool('set_permission',{'companion':body,'lease_id':lease,'mode':'ask'})
        checks['no_extra_camera_player']=json.loads(request('/numen/view/health')[2])['newMinecraftConnections']==0
        report['latest']=status(cookie)
        checks['logout_removes_body_view']=request('/numen/view/logout',{},cookie)[0]==200 and request(f'/numen/view/{body}/status.json',cookie=cookie)[0]==401
        report['ok']=all(checks.values())
    finally:
        if child.poll() is None:child.stdin.write('stop\n');child.stdin.flush();child.wait(timeout=20)
        log.close();report['webChildExitCode']=child.returncode;report['ok']=report['ok'] and child.returncode==0
        (output/'viewer-acceptance.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    return report
