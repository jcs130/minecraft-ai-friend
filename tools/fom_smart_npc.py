"""Read-only release policy for the optional FOM Smart NPC expansion."""
from pathlib import Path
import json,re,tomllib

JAR='SmartNpc-1.21.1-2.0.1.jar'
VERSION='21.1.250'
EVENTS={'teamup_request','call_help','warn_death','missing_home_chest','broken_bed',
        'killer_taunt','death_reaction','burn_item','throw_trash'}

def check_policy(server):
    server=Path(server)
    if not (server/'mods'/JAR).is_file():return {}
    config=tomllib.loads((server/'config/smart_npc-server.toml').read_text('utf-8'))
    args=(server/'java.args').read_text('utf-8')
    if not re.search(r'--fml\.neoForgeVersion\s+'+re.escape(VERSION)+r'(?:\s|$)',args):
        raise ValueError('Smart NPC requires the reviewed NeoForge '+VERSION+' release')
    if not (config['forceTickManage']==0 and 1<=config['maxNaturalPlayerNpcs']<=4
            and 1<=config['aiScheduler']['processingNpcLimit']<=2
            and 0<config['aiScheduler']['targetServerMspt']<=40):
        raise ValueError('Smart NPC population/AI budget differs from this rollout')
    if config['npcChatLocale']!='zh_cn' or config['showNpcChatPrefix'] is not True or config['turnOnNpcChat'] is not True:
        raise ValueError('Smart NPC chat must use labelled Chinese dialogue')
    chat=server/'world/datapacks/fom-smart-npc/data/smart_npc/chat/zh_cn'
    for event in EVENTS:
        rows=json.loads((chat/(event+'.json')).read_text('utf-8'))
        if not isinstance(rows,list) or not rows or not all(isinstance(row,str) and row.strip() for row in rows):
            raise ValueError('Invalid Smart NPC dialogue: '+event)
    roster=tomllib.loads((server/'config/smart_npc-names.toml').read_text('utf-8'))['playerNpcNames']
    if not roster or any(set(interests)&{'HUNT_PLAYERS','HUNT_VILLAGERS','TROLL_HIT','LOOTING'} for interests in roster.values()):
        raise ValueError('Smart NPC rollout uses cooperative roles')
    return {'smart_npc_loader_and_budget':True,'smart_npc_chinese_chat':True,'smart_npc_cooperative_roster':True}
