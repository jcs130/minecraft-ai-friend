"""Verify the isolated NPC skill-book light chain with reserved player QDNpcProbe.

Requires --execute qiandengji. Uses the existing world image's Mineflayer and
RCON dependencies, the shared smoke lock, and only qiandengji mounts. No NPC is
created. A book-use attempt precedes an explicitly labelled queue fallback.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
CONTAINER = 'qiandengji-world-1'

SCRIPT = r'''
import {appendFile, open, readFile, unlink} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {Rcon} from '/app/src/rcon.ts';
const QA='QDNpcProbe', DATA='/app/data', QUEUE='/mcdata/spell-requests.jsonl';
const report={project:'qiandengji',player:QA,startedAt:new Date().toISOString(),ok:false,checks:[],cleanup:{}};
let bot,rcon,lock,secret='',bookPlaced=false,addedTorches=false,oldMode=null,timer,abort=null;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const clean=e=>String(e?.message||e).replaceAll(secret||'\0','[redacted]').slice(0,400);
const check=(name,details={})=>report.checks.push({name,ok:true,...details});
const guard=()=>{if(abort)throw abort;};
async function cmd(text){guard();const reply=await rcon.send(text,7000);guard();return reply;}
async function tail(path){
 let f;try{f=await open(path,'r');const size=(await f.stat()).size,start=Math.max(0,size-131072);
 const b=Buffer.alloc(size-start);const {bytesRead}=await f.read(b,0,b.length,start);
 const lines=b.subarray(0,bytesRead).toString('utf8').split('\n');if(start)lines.shift();lines.pop();
 return lines.flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
 }catch(e){if(e.code==='ENOENT')return [];throw e;}finally{await f?.close();}
}
async function torchCount(){
 const text=await cmd(`clear ${QA} minecraft:torch 0`);
 const match=text.match(/Found (\d+) matching item/);
 if(match)return Number(match[1]);
 if(/No items were found/.test(text))return 0;
 throw new Error('Could not read QA torch count');
}
async function waitSpawn(){
 return new Promise((resolve,reject)=>{
 const timeout=setTimeout(()=>finish(new Error('Mineflayer spawn timeout')),25000);
 const spawn=()=>finish(),error=e=>finish(e),end=()=>finish(new Error('Disconnected before spawn'));
 function finish(e){clearTimeout(timeout);bot.removeListener('spawn',spawn);bot.removeListener('error',error);bot.removeListener('end',end);e?reject(e):resolve();}
 bot.once('spawn',spawn);bot.once('error',error);bot.once('end',end);
 });
}
try{
 if(process.env.SMOKE_EXECUTE!=='qiandengji'||process.env.SMOKE_PROJECT!=='qiandengji')throw new Error('Missing isolated execution guards');
 if((await readFile(`${DATA}/.qiandengji-smoke`,'utf8')).trim()!=='qiandengji')throw new Error('Missing isolated fixture marker');
 lock=await open(`${DATA}/.qiandengji-smoke.lock`,'wx');await lock.writeFile(JSON.stringify({pid:process.pid,player:QA,at:report.startedAt}));
 timer=setTimeout(()=>{abort=new Error('NPC smoke total timeout');},85000);
 secret=(await readFile(`${DATA}/rcon-secret.txt`,'utf8')).replace(/^\uFEFF/,'').trim();
 if(!secret)throw new Error('Missing isolated RCON credential');
 rcon=new Rcon('mc',25575,secret);await rcon.connect(6000);
 if((await cmd('list')).includes(QA))throw new Error('Reserved NPC QA player is already online');
 const health=JSON.parse(await readFile('/mcdata/npc-health.json','utf8'));
 if(Date.now()/1000-health.spell_last_poll>15||!health.threads?.spell)throw new Error('NPC spell consumer is not ready');
 const require=createRequire('/app/package.json'),mineflayer=require('mineflayer');
 const messages=[];
 bot=mineflayer.createBot({host:'mc',port:25599,username:QA,version:'1.21.1',auth:'offline',hideErrors:true,checkTimeoutInterval:20000});
 bot.on('error',e=>{abort=e;});bot.on('kicked',()=>{abort=new Error('QA player was kicked');});
 bot.on('messagestr',message=>messages.push({at:Date.now(),text:String(message)}));
 await waitSpawn();await delay(1500);check('mineflayer-login');
 const modeReply=await cmd(`data get entity ${QA} playerGameType`),modeMatch=modeReply.match(/entity data: (\d+)/);
 if(!modeMatch)throw new Error('Cannot preserve QA game mode');oldMode=Number(modeMatch[1]);
 await cmd(`gamemode creative ${QA}`);
 const empty=await cmd(`data get entity ${QA} Inventory[{Slot:8b}]`);
 if(!/Found no elements/.test(empty))throw new Error('Reserved QA hotbar slot 8 must be empty; no item overwritten');
 const before=await torchCount();
 const previous=(await tail('/mcdata/npc-feed.jsonl')).filter(r=>r.who===QA&&r.skill==='light').pop();
 if(previous&&Date.now()/1000-Number(previous.t)<17)await delay(Math.ceil((17-(Date.now()/1000-Number(previous.t)))*1000));
 // Exactly the original book marker read by SkillBookUseMixin. Slot 8 was empty.
 const give=await cmd(`item replace entity ${QA} hotbar.8 with minecraft:written_book[minecraft:custom_data={skillbook:"light",qiandengji_smoke:true},minecraft:written_book_content={title:"QA Light",author:"Qiandengji QA",pages:['{"text":"QA light skill"}']}] 1`);
 if(!/Replaced/.test(give))throw new Error('Server rejected the marked QA light book');
 bookPlaced=true;await delay(500);bot.setQuickBarSlot(8);bot.setControlState('sneak',false);await delay(250);
 const submittedAt=Date.now();let request=null,bookError=null;
 try{bot.activateItem();}catch(e){bookError=clean(e);}
 let deadline=Date.now()+8000;
 while(Date.now()<deadline){guard();request=(await tail(QUEUE)).find(r=>r.speaker===QA&&r.skill==='light'&&r.ts>=submittedAt);if(request)break;await delay(250);}
 if(request){report.grade='book-interaction';check('botgate-book-request',{at:request.ts});}
 else{
   if(await torchCount()!==before)throw new Error('Book had an effect without a matching request; refusing duplicate fallback');
   report.grade='queue-consumer';report.bookInteractionVerified=false;
   report.bookLimitation=bookError||'One Mineflayer use-item attempt produced no botgate queue record within 8 seconds';
   request={speaker:QA,skill:'light',text:'',ts:Date.now()};
   await appendFile(QUEUE,JSON.stringify(request)+'\n','utf8');check('exact-botgate-queue-fallback',{at:request.ts});
 }
 let receipt=null,count=before;deadline=Date.now()+20000;
 while(Date.now()<deadline){
   guard();count=await torchCount();
   receipt=(await tail('/mcdata/npc-feed.jsonl')).find(r=>r.who===QA&&r.kind==='spell'&&r.skill==='light'&&Number(r.t)*1000>=request.ts-100);
   if(count===before+4&&receipt)break;await delay(350);
 }
 if(count===before+4)addedTorches=true;
 if(count!==before+4)throw new Error(`Expected exactly four torches from consumer; observed delta ${count-before}`);
 if(!receipt)throw new Error('Torch effect lacked a matching NPC spell receipt');
 check('npc-light-effect',{torchBefore:before,torchAfter:count,delta:count-before});
 check('npc-feed-receipt',{at:receipt.t,text:receipt.text});
 await delay(700);
 const tell=messages.find(m=>m.at>=submittedAt&&m.text.includes('火把')&&m.text.includes('女神'));
 if(!tell)throw new Error('QA client did not receive the NPC tellraw receipt');
 check('client-tellraw',{text:tell.text});
 report.bookInteractionVerified=report.grade==='book-interaction';report.ok=true;
}catch(e){report.error=clean(e);}
finally{
 clearTimeout(timer);abort=null;
 if(rcon?.isConnected()){
   try{
     if(addedTorches){const reply=await rcon.send(`clear ${QA} minecraft:torch 4`,5000);if(!/Removed 4 /.test(reply))throw new Error('Could not restore QA torch total');report.cleanup.torchesRemoved=4;}
     if(bookPlaced){await rcon.send(`item replace entity ${QA} hotbar.8 with minecraft:air`,5000);report.cleanup.testBookRemoved=true;}
     if(oldMode!==null)await rcon.send(`gamemode ${['survival','creative','adventure','spectator'][oldMode]} ${QA}`,5000);
   }catch(e){report.ok=false;report.cleanup.error=clean(e);}
 }
 if(bot){bot.quit('Qiandengji NPC smoke complete');await delay(200);if(!bot._client?.ended)bot._client?.end('NPC smoke cleanup');}
 if(rcon?.isConnected()){
   try{let online=true;for(let i=0;i<5&&online;i++){online=(await rcon.send('list',3000)).includes(QA);if(online)await delay(300);}
   report.cleanup.probeDisconnected=!online;if(online)report.ok=false;}catch(e){report.ok=false;report.cleanup.error=clean(e);}
 }
 rcon?.close();if(lock){await lock.close();await unlink(`${DATA}/.qiandengji-smoke.lock`);}
 report.finishedAt=new Date().toISOString();
}
process.stdout.write(JSON.stringify(report,null,2)+'\n');process.exit(report.ok?0:1);
'''


def validate_inspect(data):
    if data.get('project') != 'qiandengji' or data.get('running') is not True:
        raise RuntimeError('Only the running qiandengji world container is permitted')
    mounts = {m['Destination']: Path(m['Source']).resolve() for m in data.get('mounts', [])}
    for dest, relative in [('/app/data', 'server/world-data'), ('/mcdata', 'server/mcdata')]:
        if mounts.get(dest) != (ROOT / relative).resolve():
            raise RuntimeError('Unexpected world-data or mcdata mount; smoke refused')


def self_test():
    import unittest
    class Checks(unittest.TestCase):
        def test_production_and_wrong_mount_rejected(self):
            good = {'project':'qiandengji', 'running':True, 'mounts':[
                {'Destination':'/app/data','Source':str(ROOT/'server/world-data')},
                {'Destination':'/mcdata','Source':str(ROOT/'server/mcdata')}]}
            validate_inspect(good)
            with self.assertRaises(RuntimeError): validate_inspect({**good,'project':'shadow'})
            with self.assertRaises(RuntimeError): validate_inspect({**good,'mounts':[]})
            with self.assertRaises(RuntimeError): validate_inspect({**good,'running':False})
        def test_only_reserved_identity_and_shared_lock(self):
            self.assertIn("const QA='QDNpcProbe'", SCRIPT)
            self.assertIn('.qiandengji-smoke.lock', SCRIPT)
            self.assertNotIn('QDSmokeProbe', SCRIPT)
            self.assertNotIn('summon ', SCRIPT)
    return unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(Checks)).wasSuccessful()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute', choices=['qiandengji'])
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args()
    if args.self_test:
        return 0 if self_test() else 1
    if not args.execute:
        parser.error('--execute qiandengji is required for the live test')
    fmt = '{"project":{{json (index .Config.Labels "com.docker.compose.project")}},"running":{{json .State.Running}},"mounts":{{json .Mounts}}}'
    result = subprocess.run(['docker','inspect','--format',fmt,CONTAINER], capture_output=True, text=True, encoding='utf-8', timeout=15)
    if result.returncode:
        raise RuntimeError('Cannot inspect isolated world container')
    validate_inspect(json.loads(result.stdout))
    result = subprocess.run(['docker','exec','-i','-e','SMOKE_EXECUTE=qiandengji','-e','SMOKE_PROJECT=qiandengji',CONTAINER,
                             '/app/node_modules/.bin/tsx','--input-type=module','-'],input=SCRIPT,
                            capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=115)
    try:
        report = json.loads(result.stdout)
    except ValueError:
        # Dependency diagnostics may contain arbitrary connection data; do not echo them.
        report = {'project':'qiandengji','ok':False,'error':'Runner did not produce a JSON report','exitCode':result.returncode}
    path = ROOT/'reports'/('npc-smoke-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')+'.json')
    path.parent.mkdir(exist_ok=True)
    with path.open('x',encoding='utf-8') as out:
        json.dump(report,out,ensure_ascii=False,indent=2)
    print(json.dumps({'report':str(path),**report},ensure_ascii=False,indent=2))
    return 0 if result.returncode==0 and report.get('ok') else 1


if __name__=='__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    raise SystemExit(main())
