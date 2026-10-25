import {afterEach,describe,expect,it,vi} from 'vitest';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildReferenceIndex,readReferenceIndex,validateReferenceConfig,MINEDOJO_SOURCE} from '../core/reference-index.ts';
import {queryMinecraftKnowledge,readMinecraftKnowledge} from '../core/knowledge.ts';
import {MinecraftAgentClient,MINECRAFT_CLIENT_DEFAULTS,nullLogger} from '../src/client/index.ts';

const directories:string[]=[];
afterEach(()=>{vi.restoreAllMocks();for(const dir of directories.splice(0))rmSync(dir,{recursive:true,force:true});});
function fixture() {
  const dir=mkdtempSync(join(tmpdir(),'mc-reference-'));directories.push(dir);
  const page=(title:string,text:string,time='2022-04-16 10:11:12')=>{
    const file=join(dir,title.replace(/\W/g,'_')+'.json');
    writeFileSync(file,JSON.stringify({metadata:{url:'https://minecraft.fandom.com/wiki/'+encodeURIComponent(title),title,time},
      texts:[{text:'Synthetic offline reference fixture'},{text},{text}],tables:[],images:[],sprites:[]}));return file;
  };
  const inputs=[page('Bread','Bread is crafted from wheat using a crafting table. It is not a furnace cooking recipe.'),
    page('Fishing Rod','Fishing rods can be cast into water. Wait for a bite before reeling in.'),
    page('Tutorials/Shelters','A shelter provides a place to stay at night. Check the exit and nearby danger.'),
    page('Elytra','Elytra wings allow gliding. These historical notes do not certify current server equipment.')];
  return{dir,inputs,indexFile:join(dir,'wiki.sqlite'),page};
}
async function ready() {const f=fixture();await buildReferenceIndex({inputs:f.inputs,output:f.indexFile});return f;}
const read=(cfg:any,args:any)=>readReferenceIndex(args,{indexFile:cfg.indexFile});

