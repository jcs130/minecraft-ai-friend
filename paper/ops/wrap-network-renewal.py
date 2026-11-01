"""Preserve an existing voice renewal program and always attempt the paired Geyser renewal."""
from pathlib import Path
import argparse,ast,hashlib,textwrap
p=argparse.ArgumentParser(description=__doc__)
for name in ['voice-script','geyser-helper','config','report','output']:p.add_argument('--'+name,type=Path,required=True)
p.add_argument('--before-sha256',required=True);a=p.parse_args()
assert hashlib.sha256(a.voice_script.read_bytes()).hexdigest()==a.before_sha256
assert not a.output.exists()and a.output.resolve()!=a.voice_script.resolve()
for path in [a.geyser_helper,a.config,a.report]:assert path.is_absolute()
original=a.voice_script.read_text(encoding='utf-8-sig')
tail="finally:\n    import sys,subprocess\n    if '--apply' in sys.argv:\n        subprocess.run([sys.executable,"+repr(str(a.geyser_helper))+",'--config',"+repr(str(a.config))+",'--report',"+repr(str(a.report))+",'--apply'],check=True,timeout=60)\n"
wrapped='try:\n'+textwrap.indent(original,'    ')+'\n'+tail
before=ast.parse(original);after=ast.parse(wrapped)
assert ast.dump(ast.Module(body=after.body[0].body,type_ignores=[]),include_attributes=False)==ast.dump(before,include_attributes=False),'Original program semantics changed during wrapping'
compile(wrapped,str(a.output),'exec');a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(wrapped,encoding='utf-8')
print('Existing voice program AST preserved; Geyser renewal runs independently in finally')
