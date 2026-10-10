"""Real TLM configuration checks inside the existing full-pack isolated Numen harness."""
from __future__ import annotations
import hashlib
import json
import struct
import time
import uuid


def checks(request, console, owner, bridge, server, lines, result=None):
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
    console('data get entity '+maid+' MaidAIChat');wait(lambda: any('LLMModel: "qa-other"' in line and 'TTSSiteName: "__none__"' in line for line in lines))
    result['maid_entity_native_nbt_and_tts_preserved']=True
    console('execute at MawHeadQAOwner run tp '+maid+' ~100 ~ ~');wait(lambda: all(x['maidUuid']!=maid for x in ui('maid.menu').get('maids',[])))
    result['maid_out_of_range_refused']=ui('maid.detail',{'maidUuid':maid}).get('code')=='maid_not_owned_nearby_alive'
    result['maid_key_never_in_server_log']=not any('qa-maid-secret-not-real' in line for line in lines)
    return result
