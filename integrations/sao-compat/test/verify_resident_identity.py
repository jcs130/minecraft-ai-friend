"""Read-only live regression: --fixture a private loopback QA credential JSON.

Requires a pre-created native body. Creates no body, lease, model run or game action.
The fixture supplies endpoint/token/otherToken/bodyId/ordinaryPlayerUuid; never commit it.
"""
import argparse,json,urllib.error,urllib.parse,urllib.request,uuid
from pathlib import Path

def verify(fixture):
    endpoint=urllib.parse.urlparse(fixture['endpoint'])
    if endpoint.scheme!='http' or endpoint.hostname!='127.0.0.1' or endpoint.path!='/mcp':
        raise ValueError('explicit_loopback_mcp_fixture_required')
    body=str(uuid.UUID(fixture['bodyId']));ordinary=str(uuid.UUID(fixture['ordinaryPlayerUuid']));checks=[]
    def call(name,args,token=None):
        request=urllib.request.Request(fixture['endpoint'],json.dumps({'jsonrpc':'2.0','id':str(uuid.uuid4()),'method':'tools/call','params':{'name':name,'arguments':args}}).encode(),headers={'Content-Type':'application/json','Authorization':'Bearer '+(token or fixture['token'])})
        with urllib.request.urlopen(request,timeout=15)as response:raw=json.load(response)
        assert 'error'not in raw,'valid read rejected';return raw['result']['structuredContent']
    state=call('get_state',{'companion':body});assert state['online'];checks.append('existing native body online')
    read=call('mod_query',{'companion':body,'operation':'sao.recipes','arguments':{'outputId':'farmersdelight:canvas','limit':1}})
    assert read['ok'] and read['bodyId']==body and read['data']['recipes'][0]['definitionAvailable'];checks.append('owned body reads actual native recipe')
    denied=call('mod_query',{'companion':body,'operation':'sao.recipes','arguments':{}},fixture['otherToken'])
    assert denied['ok']is False and 'body_not_owned'in json.dumps(denied);checks.append('foreign owner denied')
    denied=call('mod_query',{'companion':ordinary,'operation':'sao.recipes','arguments':{}})
    assert denied['ok']is False;checks.append('ordinary player cannot be selected as a resident')
    try:call('mod_operations',{},'invalid-qa-token');raise AssertionError('invalid token accepted')
    except urllib.error.HTTPError as error:assert error.code==401
    checks.append('invalid token remains unauthorized')
    return {'passed':True,'checks':checks,'readOnly':True,'gameActions':0}

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--fixture',type=Path,required=True);args=p.parse_args()
    print(json.dumps(verify(json.loads(args.fixture.read_text(encoding='utf-8-sig'))),ensure_ascii=False))
