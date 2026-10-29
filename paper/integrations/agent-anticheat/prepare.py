"""Emit an Agent-compatible LightAntiCheat policy without touching a live server.

Automation is allowed server policy: detect impossible actions, not automation.
Start with corrective setbacks and private logs; never automatic kicks/bans.
"""
import argparse,hashlib,json,zipfile
from pathlib import Path
import yaml
PIN='42bc52ebda95807346d158bef4a4df888ff9b71ee3087acf6297b68132699c30be3d59ffc3dcae15547e8f83aede1d343c75475c85a5a2be72e2d53816ecc5e1'
DISABLE={'autobot','skinblinker','autoclicker','killaura','sorting','itemswap','fastplace'}
def configure(c):
 c['enabled']=True
 for x in c['alerts'].values():
  if isinstance(x,dict):x['enabled']=False
 c['permission']['disable-all-bypass-permissions']=True
 c['geyser-hook']['uuid']['enabled']=False;c['geyser-hook']['prefix']['enabled']=False
 c['geyser-hook']['floodgate']['enabled']=True
 c['update-checker']['enabled']=False;c['bstats']['enabled']=False
 # Required for the guard to cancel a trusted skill's violation before LAC's
 # HIGHEST listener logs it or applies a corrective setback.
 c['api']['enabled']=True
 # No webhook, model connection or public broadcast is introduced.
 c['discord-webhook']['enabled']=False
 active=[];disabled=[];corrective=[]
 for family,groups in c['checks'].items():
  for group,checks in groups.items():
   for name,check in checks.items():
    check['enabled']=group not in DISABLE
    check['punishment']['punishable']=False;check['punishment']['commands']=[]
    check['detection']['min-tps']=17.0;check['detection']['max-ping']=750
    # Official defaults only log violations. Enable the specifically exercised
    # flight corrections; the other enabled checks remain observation-only.
    check['setback']['setback']=group=='flight'
    if group=='flight':corrective.append(name)
    if group in DISABLE:disabled.append(name)
    else:active.append(name)
 return c,{'enabledChecks':active,'correctiveChecks':corrective,'disabledAutomationChecks':disabled,'automaticKicksOrBans':False,'publicAlerts':False,'usernamePrefixExemption':False,'floodgateApi':True}
def main():
 p=argparse.ArgumentParser();p.add_argument('--jar',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
 assert hashlib.sha512(a.jar.read_bytes()).hexdigest()==PIN,'Only official pinned LAC 1.2.6'
 with zipfile.ZipFile(a.jar)as z:c=yaml.safe_load(z.read('config.yml'))
 c,report=configure(c);a.output.mkdir(parents=True,exist_ok=False)
 (a.output/'config.yml').write_text(yaml.safe_dump(c,sort_keys=False,allow_unicode=True),encoding='utf8')
 (a.output/'policy.json').write_text(json.dumps(report,indent=2),encoding='utf8')
 print(json.dumps({'enabled':len(report['enabledChecks']),'disabledAutomation':len(report['disabledAutomationChecks']),'productionChanged':False}))
if __name__=='__main__':main()
