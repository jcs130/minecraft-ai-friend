"""Export literal legacy task classification from the same Java definitions."""
import importlib.util, json, re
from pathlib import Path
base=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('activity',base/'world-activity.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
source=base.parent/'plugins/AgentFriend/src/org/afuhome/agentfriend'
tasks={}
guild=(source/'GuildManager.java').read_text(encoding='utf8')
for task,title,goal in re.findall(r'new Contract\("([^"\n]+)",\s*"([^"\n]+)",.*?Goal\.([A-Z_]+),',guild,re.S):
    primary,tags=m.category([goal]);tasks[task]={'title':title,'category':primary,'tags':tags}
life_categories=dict(farmer='farming',gourmet='crafting',angler='fishing',builder='construction',author='culture',tinkerer='construction',trader='trade')
life=(source/'LifeGuildManager.java').read_text(encoding='utf8')
for task,group,title in re.findall(r'new Contract\("([^"\n]+)",\s*"([^"\n]+)",\s*"[^"\n]+",\s*"([^"\n]+)"',life):
    primary=life_categories.get(group,'other');tasks[task]={'title':title,'category':primary,'tags':[primary]}
assert len(tasks)>=35,'Unexpected Java catalogue; inspect schema changes'
out={'schemaVersion':1,'source':'GuildManager.CONTRACTS/LifeGuildManager.CONTRACTS; regenerate after definition changes', 'tasks':tasks}
(base/'world-activity-catalogue.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print(json.dumps({'tasks':len(tasks)}))
