import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe,expect,it} from 'vitest';
import {MinecraftWorldProxy} from '../core/proxy.ts';
import {MINECRAFT_DEFAULTS,type MinecraftConfigSection} from '../core/config.ts';
import type {WorldHost} from '../core/support/host-contract.ts';
import {PROCEDURE_RECEIPT_MIME} from '../core/support/procedure.ts';
import {FakeHost} from './method-host.ts';
import {fixtureBlobs,procedureFixture,procedureRef} from './procedure-fixture.ts';

describe('selected procedure IPC',()=>{
  it('keeps core-authored methods across engine restart without asking host storage or connecting a game',async()=>{
    const dir=mkdtempSync(join(tmpdir(),'method-library-ipc-')),host=new FakeHost();
    const cfg=structuredClone(MINECRAFT_DEFAULTS) as unknown as MinecraftConfigSection;
    cfg.enabled=true;cfg.host='127.0.0.1';cfg.port=1;cfg.viewerPort=0;cfg.client.enabled=false;
    cfg.local.serverDir=join(dir,'never-start');cfg.local.startWithWorld=false;mkdirSync(cfg.local.serverDir);
    host.blob=()=>{throw new Error('core library must not read host artifacts');};
    let proxy=new MinecraftWorldProxy({cfg,dataDir:dir,timezone:'UTC',botName:'Fixture'});
    const call=async(args:Record<string,unknown>)=>{
      const out=await proxy.tools().find(t=>t.name==='mc_script')!.handler(args,{role:'main',log:host.log});
      expect(typeof out === 'string' || !out.failed).toBe(true);
      return out;
    };
    const text=(out:any)=>typeof out==='string'?out:out.text;
    const validate=async(args:Record<string,unknown>)=>{
      const start=await call({...args,validate:true}) as any;
      const id=start.execution.evidence.localId;
      const end=Date.now()+10000;
      while(Date.now()<end){
        const result=JSON.parse(text(await call({runId:id})));
        if(result.status==='validated')return id;
        if(result.status!=='running')throw new Error(JSON.stringify(result));
        await new Promise(resolve=>setTimeout(resolve,20));
      }
      throw new Error('library validation timeout');
    };
    try{
      await proxy.start(host);
      const code='return 1;',validationRunId=await validate({name:'one',code});
      const saved=JSON.parse(text(await call({library:{op:'save',id:'one',code,parent:null,
        description:'Offline version fixture',conditions:['Syntax fixture only, no gameplay claim'],validationRunId}})));
      expect(saved.persistent).toBe(true);
      await validate({procedure:saved.reference});
      await proxy.stop();
      proxy=new MinecraftWorldProxy({cfg,dataDir:dir,timezone:'UTC',botName:'Fixture'});
      await proxy.start(host);
      expect(JSON.parse(text(await call({library:{op:'read',id:'one'}}))).code).toBe(code);
      await validate({procedure:saved.reference});
      await proxy.stop();
      proxy=new MinecraftWorldProxy({cfg:{...cfg,username:'different-account'},dataDir:dir,timezone:'UTC',botName:'Fixture'});
      await proxy.start(host);
      expect(JSON.parse(text(await call({library:{op:'list'}}))).methods).toEqual([]);
      const missing=await proxy.tools().find(t=>t.name==='mc_script')!.handler({procedure:saved.reference,validate:true},{role:'main',log:host.log});
      expect(missing).toMatchObject({failed:true});
    }finally{await proxy.stop();rmSync(dir,{recursive:true,force:true});}
  },30000);
  it('forks the packaged engine, transfers only selected artifacts and returns original receipt bytes',async()=>{
    const dir=mkdtempSync(join(tmpdir(),'procedure-ipc-')),host=new FakeHost();
    const cfg=structuredClone(MINECRAFT_DEFAULTS) as unknown as MinecraftConfigSection;
    cfg.enabled=true;cfg.host='127.0.0.1';cfg.port=1;cfg.viewerPort=0;cfg.client.enabled=false;
    const proxy=new MinecraftWorldProxy({cfg,dataDir:dir,timezone:'UTC',botName:'Fixture'});
    try{
      const child=procedureFixture('child','return 1;');
      const root=procedureFixture('root',"return await methods.run('child');",{dependencies:{child:procedureRef(child)}});
      const other=procedureFixture('unselected',"return 'private source';"),blobs=fixtureBlobs([root,child,other]),reads:string[]=[];
      host.blob=handle=>{reads.push(handle);return blobs(handle);};
      await proxy.start(host);
      const tool=proxy.tools().find(t=>t.name==='mc_script')!;
      expect(await tool.handler({procedure:procedureRef(root),validate:true},{role:'main',log:host.log})).toMatchObject({execution:{kind:'method',phase:'accepted',goalCompleted:false}});
      const event=await new Promise<(typeof host.events)[number]>((resolve,reject)=>{
        const end=Date.now()+5000;
        const poll=()=>{
          const found=host.events.find(e=>e.type==='minecraft.method'&&e.meta?.procedureReceipt);
          if(found)resolve(found);else if(Date.now()>end)reject(new Error('receipt timeout'));else setTimeout(poll,20);
        };poll();
      });
      const attachment=(event as unknown as Parameters<WorldHost['pushEvent']>[0]).blobs![0];
      expect('bytes' in attachment&&attachment.mime).toBe(PROCEDURE_RECEIPT_MIME);
      const receipt=JSON.parse(Buffer.from((attachment as {bytes:Uint8Array}).bytes).toString('utf8'));
      expect(receipt,JSON.stringify(receipt)).toMatchObject({status:'validated',trace:[],root:procedureRef(root),result:{valid:true,versions:2}});
      expect(reads.sort()).toEqual([procedureRef(root).handle,procedureRef(child).handle].sort());
      expect(JSON.stringify(receipt)).not.toContain('private source');
      expect(await tool.handler({procedure:{...procedureRef(root),revision:'a'.repeat(64)},validate:true},{role:'main',log:host.log}))
        .toMatchObject({failed:true,text:expect.stringContaining('hash mismatch')});
    }finally{await proxy.stop();rmSync(dir,{recursive:true,force:true});}
  },15000);
});
