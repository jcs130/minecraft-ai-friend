"""Correct the one observed KubeJS player UUID accessor without changing items."""
import argparse
import hashlib
import json
from pathlib import Path
from prepare_pack import digest

def patch(root, prepare_reload=False):
    root=Path(root).resolve(strict=True)
    if json.loads((root/'pack-source.json').read_text('utf-8'))['scope']!='isolated_testing':raise ValueError('marked_lab_required')
    if json.loads((root/'lab-process.json').read_text('utf-8'))['phase']!='exited' and not prepare_reload:raise ValueError('stop_lab_or_explicitly_prepare_reload')
    relative='kubejs/server_scripts/sao_remnant_unified075.js';source=root/'client'/relative;target=root/'server'/relative
    text=source.read_text('utf-8')
    if hashlib.sha256(text.encode('utf-8')).hexdigest()!='7b515f57901f695de32e8fce2084cb49ee03d94fe5d9b174e36d768cc9205fa4':raise ValueError('review_changed_pack_script')
    first=text.replace('player.getUUID()','player.uuid')
    modified=first.replace('stack.hasTag()','stack.nbt != null').replace('stack.getTag().copy()','stack.nbt.copy()').replace('next.setTag(tag)','next.nbt = tag')
    if text.count('player.getUUID()')!=1:raise ValueError('unexpected_accessor_count')
    if any(text.count(term)!=1 for term in ['stack.hasTag()','stack.getTag().copy()','next.setTag(tag)']):raise ValueError('review_changed_nbt_accessors')
    if target.read_text('utf-8')not in (text,first,modified):raise ValueError('existing_script_modified')
    target.write_text(modified,encoding='utf-8',newline='\n')
    report={'original_sha256':digest(source),'patched_sha256':digest(target),'replacements':['player.getUUID() -> player.uuid','stack.hasTag() -> stack.nbt != null','stack.getTag().copy() -> stack.nbt.copy()','next.setTag(tag) -> next.nbt = tag'],'count':4,'source_client_unchanged':True,'inventory_migration_logic_unchanged':True,'requires_server_scripts_reload':prepare_reload}
    (root/'remnant-script-fix.json').write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report))

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root',required=True);p.add_argument('--prepare-reload',action='store_true');a=p.parse_args();patch(a.root,a.prepare_reload)
