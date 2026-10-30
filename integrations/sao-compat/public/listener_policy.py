"""Validate values in mod-owned properties files that legitimately rewrite."""
from pathlib import Path

def validate_voice(path,public):
 values={}
 for line in Path(path).read_text(encoding='utf-8').splitlines():
  if '='in line and not line.lstrip().startswith(('#','!')):
   key,value=line.split('=',1);values[key.strip()]=value.strip()
 expected={'port':'28989'if public else'38989','bind_address':'0.0.0.0'if public else'127.0.0.1'}
 if any(values.get(key)!=value for key,value in expected.items()):raise ValueError('voice_listener_policy_changed')
 return expected