describe('explicit external reference preparation and retrieval',()=>{
  it('keeps default discovery offline, optional and separate from versioned vanilla references',async()=>{
    const network=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('no network'));
    const sources=await queryMinecraftKnowledge({action:'sources'},'auto') as any;
    expect(sources.sources[1]).toMatchObject({id:'minedojo',configured:false,corpusBundled:false,minecraftVersionVerified:false});
    expect(await queryMinecraftKnowledge({source:'minedojo'},'auto')).toMatchObject({status:'not-configured'});
    expect(()=>validateReferenceConfig({minedojo:{indexFile:''}})).not.toThrow();
    expect(await queryMinecraftKnowledge({source:'minedojo'},'auto',{minedojo:{indexFile:''}})).toMatchObject({status:'not-configured'});
    await expect(queryMinecraftKnowledge({source:'minedojo',query:'bread'},'1.21.1')).rejects.toThrow(/not configured/);
    expect(await queryMinecraftKnowledge({id:'recipe/bread'},'1.21.1')).toEqual(readMinecraftKnowledge({id:'recipe/bread'},'1.21.1'));
    expect(network).not.toHaveBeenCalled();
  });
  it('builds a separate read-only index with source hashes, honest version markers and retrievable offsets',async()=>{
    const f=await ready(),before=readFileSync(f.indexFile);
    const result=await read(f,{query:'how to make bread',limit:3}) as any;
    expect(result.entries[0].title).toBe('Bread');expect(result.retrieval).toBe('bm25-cpu-token-vector');
    expect(result.entries[0]).toMatchObject({sourceLicense:MINEDOJO_SOURCE.license,minecraftVersion:null,minecraftVersionVerified:false,currentWorldVerified:false,trustedInstructions:false});
    expect(result.entries[0].annotationSha256).toMatch(/^[a-f0-9]{64}$/);
    const detail=await read(f,{action:'get',id:result.entries[0].id,offset:result.entries[0].offset,length:35}) as any;
    expect(detail.entry.text.length).toBe(35);expect(detail.entry.nextOffset).not.toBeNull();
    expect(readFileSync(f.indexFile)).toEqual(before);
    expect(JSON.parse(readFileSync(f.indexFile+'.manifest.json','utf8'))).toMatchObject({pages:4,lexicalVectorsAreNeural:false});
  });
  it.each(['鱼竿怎么甩杆','how can I cast a fishing rod'])('retrieves across known entity aliases without pretending lexical vectors are neural (%s)',async query=>{
    const f=await ready();const result=await read(f,{query,limit:1}) as any;
    expect(result.entries[0].title).toBe('Fishing Rod');expect(result.lexicalVectorsAreNeural).toBe(false);
    expect(result.neuralModel).toBeNull();expect(result.entries[0].ranking.semanticCosine).toBeNull();
  });
  it('supports actual CPU-vector-only lookup, bounded pages and no-match without indexing personal memory',async()=>{
    const f=await ready();const result=await readReferenceIndex({query:'wheat bread'},{indexFile:f.indexFile,retrieval:'local-vector'}) as any;
    expect(result.entries[0].title).toBe('Bread');expect(result.entries[0].ranking.tokenCosine).toBeGreaterThan(0);
    expect(result.retrieval).toBe('cpu-token-vector');
    expect(result.entries[0].ranking.lexical).toBe(0);
    expect((await read(f,{query:'qzxv987654321'}) as any).entries).toEqual([]);
    const first=await read(f,{query:'historical shelter wheat',limit:1}) as any;
    if(first.nextOffset!==null){const next=await read(f,{query:'historical shelter wheat',limit:1,offset:first.nextOffset}) as any;expect(next.entries[0].id).not.toBe(first.entries[0].id);}
    expect(readdirSync(f.dir).some(name=>/memory|session|credential/.test(name))).toBe(false);
  });
  it('refuses overwrite, conflicting source snapshots, unexpected URLs and invalid table shapes',async()=>{
    const f=await ready();await expect(buildReferenceIndex({inputs:f.inputs,output:f.indexFile})).rejects.toThrow(/overwrite/);
    const raw=JSON.parse(readFileSync(f.inputs[0],'utf8')),conflict=join(f.dir,'conflict.json');raw.texts.push({text:'conflicting revision'});writeFileSync(conflict,JSON.stringify(raw));
    await expect(buildReferenceIndex({inputs:[f.inputs[0],conflict],output:join(f.dir,'conflict.sqlite')})).rejects.toThrow(/Conflicting/);
    raw.metadata.url='https://user:secret@localhost/private';writeFileSync(conflict,JSON.stringify(raw));
    await expect(buildReferenceIndex({inputs:[conflict],output:join(f.dir,'bad.sqlite')})).rejects.toThrow(/source/);
    raw.metadata.url='https://minecraft.fandom.com/wiki/Bread';raw.tables=[{bbox:[0,1,2,3],cells:{text:['value']}}];writeFileSync(conflict,JSON.stringify(raw));
    await expect(buildReferenceIndex({inputs:[conflict],output:join(f.dir,'bad-table.sqlite')})).rejects.toThrow(/table/);
  });
  it('rejects malformed bounded requests, invalid indexes and unknown source actions',async()=>{
    const f=await ready();
    for(const args of [{query:''},{query:'x'.repeat(201)},{query:'bread',limit:11},{query:'bread',offset:-1},{action:'get',id:'../../secret'}])await expect(read(f,args)).rejects.toThrow();
    for(const args of [{source:'minedojo',action:'remember',query:'bread'},{source:'minedojo',query:'bread',command:'execute'},{source:'other'}])await expect(queryMinecraftKnowledge(args,'1.21.1',{minedojo:{indexFile:f.indexFile}})).rejects.toThrow();
    await expect(readReferenceIndex({query:'bread'},{indexFile:join(f.dir,'missing.sqlite')})).rejects.toThrow(/missing/);
    expect(()=>validateReferenceConfig({minedojo:{indexFile:'relative.sqlite'}})).toThrow(/absolute/);
    const controller=new AbortController();controller.abort();await expect(readReferenceIndex({query:'bread'},{indexFile:f.indexFile},controller.signal)).rejects.toThrow();
  });
  it('can use an explicitly prepared neural index and reports model mismatch or failure as a local fallback',async()=>{
    const f=fixture(),embeddings={endpoint:'http://127.0.0.1:12345/embeddings',model:'fixture-semantic-model'};
    const request=vi.fn(async(_url:any,options:any)=>{
      const inputs=JSON.parse(options.body).input as string[];
      return Response.json({data:inputs.map((text,index)=>({index,embedding:/fishing|cast|甩|线/.test(text)?[1,0,0]:/Bread|bread|wheat/.test(text)?[0,1,0]:[0,0,1]}))});
    }) as any;
    await buildReferenceIndex({inputs:f.inputs,output:f.indexFile,embeddings},undefined,request);
    const result=await readReferenceIndex({query:'把线甩出去',limit:1},{indexFile:f.indexFile,embeddings,retrieval:'semantic'},undefined,request) as any;
    expect(result.entries[0].title).toBe('Fishing Rod');expect(result.retrieval).toBe('neural-hybrid');expect(result.neuralModel).toBe(embeddings.model);
    const failure=vi.fn().mockRejectedValue(Error('private upstream message'));
    const degraded=await readReferenceIndex({query:'bread'},{indexFile:f.indexFile,embeddings,retrieval:'semantic'},undefined,failure) as any;
    expect(degraded.degraded).toMatch(/failed/);expect(degraded.entries[0].title).toBe('Bread');expect(JSON.stringify(degraded)).not.toContain('private upstream');
    const mismatch=await readReferenceIndex({query:'bread'},{indexFile:f.indexFile,embeddings:{...embeddings,model:'other'},retrieval:'semantic'},undefined,request) as any;
    expect(mismatch.neuralModel).toBeNull();expect(mismatch.degraded).toMatch(/not-configured/);
  });
  it('the disconnected public SDK retrieves external references without a body, model call or personal-note write',async()=>{
    const f=await ready(),start=vi.fn(),dataDir=join(f.dir,'agent');
    const cfg={...structuredClone(MINECRAFT_CLIENT_DEFAULTS),knowledge:{minedojo:{indexFile:f.indexFile}}};
    const client=new MinecraftAgentClient({cfg,dataDir,log:nullLogger()},{id:'offline-reference',start,stop:vi.fn(),tools:()=>[],envPromptVars:()=>({})});
    try {const result=await client.call('mc_knowledge',{source:'minedojo',query:'bread',limit:1});
      expect(JSON.parse(result.text).entries[0].title).toBe('Bread');expect(start).not.toHaveBeenCalled();expect(client.status().phase).toBe('disconnected');
    } finally {await client.disconnect();}
  });
  it('cancellation closes an in-flight embeddings read without a second request or silent fallback',async()=>{
    const f=fixture(),embeddings={endpoint:'http://127.0.0.1:12345/embeddings',model:'fixture-cancel'};
    const prepared=vi.fn(async(_url:any,options:any)=>Response.json({data:JSON.parse(options.body).input.map((_:string,index:number)=>({index,embedding:[1,0]}))})) as any;
    await buildReferenceIndex({inputs:f.inputs,output:f.indexFile,embeddings},undefined,prepared);
    const controller=new AbortController();let started!:()=>void;const dispatched=new Promise<void>(done=>{started=done;});
    const pending=vi.fn((_url:any,options:any)=>new Promise((_done,fail)=>{started();options.signal.addEventListener('abort',()=>fail(Error('fixture cancelled')),{once:true});})) as any;
    const request=readReferenceIndex({query:'bread'},{indexFile:f.indexFile,embeddings,retrieval:'semantic'},controller.signal,pending);
    await dispatched;controller.abort();await expect(request).rejects.toThrow(/cancelled/);expect(pending).toHaveBeenCalledTimes(1);
  });
  it('malformed embedding batches reject preparation and do not leave a usable partial index',async()=>{
    const f=fixture(),embeddings={endpoint:'http://127.0.0.1:12345/embeddings',model:'fixture-invalid'};
    const broken=vi.fn(async()=>Response.json({data:[{index:7,embedding:[1,0]}]})) as any;
    await expect(buildReferenceIndex({inputs:f.inputs,output:f.indexFile,embeddings},undefined,broken)).rejects.toThrow(/index/);
    expect(readdirSync(f.dir).some(name=>name.endsWith('.sqlite')||name.endsWith('.tmp'))).toBe(false);
  });
});
