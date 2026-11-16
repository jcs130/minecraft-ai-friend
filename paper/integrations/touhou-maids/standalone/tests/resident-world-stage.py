"""Verify native resident state against an owned, running synthetic Youer fixture.

Requires the test-only RecruitmentProbe. It never summons bodies, changes homes,
grants permissions or clears uncertain requests. A malformed action gets a new
receipt; no uncertain action is replayed.
"""
import argparse, importlib.util, json, uuid
from pathlib import Path

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stage',type=Path,required=True)
    parser.add_argument('--maid',required=True)
    parser.add_argument('--dimension',required=True)
    parser.add_argument('--unknown-travel')
    args=parser.parse_args();stage=args.stage.resolve();id=str(uuid.UUID(args.maid))
    if(stage/'.resident-hybrid-qa').read_text()!='SYNTHETIC_RESIDENT_HYBRID_ONLY':raise ValueError('synthetic marker required')
    props=dict(x.split('=',1)for x in(stage/'server.properties').read_text().splitlines()if'='in x)
    if props['server-ip']!='127.0.0.1'or props['rcon.port']=='25575':raise ValueError('isolated loopback server required')
    spec=importlib.util.spec_from_file_location('stock',Path(__file__).with_name('stock-stage.py'));stock=importlib.util.module_from_spec(spec);spec.loader.exec_module(stock)
    def command(line):return stock.rcon(int(props['rcon.port']),props['rcon.password'],line)
    def resident(line):
        raw=command('maidagent resident '+id+' '+line)
        if not raw.startswith('MC_RESIDENT '):raise AssertionError(raw)
        return json.loads(raw.removeprefix('MC_RESIDENT '))
    checks=[]
    def check(name,value):
        if not value:raise AssertionError(name)
        checks.append(name)
    observed=resident('status');native=json.loads(command('companiontest body '+id))
    check('original_body_in_requested_dimension',observed['maidId']==native['uuid']==id and observed['dimension']==native['dimension']==args.dimension)
    check('resident_has_no_player_slot',observed['usesPlayerSlot']is False)
    check('home_is_separate_from_current_position',set(observed['position'])=={'x','y','z'}and'dimension'in observed['home'])
    items=json.loads(command('execute in '+args.dimension+' run companiontest inventory '+id))['items']
    slots={i['slot']:i for i in items}
    check('inventory_slot_facts_match_native_items',all(i['slot']in slots and all(i[k]==slots[i['slot']][k]for k in['id','name','count'])for i in observed['inventorySlots']))
    mana=observed['rpg']['mana'];check('finite_actual_mana',0<=mana['current']<=mana['max'])
    abilities=observed['rpg']['abilities']
    check('learned_ability_cost_cooldown_and_help',set(a['id']for a in abilities)==set(observed['rpg']['skills'])and all(a['effect']and a['manaCost']>0 and 0<=a['cooldownRemainingMs']<=a['cooldownMs']for a in abilities))
    check('skill_resource_readiness_matches_observed_mana_and_cooldown',all(a['resourceReady']==(a['cooldownRemainingMs']==0 and mana['current']>=a['manaCost'])for a in abilities))
    request=str(uuid.uuid4())
    invalid=resident('act '+request+' '+json.dumps({'action':'walk','to':{'x':1,'y':2,'z':3}}))
    check('ambiguous_target_not_rewritten',invalid['status']=='rejected'and invalid['completed']is False and'at: required'in invalid['reason'])
    check('invalid_request_receipt_remains_queryable',resident('receipt '+request)['status']=='rejected')
    if args.unknown_travel:
        request=str(uuid.UUID(args.unknown_travel));row=resident('travel-receipt '+request)
        check('original_unknown_transfer_not_called_complete',row['requestId']==request and row['status']=='unknown'and row['completed']is False and row['retryable']is False)
    print(json.dumps({'checks':checks,'passed':True,'productionChanged':False},ensure_ascii=False))

if __name__=='__main__':main()
