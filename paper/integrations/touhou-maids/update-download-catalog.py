"""Add the reviewed client catalogue without replacing other publishers' entries."""
from pathlib import Path
import argparse,re

IMPORT="import maidClientDownloads from './maid-client-downloads.json' with { type: 'json' };"
ARRAY='  ...maidClientDownloads.map(row => Object.freeze(row)),'
ALIAS="'/downloads/maid-client':'maids-client-pack','/downloads/maid-mods':'maids-client-mods',"
def patch(text):
    states=[IMPORT in text,ARRAY in text,ALIAS in text]
    if all(states):return text
    assert not any(states),'Partial catalogue change; review instead of overwriting'
    anchor="import offlineDownloads from './offline-downloads.json' with { type: 'json' };"
    assert text.count(anchor)==1
    text=text.replace(anchor,anchor+'\n'+IMPORT,1)
    anchor='export const packageReleases = Object.freeze([';assert text.count(anchor)==1;text=text.replace(anchor,anchor+'\n'+ARRAY,1)
    matches=list(re.finditer(r'const aliases\s*=\s*Object\.freeze\(\{',text));assert len(matches)==1,'Alias declaration changed; preserve current catalogue'
    index=matches[0].end();return text[:index]+ALIAS+text[index:]
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('path',type=Path);a=p.parse_args();before=a.path.read_text(encoding='utf-8');a.path.write_text(patch(before),encoding='utf-8');print('Preserved current catalogue and added only native-maid entries')
