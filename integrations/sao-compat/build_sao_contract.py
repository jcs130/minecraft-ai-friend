"""Single source of the optional SAO gameplay SDK contracts (no game/model startup)."""
import json
from pathlib import Path

def integer(minimum,maximum):return {'type':'integer','minimum':minimum,'maximum':maximum}
def text(pattern,maximum=64):return {'type':'string','pattern':pattern,'maxLength':maximum}
ID=text('^[0-9A-Fa-f]{16}$',16)
REQUEST=text('^[A-Za-z0-9:_-]{1,64}$')
KIND={'type':'string','enum':['profession','sword'],'pattern':'^(profession|sword)$','maxLength':10}
def op(id,read,description,properties=None,required=None,example=None):
    return {'id':'sao.'+id,'readOnly':read,'description':description,
            'parameters':{'type':'object','additionalProperties':False,'properties':properties or {},'required':required or []},'example':example or {}}
CONTRACT={'schemaVersion':1,'bridgeId':'maw_sao_gameplay','version':'0.1.0','scope':'requesting_player_only',
 'limits':{'queryBytes':4096,'stateBytes':16384,'pageDefault':8,'pageMax':12,'actionCommandChars':240},
 'operations':[
 op('capabilities',True,'Read a short operation index, or one exact operation schema/example. No quest book or skill table is injected automatically.',{'operation':text('^sao\\.[a-z_.]+$',80)}),
 op('status',True,'Read own native SAO level, profession, resource, skill loadout and talent points. Separate from vanilla XP and FTB team progress. Cooldowns use milliseconds.'),
 op('quests.list',True,'Page visible quests for your own FTB team; default filter=available includes actionable quests and unclaimed rewards. Optional query searches visible titles, chapter_id restricts a returned chapter ID. No artificial accept state: eligible FTB quests start automatically.',{'offset':integer(0,10000),'limit':integer(1,12),'filter':text('^(available|visible|completed|unclaimed)$',12),'chapter_id':ID,'query':text(r'^[^\r\n]{1,80}$',80)},example={'offset':0,'limit':8,'filter':'available'}),
 op('quest.show',True,'Read a visible quest, real prerequisites/tasks/rewards and native progress. Hidden details remain unavailable. task_offset/reward_offset select bounded pages; nothing is marked complete.',{'quest_id':ID,'task_offset':integer(0,1000),'reward_offset':integer(0,1000)},['quest_id'],{'quest_id':'4C2ED6FA2C94A4F0'}),
 op('professions',True,'Read runtime profession names and skills, including installed extensions. Omit profession_id for a bounded profession index; supply one returned ID for skills/costs/requirements.',{'profession_id':integer(1,99)}),
 op('talents',True,'Read one native talent page: ranks, level requirements, available points and buy/refund eligibility. Default 8, maximum 12; nextOffset is optional continuation.',{'offset':integer(0,255),'limit':integer(1,12)}),
 op('attributes',True,'Read the independent P-screen attribute points and each stat restriction. These are separate from talent-tree points.'),
 op('action_status',True,'Reconcile this player\u2019s original action request. Missing IDs are unknown, never proof of non-execution. Historical terminal receipts are not fresh state.',{'action_request_id':REQUEST},['action_request_id'],{'action_request_id':'my-quest-claim-1'}),
 op('task.submit',False,'Press the normal native submission/checkmark button for one visible, eligible task. Native FTB rules perform checks and consumption. Automatic/custom/observation/screen-only conditions are not force-completed.',{'task_id':ID},['task_id'],{'task_id':'51F117D0DF5D36AE'}),
 op('reward.claim',False,'Claim one actual visible reward of a completed quest, using native FTB claim bookkeeping and hooks. Duplicate request IDs do not grant twice. Inventory space and unsupported reward types fail explicitly.',{'reward_id':ID},['reward_id'],{'reward_id':'6204F8971646E9F8'}),
 op('quest.track',False,'Pin an eligible visible quest for this player; this is tracking, not task completion.',{'quest_id':ID},['quest_id'],{'quest_id':'4C2ED6FA2C94A4F0'}),
 op('profession.choose',False,'Choose a runtime profession through the same server handler as the Java GUI. Native scroll cost, combat and switch cooldown apply; no OP or free respec.',{'profession_id':integer(1,99)},['profession_id'],{'profession_id':1}),
 op('loadout.bind',False,'Bind a native profession/sword skill to a slot. Profession slots/skills are 0..5, sword slots 0..1/skills 0..3. Native style and level gates apply.',{'kind':KIND,'slot':integer(0,5),'skill':integer(0,5)},['kind','slot','skill'],{'kind':'profession','slot':0,'skill':0}),
 op('skill.cast',False,'Activate an observed equipped native skill slot, using the normal aim, costs, cooldown and combat rules. A started cast is not proof of a hit/kill.',{'kind':KIND,'slot':integer(0,5)},['kind','slot'],{'kind':'profession','slot':0}),
 op('talent.buy',False,'Buy one native talent rank using real available points and level/prerequisite gates.',{'node':integer(0,255)},['node'],{'node':0}),
 op('talent.refund',False,'Refund one native rank only when the mod allows it; dependent nodes and combat rules remain.',{'node':integer(0,255)},['node'],{'node':0})]}
CONTRACT['operations'].extend([
 op('attribute.buy',False,'Allocate one real attribute point through the mod API. Native profession restrictions and point availability apply.',{'node':integer(0,255)},['node'],{'node':1}),
 op('attribute.refund',False,'Refund one real attribute rank through the native mod API; combat and refund rules remain.',{'node':integer(0,255)},['node'],{'node':1})])

if __name__=='__main__':
    Path(__file__).with_name('sao-operations.json').write_bytes((json.dumps(CONTRACT,ensure_ascii=False,indent=2)+'\n').encode())
