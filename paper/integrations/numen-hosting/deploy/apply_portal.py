"""Apply the four hosting hooks to a verified deployed portal without replacing its overlay."""
from pathlib import Path
import argparse,hashlib

def apply(source,patch):
    added=[line[1:] for line in patch.splitlines() if line.startswith('+') and not line.startswith('+++')]
    imports=[line for line in added if line.startswith('import {hostingRoutes}')]
    bindings=[line for line in added if line.strip().startswith('const hostedAgents=')]
    sites=[line for line in added if "pathname === '/api/v1/site'" in line]
    assert len(imports)==len(bindings)==len(sites)==1
    begin=next(i for i,line in enumerate(added) if 'if(await hostingRoutes({' in line)
    end=next(i for i in range(begin,len(added)) if '}}))return;' in added[i])
    route='\n'.join(added[begin:end+1])+'\n'
    edits=[
      ("import { publicDialogueText } from './public-dialogue.mjs';\n","import { publicDialogueText } from './public-dialogue.mjs';\n"+imports[0]+'\n'),
      ("  const game = options.game || (cloud ? new CloudGame(config, store, cloud) : new GameData(config, store.salt));\n","  const game = options.game || (cloud ? new CloudGame(config, store, cloud) : new GameData(config, store.salt));\n"+bindings[0]+'\n'),
      ("      if (req.method === 'OPTIONS') { res.writeHead(405); return res.end(); }\n","      if (req.method === 'OPTIONS') { res.writeHead(405); return res.end(); }\n"+route),
      (sites[0].replace(', hosting:{enabled:!!hostedAgents,requiresOwnKey:true}','')+'\n',sites[0]+'\n')]
    assert 'hostingRoutes' not in source,'Hosting hooks already installed'
    for old,new in edits:
        assert source.count(old)==1,'Deployed portal no longer matches the reviewed hosting anchor'
        source=source.replace(old,new,1)
    return source

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--server',required=True);parser.add_argument('--patch',required=True)
    args=parser.parse_args();server=Path(args.server)
    result=apply(server.read_text(encoding='utf8'),Path(args.patch).read_text(encoding='utf8'))
    server.write_text(result,encoding='utf8',newline='\n')
    print('Hosting hooks applied; sha256='+hashlib.sha256(server.read_bytes()).hexdigest())
