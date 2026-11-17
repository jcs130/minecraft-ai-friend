"""Real native combat acceptance in an explicitly marked, loopback-only synthetic world."""
from pathlib import Path
import argparse,importlib.util,json,time,uuid,re,collections

def load(path):
 spec=importlib.util.spec_from_file_location('combat_stock',path);mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod);return mod

class CombatAcceptance:
 def __init__(self,stage,report):
  self.stage=stage.resolve();self.report=report;self.checks=[];self.samples=[]
  assert(self.stage/'.resident-hybrid-qa').read_text()=='SYNTHETIC_RESIDENT_HYBRID_ONLY'
  self.props=dict(x.split('=',1)for x in(self.stage/'server.properties').read_text().splitlines()if'='in x)
  assert self.props['server-ip']=='127.0.0.1'and self.props['rcon.port']!='25575'
  self.stock=load(Path(__file__).with_name('stock-stage.py'))
  self.roles=json.loads((self.stage/'config/tlm-residents.json').read_bytes())['residents']
  assert all(r['maidId'].startswith('10000000-0000-0000-0000-')for r in self.roles)
 def cmd(self,text):return self.stock.rcon(int(self.props['rcon.port']),self.props['rcon.password'],text).strip()
 def status(self,id):
  text=self.cmd('maidagent resident '+id+' status');assert text.startswith('MC_RESIDENT '),text
  return json.loads(text.removeprefix('MC_RESIDENT '))
 def check(self,name,condition,evidence=None):
  row={'name':name,'passed':bool(condition),'evidence':evidence};self.checks.append(row);self.save()
  if not condition:raise AssertionError(name+': '+json.dumps(evidence,ensure_ascii=False))
  print('PASS '+name,flush=True)
 def save(self):self.report.write_text(json.dumps({'productionChanged':False,'stage':str(self.stage),'checks':self.checks,'samples':self.samples},ensure_ascii=False,indent=2),encoding='utf8')
 def wait(self,read,accept,seconds=25):
  end=time.monotonic()+seconds;value=None
  while time.monotonic()<end:
   value=read()
   if accept(value):return value
   time.sleep(.25)
  return value
 def service(self,id,command,request=None):
  request=request or str(uuid.uuid4());prefix='companiontest service '+id+' '+request
  first=json.loads(self.cmd(prefix+' '+command))
  return self.wait(lambda:json.loads(self.cmd(prefix)),lambda r:r['status']!='accepted')if first['status']=='accepted'else first
 def spawn(self,id,dx=9,health=80):
  at=self.status(id)['position'];x,y,z=at['x']+dx,at['y'],at['z']
  self.cmd('minecraft:kill @e[tag=qa_combat]')
  self.cmd(f'fill {x-2} {y-1} {z-2} {x+2} {y-1} {z+2} stone')
  reply=json.loads(self.cmd('companiontest combat-enemy '+id+' '+str(dx)))
  self.check('real_mobile_enemy_'+id[-2:],reply['health']==100 and reply['ai']is True,reply)
  return reply
 def run(self):
  expected={'ranger','knight','mage','cleric','beastmaster','engineer'}
  states={r['profession']:self.wait(lambda id=r['maidId']:self.status(id),lambda s:s['rpg'].get('available')is True,30)for r in self.roles}
  self.check('six_actual_vortex_classes',set(states)==expected,sorted(states))
  for role,s in states.items():
   self.check(role+'_native_profile',s['rpg'].get('profession')==role and s['rpg'].get('progressionSystem')=='VortexRPG',s['rpg'])
   self.check(role+'_own_real_mana',s['rpg']['mana']['max']>20 and s['rpg']['mana']['current']>0,s['rpg']['mana'])
  ids={r['profession']:r['maidId']for r in self.roles}
  self.check('zero_connected_players',json.loads(self.cmd('companiontest player-count'))['onlinePlayers']==0)
  listed=self.service(ids['ranger'],'profession list');self.check('native_class_discovery',listed['status']=='completed'and set(listed['serviceReceipt']['classes'])==expected)
  locked=self.service(ids['ranger'],'skills learn volley');self.check('learning_level_gate',locked['status']=='blocked',locked)
  before=self.status(ids['ranger'])['rpg']['mana']['current']
  denied=self.service(ids['ranger'],'cast spell_does_not_exist');self.check('unknown_spell_no_success',denied['status']=='blocked',denied)
  self.check('unknown_spell_no_mana_charge',self.status(ids['ranger'])['rpg']['mana']['current']>=before)
  for role in ['ranger','mage','engineer','beastmaster','knight']:
   id=ids[role];before=self.status(id);self.spawn(id,8)
   previous=before['combat'].get('lastSkill',{}).get('requestId')
   after=self.wait(lambda:self.status(id),lambda s:s['combat'].get('lastSkill',{}).get('status')=='completed'and s['combat']['lastSkill'].get('requestId')!=previous,25)
   self.samples.append({'class':role,'before':before,'after':after});self.save()
   self.check(role+'_automatic_native_skill',after['combat'].get('lastSkill',{}).get('status')=='completed',after['combat'])
   if role!='knight':
    actual=self.wait(lambda:self.status(id),lambda s:s['combat']['actualHits']>before['combat']['actualHits'],20)
    self.check(role+'_actual_damage',actual['combat']['actualHits']>before['combat']['actualHits'],actual['combat'])
   self.cmd('minecraft:kill @e[tag=qa_combat]');time.sleep(1)
  id=ids['cleric'];self.cmd('damage '+id+' 8 minecraft:generic');before=self.status(id)
  previous=before['combat'].get('lastSkill',{}).get('requestId')
  after=self.wait(lambda:self.status(id),lambda s:s['combat'].get('lastSkill',{}).get('status')=='completed'and s['combat']['lastSkill'].get('requestId')!=previous,15)
  self.check('cleric_actual_self_heal',after['health']>before['health']and after['combat'].get('lastSkill',{}).get('status')=='completed',{'before':before['health'],'after':after})
  self.save()

 def weapons(self,ranged_weapon='bow'):
  id=next(r['maidId']for r in self.roles if r['profession']=='ranger')
  self.cmd('minecraft:kill @e[tag=qa_combat]')
  # Keep a clear firing lane after party tests; allied bodies must continue to block shots.
  self.cmd('companiontest resident-fixture '+id+' 280')
  for slot,item,count in [(4,'arrow',16),(3,ranged_weapon,1)]:
   reply=json.loads(self.cmd(f'companiontest item-fixture {id} {slot} minecraft:{item} {count}'))
   self.check('fixture_'+item,reply.get('fixture')is True and reply.get('count')==count,reply)
  before=self.status(id);self.check('ammo_present_before_attack',any(i['id']=='minecraft:arrow'and i['count']==16 for i in before['inventorySlots']))
  enemy=self.spawn(id,10)
  after=self.wait(lambda:self.status(id),lambda s:s['combat']['mode']=='ranged',15)
  self.check('ranged_task_selected_from_actual_inventory',after['combat']['mode']=='ranged',after['combat'])
  hit=self.wait(lambda:self.status(id),lambda s:s['combat']['lastHit'].get('targetId')==enemy['id']and s['combat']['lastHit'].get('projectile')is True,35)
  self.check('native_arrow_actually_hit',hit['combat']['lastHit'].get('targetId')==enemy['id']and hit['combat']['lastHit'].get('projectile')is True,hit['combat'])
  arrows=sum(i['count']for i in hit['inventorySlots']if i['id']=='minecraft:arrow')
  self.check('real_arrow_consumed',arrows<16,{'remaining':arrows,'weapon':hit['inventory']})
  self.cmd('companiontest item-fixture '+id+' 4 minecraft:arrow 0')
  melee=self.wait(lambda:self.status(id),lambda s:s['combat']['mode']=='melee',10)
  self.check('empty_quiver_switches_to_real_melee_weapon',melee['combat']['mode']=='melee'and 'mainhand=minecraft:iron_sword' in melee['inventory'],melee)
  target=enemy['id'];at=melee['position'];self.cmd(f'minecraft:tp {target} {at["x"]+1.5} {at["y"]} {at["z"]+.5}')
  hits=melee['combat']['actualHits']
  actual=self.wait(lambda:self.status(id),lambda s:s['combat']['actualHits']>hits and s['combat']['lastHit'].get('projectile')is False,20)
  self.check('native_melee_actually_hit_after_switch',actual['combat']['actualHits']>hits and actual['combat']['lastHit'].get('projectile')is False,actual['combat'])
  self.cmd('minecraft:kill @e[tag=qa_combat]');idle=self.wait(lambda:self.status(id),lambda s:s['combat']['mode']=='idle',5)
  self.check('quiet_restores_previous_native_task',idle['combat']['mode']=='idle'and idle['task']=='touhou_little_maid:idle',idle['task'])
  # A real damage attempt from the resident must still be rejected for a villager.
  at=idle['position'];self.cmd(f'summon villager {at["x"]+2} {at["y"]} {at["z"]} {{Tags:["qa_combat"],PersistenceRequired:1b}}')
  friend=json.loads(self.cmd('companiontest combat-inspect'))['entities'][0]
  self.cmd('minecraft:damage '+friend['uuid']+' 3 minecraft:mob_attack by '+id)
  later=json.loads(self.cmd('companiontest combat-inspect'))['entities'][0]
  self.check('villager_friendly_fire_denied',later['health']==friend['health'],later)
  time.sleep(1);state=self.status(id);self.check('villager_not_auto_targeted',state['combat'].get('targetId')is None,state['combat'])
  self.cmd('minecraft:kill @e[tag=qa_combat]');enemy=self.spawn(id,9)
  self.cmd('data merge entity '+enemy['id']+' {NoAI:1b}');time.sleep(1)
  state=self.status(id);self.check('noai_npc_not_auto_targeted',state['combat'].get('targetId')is None,state['combat'])
  self.cmd('minecraft:kill @e[tag=qa_combat]');self.save()

 def restart(self,before_path):
  before=json.loads(before_path.read_bytes())
  for id,old in before.items():
   after=self.wait(lambda:self.status(id),lambda s:s['rpg'].get('available')is True,30)
   self.check('cold_native_profile_'+id[-2:],all(after['rpg'][k]==old['rpg'][k]for k in['profession','xpTotal','skillPoints','activeSkill'])and set(after['rpg']['skills'])==set(old['rpg']['skills']),{'before':old['rpg'],'after':after['rpg']})
   def gear(s):
    counts=collections.Counter()
    for item,amount in re.findall(r'(minecraft:[a-z_]+)×(\d+)',s['inventory']):
     if item.endswith(('_sword','_pickaxe','_helmet','bow','book','clock','bone')):counts[item]+=int(amount)
    return counts
   self.check('cold_no_duplicate_starting_equipment_'+id[-2:],gear(after)==gear(old),{'before':gear(old),'after':gear(after)})
   previous=old['combat'].get('lastSkill',{})
   if previous.get('status')=='completed':
    mana=after['rpg']['mana']['current'];replay=self.service(id,previous['command'],previous['requestId'])
    self.check('cold_same_request_not_recast_'+id[-2:],replay['status']=='completed'and self.status(id)['rpg']['mana']['current']>=mana,replay)
   self.check('cold_no_combat_replayed_'+id[-2:],not after['combat'].get('lastSkill')and after['combat']['actualHits']==0)

 def advanced(self):
  ids={r['profession']:r['maidId']for r in self.roles};ranger=ids['ranger'];cleric=ids['cleric'];knight=ids['knight']
  row=self.service(knight,'cast fortify');effects=json.loads(self.cmd('companiontest native-rpg '+knight+' effects'))
  self.check('fortify_actual_native_resistance',row['status']=='completed'and any('resistance' in e.lower()for e in effects['effects']),effects)
  before=self.status(cleric);grant=json.loads(self.cmd('companiontest native-rpg '+cleric+' xp 2500'))
  level=self.wait(lambda:self.status(cleric),lambda s:s['rpg']['level']>=4)
  self.check('native_xp_levels_and_points',grant.get('grantedForSyntheticFixture')and level['rpg']['level']>=4 and level['rpg']['xpTotal']==before['rpg']['xpTotal']+2500 and level['rpg']['skillPoints']>before['rpg']['skillPoints'],level['rpg'])
  request=str(uuid.uuid4());learn=self.service(cleric,'skills learn radiant_pulse',request);after=self.status(cleric)
  self.check('learn_real_advanced_spell',learn['status']=='completed'and'radiant_pulse'in after['rpg']['skills']and after['rpg']['skillPoints']==level['rpg']['skillPoints']-1,learn)
  same=self.service(cleric,'skills learn radiant_pulse',request)
  self.check('learning_same_request_no_double_charge',same['status']=='completed'and self.status(cleric)['rpg']['skillPoints']==after['rpg']['skillPoints'])
  prepared=self.service(cleric,'skills prepare radiant_pulse')
  self.check('prepare_native_spell',prepared['status']=='completed'and self.status(cleric)['rpg']['activeSkill']=='radiant_pulse',prepared)
  self.support()

 def support(self,existing_party=False):
  ids={r['profession']:r['maidId']for r in self.roles};ranger=ids['ranger'];cleric=ids['cleric']
  self.cmd('companiontest resident-fixture '+ranger+' 104');self.cmd('companiontest resident-fixture '+cleric+' 106')
  if not existing_party:
   recruited=json.loads(self.cmd('companiontest party-control '+cleric+' '+ranger+' recruit'))
   self.check('native_consent_fixture_party_created',recruited['status']in['ok','accepted'],recruited)
  self.cmd('damage '+ranger+' 12 minecraft:generic');before=self.status(ranger)
  healed=self.wait(lambda:self.status(ranger),lambda s:s['health']>=before['health']+2,12)
  casting=self.wait(lambda:self.status(cleric)['combat']['lastSkill'],lambda r:r.get('status')=='completed'and r.get('command')=='cast radiant_pulse',5)
  self.check('cleric_autonomously_heals_actual_party_member',healed['health']>before['health']and casting.get('command')=='cast radiant_pulse'and casting.get('status')=='completed',{'before':before['health'],'after':healed['health'],'cast':casting})
  stayed=json.loads(self.cmd('companiontest party-control '+cleric+' '+ranger+' stay'));self.check('party_stay_accepted',stayed['status']in['ok','accepted'],stayed)
  self.spawn(cleric,8);time.sleep(1);state=self.status(cleric)
  self.check('stay_does_not_steal_body_for_combat',state['combat'].get('targetId')is None and state['combat']['reason']=='body_controlled_or_unavailable',state['combat'])
  self.cmd('minecraft:kill @e[tag=qa_combat]')
  # Clear the synthetic party by the same native contract path, not by deleting ledger files.
  row=json.loads(self.cmd('companiontest party-control '+cleric+' '+ranger+' dismiss'));self.check('dismiss_native_contract',row['status']in['ok','accepted'],row)
  self.save()

 def boundaries(self):
  id=next(r['maidId']for r in self.roles if r['profession']=='ranger')
  self.cmd('companiontest resident-fixture '+id+' 280');self.cmd('fill 285 81 90 285 87 115 stone')
  try:
   before=self.status(id);self.spawn(id,10);time.sleep(1);after=self.status(id)
   self.check('opaque_wall_blocks_auto_acquisition_and_damage',after['combat'].get('targetId')is None and after['combat']['actualHits']==before['combat']['actualHits'],after['combat'])
  finally:
   self.cmd('minecraft:kill @e[tag=qa_combat]');self.cmd('fill 285 81 90 285 87 115 air')
  for command in ['profession info ranger','skills list','skills tree','skills points','skills info hunter_mark']:
   row=self.service(id,command);self.check('query_'+command.replace(' ','_'),row['status']=='completed'and row['queryOnly']is True,row.get('serviceReceipt'))
  prepared=self.service(id,'skills prepare hunter_mark');self.check('native_prepare_reflected_in_state',prepared['status']=='completed'and self.status(id)['rpg']['activeSkill']=='hunter_mark')

if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--stage',type=Path,required=True);p.add_argument('--report',type=Path,required=True);p.add_argument('--weapons-only',action='store_true');p.add_argument('--ranged-weapon',choices=['bow','crossbow'],default='bow');p.add_argument('--advanced',action='store_true');p.add_argument('--restart-from',type=Path);a=p.parse_args()
 test=CombatAcceptance(a.stage,a.report)
 if a.restart_from:test.restart(a.restart_from)
 elif a.advanced:test.advanced()
 elif a.weapons_only:test.weapons(a.ranged_weapon)
 else:test.run()
