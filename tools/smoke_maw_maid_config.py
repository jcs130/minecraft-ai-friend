"""Real TLM configuration checks inside the existing full-pack isolated Numen harness."""
from __future__ import annotations
import hashlib
import json
import struct
import time
import uuid


def checks(request, console, owner, bridge, server, lines, result=None, body=None):
    result = {} if result is None else result
    def ui(action, arguments=None):
        status, value = request('/ui', {'ownerUuid': owner, 'playerName': 'MawHeadQAOwner', 'action': action, 'arguments': arguments or {}}, {'X-Maw-Bridge': bridge})
        assert status in (200, 400), (status, value)
        return value
    def ints(value):
        return '[I;'+','.join(map(str,struct.unpack('>4i',uuid.UUID(value).bytes)))+']'
    def wait(predicate):
        deadline=time.monotonic()+10
        while time.monotonic()<deadline:
            value=predicate()
            if value:return value
            time.sleep(.1)
        raise TimeoutError('native maid configuration fixture not ready')
    def client(kind, **arguments):
        command = {'id':str(uuid.uuid4()), 'kind':kind, **arguments}
        folder=server.parent;temp=folder/'owner-command.part'
        temp.write_text(json.dumps(command),encoding='utf-8');temp.replace(folder/'owner-command.json')
        value=wait(lambda: (v if v.get('id')==command['id'] else None) if (p:=folder/'owner-result.json').exists() and (v:=json.loads(p.read_text('utf-8'))) else None)
        assert value['ok'],value
        return value
    sites_path=server/'config/touhou_little_maid/sites/llm.json'
    before=hashlib.sha256(sites_path.read_bytes()).hexdigest()
    menu=ui('maid.menu')
    result['maid_ordinary_menu_no_secrets']=menu['ok'] and not menu['canEditSites'] and all('url' not in s and 'keyConfigured' not in s and 'secretKey' not in s for s in menu['sites'])
    args={'siteId':'maw_qa','revision':'new','url':'http://127.0.0.1:28991/v1/chat/completions','models':['qa-native','qa-other'],'apiKey':'qa-maid-secret-not-real','enabled':True,'hasThinkingField':False}
    denied=ui('maid.site.save',args)
    result['maid_global_write_native_op_only']=denied.get('code')=='maid_site_requires_operator' and hashlib.sha256(sites_path.read_bytes()).hexdigest()==before
    console('op MawHeadQAOwner');wait(lambda: ui('maid.menu').get('canEditSites'))
    saved=ui('maid.site.save',args);assert saved.get('ok'),saved
    result['maid_native_site_redacted']=saved['site']['keyConfigured'] and 'qa-maid-secret-not-real' not in json.dumps(saved)
    raw=json.loads(sites_path.read_text('utf-8'));native=raw['maw_qa']
    result['maid_native_codec_disk_fields']=native['secret_key']=='qa-maid-secret-not-real' and set(native['models'])=={'qa-native','qa-other'}
    assert result['maid_native_codec_disk_fields']
    args['revision']=saved['site']['revision'];args['apiKey']='';saved=ui('maid.site.save',args)
    result['maid_blank_key_preserves_native_key']=saved['ok'] and json.loads(sites_path.read_text('utf-8'))['maw_qa']['secret_key']=='qa-maid-secret-not-real'
    stale={**args,'models':['bad-stale']};stale['revision']='0'*64
    result['maid_stale_config_refused']=ui('maid.site.save',stale).get('code')=='maid_site_changed_refresh'
    invalid={**args,'revision':saved['site']['revision'],'url':'http://192.168.3.163:1234/chat/completions'}
    result['maid_unapproved_endpoint_refused']=ui('maid.site.save',invalid).get('code')=='model_endpoint_requires_allowed_https_host'
    maid=str(uuid.uuid4());foreign=str(uuid.uuid4())
    console('execute at MawHeadQAOwner run summon touhou_little_maid:maid ~1 ~ ~ {UUID:'+ints(maid)+',Owner:'+ints(owner)+',NoAI:1b,Invulnerable:1b,CustomName:\'{"text":"MaidConfigQA"}\',MaidAIChat:{TTSSiteName:"__none__",CustomSetting:"original persona"}}')
    console('execute at MawHeadQAOwner run summon touhou_little_maid:maid ~2 ~ ~ {UUID:'+ints(foreign)+',Owner:'+ints(str(uuid.uuid4()))+',NoAI:1b,Invulnerable:1b}')
    menu=wait(lambda: (m if any(x['maidUuid']==maid for x in m.get('maids',[])) else None) if (m:=ui('maid.menu')) else None)
    state=next(x for x in menu['maids'] if x['maidUuid']==maid)
    result['maid_native_owner_nearby_list']=all(x['maidUuid']!=foreign for x in menu['maids'])
    console('deop MawHeadQAOwner');wait(lambda: not ui('maid.menu').get('canEditSites'))
    config={'maidUuid':maid,'revision':state['revision'],'siteId':'maw_qa','model':'qa-other','customSetting':'温柔的探险伙伴','language':'zh_cn'}
    edited=ui('maid.settings',config);assert edited.get('ok'),edited
    state=edited['maid'];result['maid_native_persona_and_model']=state['effectiveSiteId']=='maw_qa' and state['effectiveModel']=='qa-other' and state['customSetting']=='温柔的探险伙伴' and state['language']=='zh_cn'
    result['maid_stale_persona_refused']=ui('maid.settings',config).get('code')=='maid_settings_changed_refresh'
    result['maid_foreign_ownership_refused']=ui('maid.detail',{'maidUuid':foreign}).get('code')=='maid_not_owned_nearby_alive'
    bad={**config,'revision':state['revision'],'model':'not-a-model'}
    result['maid_unconfigured_model_refused']=ui('maid.settings',bad).get('code')=='maid_model_not_in_site'
    tasks=ui('maid.tasks',{'maidUuid':maid})
    selected=next(t for t in tasks['tasks'] if t['enabled'] and t['id']!=tasks['maid']['taskId'])
    controls={'maidUuid':maid,'controlRevision':tasks['maid']['controlRevision'],'taskId':selected['id'],'follow':False,'pickup':False}
    changed=ui('maid.controls',controls);assert changed.get('ok'),changed
    result['maid_controls_real_native_state']=changed['maid']['taskId']==selected['id'] and not changed['maid']['follow'] and not changed['maid']['pickup']
    result['maid_controls_preserve_model_and_persona']=changed['maid']['customSetting']=='温柔的探险伙伴' and changed['maid']['effectiveModel']=='qa-other'
    result['maid_controls_stale_refused']=ui('maid.controls',controls).get('code')=='maid_controls_changed_refresh'
    result['maid_controls_foreign_refused']=ui('maid.controls',{**controls,'maidUuid':foreign}).get('code')=='maid_not_owned_nearby_alive'
    # Real network interaction: ordinary Java opens the original container;
    # only an authenticated, online Bedrock binding replaces it with a private event.
    client('unequip') # Full-pack first login grants a soul slab in slot zero; it consumes maid interactions.
    original=client('interact',targetUuid=maid)
    result['java_native_container_not_intercepted']=original['nativeScreensAfter']>original['nativeScreensBefore']
    client('close')
    session=str(uuid.uuid4());session_args={'sessionId':session}
    result['bedrock_poll_requires_registered_session']=ui('bedrock.poll',session_args).get('code')=='bedrock_menu_session_expired'
    result['bedrock_bind_actual_online_owner']=ui('bedrock.bind',session_args).get('visualMenus') is True
    click=client('interact',targetUuid=maid)
    event=wait(lambda: ui('bedrock.poll',session_args).get('event'))
    result['bedrock_click_opens_owner_private_maid_menu']=event['kind']=='maid' and event['targetUuid']==maid and event['ownerUuid']==owner and click['windowsAfter']==click['windowsBefore'] and click['nativeScreensAfter']==click['nativeScreensBefore']
    again=ui('bedrock.poll',session_args)['event']
    result['bedrock_event_retained_until_explicit_ack']=again==event
    result['bedrock_wrong_session_refused']=ui('bedrock.poll',{'sessionId':str(uuid.uuid4())}).get('code')=='bedrock_menu_session_expired'
    ack=ui('bedrock.poll',{**session_args,'ackEventId':event['eventId']})
    result['bedrock_event_ack_removes_only_own_event']=ack['event'] is None
    time.sleep(.8)
    client('interact_at',targetUuid=maid)
    precise=wait(lambda: ui('bedrock.poll',session_args).get('event'))
    result['bedrock_precise_interaction_private_menu']=precise['kind']=='maid' and precise['targetUuid']==maid and precise['eventId']!=event['eventId']
    ui('bedrock.poll',{**session_args,'ackEventId':precise['eventId']})
    client('interact',targetUuid=foreign)
    result['bedrock_foreign_maid_no_ui_event']=ui('bedrock.poll',session_args)['event'] is None
    if body:
        console('execute at MawHeadQAOwner run tp MawHeadBody ~2 ~ ~');time.sleep(.8)
        click=client('interact',targetUuid=body)
        event=wait(lambda: ui('bedrock.poll',session_args).get('event'))
        result['bedrock_own_numen_click_private_menu']=event['kind']=='companion' and event['targetUuid']==body and click['windowsAfter']==click['windowsBefore']
    replacement={'sessionId':str(uuid.uuid4())}
    assert ui('bedrock.bind',replacement)['ok']
    result['bedrock_rebind_invalidates_old_session_and_event']=ui('bedrock.poll',session_args).get('code')=='bedrock_menu_session_expired' and ui('bedrock.poll',replacement)['event'] is None
    assert ui('bedrock.unbind',replacement)['ok']
    restored=client('interact',targetUuid=maid)
    result['java_original_ui_restored_after_unbind']=restored['nativeScreensAfter']>restored['nativeScreensBefore']
    client('close')
    console('data get entity '+maid+' MaidAIChat');wait(lambda: any('LLMModel: "qa-other"' in line and 'TTSSiteName: "__none__"' in line for line in lines))
    result['maid_entity_native_nbt_and_tts_preserved']=True
    console('execute at MawHeadQAOwner run tp '+maid+' ~100 ~ ~');wait(lambda: all(x['maidUuid']!=maid for x in ui('maid.menu').get('maids',[])))
    result['maid_out_of_range_refused']=ui('maid.detail',{'maidUuid':maid}).get('code')=='maid_not_owned_nearby_alive'
    result['maid_key_never_in_server_log']=not any('qa-maid-secret-not-real' in line for line in lines)
    return result
