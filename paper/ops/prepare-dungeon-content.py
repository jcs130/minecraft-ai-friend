"""Prepare a joint candidate from current definitions. Does not install any content."""
from pathlib import Path
import argparse,copy,hashlib,json
import yaml
p=argparse.ArgumentParser(description=__doc__)
for name in ('base','ruins','connector','output'):p.add_argument('--'+name,type=Path,required=True)
a=p.parse_args()
def require(value,message):
    if not value:raise RuntimeError(message)
require(not a.output.exists(),'Use a fresh output directory')
class UniqueLoader(yaml.SafeLoader):pass
def unique_mapping(loader,node,deep=False):
    loader.flatten_mapping(node);result={}
    for key_node,value_node in node.value:
        key=loader.construct_object(key_node,deep=deep)
        require(key not in result,'Duplicate YAML key: '+str(key))
        result[key]=loader.construct_object(value_node,deep=deep)
    return result
UniqueLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG,unique_mapping)
load=lambda path:yaml.load(path.read_text(encoding='utf-8-sig'),Loader=UniqueLoader)
base=load(a.base);source=load(a.ruins);connector=json.loads(a.connector.read_text(encoding='utf8'))
old={'undead_crypt','creeping_crypt','bunker','illager_camp','aincrad_01'}
added={'corsair_cove','tide_sanctum','sunken_dynasty','frost_keep','ember_foundry','jungle_covenant','sky_watch','void_citadel','deep_mineworks','winter_manor'}
require(base['schema-version']==source['schema-version']==1 and set(base['sites'])==old,'Unexpected current site catalogue')
require(set(source['sites'])==old|added and all(base['sites'][s]==source['sites'][s] for s in old),'Current old definitions changed: review before merging')
require(connector['world']=='world' and connector['changes']==34 and len(connector['cells'])==34,'Unexpected connector manifest')
out=copy.deepcopy(base)
for site in sorted(added):out['sites'][site]=copy.deepcopy(source['sites'][site])
crypt=out['sites']['creeping_crypt'];require(crypt.get('entry') in (None,[]) and 'approach' not in crypt,'Current entrance changed; review instead of overwriting')
box=[1162,85,227,1171,96,233]
crypt['approach']={'entry':connector['entry'],'hint':connector['configurationCandidate']['hint']}
crypt.setdefault('protection-boxes',[]).append(box)
require(all(all(box[i]<=cell['pos'][i]<=box[i+3] for i in range(3)) for cell in connector['cells']),'Connector cell lacks building protection')
# The old combat/checkpoint definition, including its legacy hint and entry, stays exact.
verify=copy.deepcopy(crypt);verify.pop('approach');verify['protection-boxes'].pop()
if 'protection-boxes' not in base['sites']['creeping_crypt']:verify.pop('protection-boxes')
require(verify==base['sites']['creeping_crypt'],'Legacy crypt combat definition changed')
require(all(out['sites'][site]==base['sites'][site] for site in old-{'creeping_crypt'}),'An unrelated original site changed')
a.output.mkdir(parents=True);target=a.output/'dungeons.yml';target.write_text(yaml.safe_dump(out,allow_unicode=True,sort_keys=False),encoding='utf8')
sha=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
proof={'sourceSha256':sha(a.base),'ruinsSha256':sha(a.ruins),'connectorSha256':sha(a.connector),'outputSha256':sha(target),'oldSites':sorted(old),'addedSites':sorted(added),'sites':len(out['sites']),'rooms':sum(len(s['rooms']) for s in out['sites'].values()),'oldCombatDefinitionsPreserved':True,'approachIsNavigationOnly':True,'protectedConnectorCells':34,'newProtectionBox':box,'productionChanged':False}
(a.output/'configuration-proof.json').write_text(json.dumps(proof,indent=2)+'\n',encoding='utf8');print(json.dumps(proof))
