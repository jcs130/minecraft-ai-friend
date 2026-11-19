// Run "seed" on the stopped disposable world, then "verify" after a cold restart.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {command} from '../../../../ops/rcon-client.mjs';
import {hostedBootstrapClient} from '../../../numen-hosting/src/bootstrap-client.mjs';

const [mode,fixturePath,proofFile]=process.argv.slice(2);
const {lab,ports,maid,owner,synthetic}=JSON.parse(await fs.readFile(fixturePath));
assert(synthetic && maid==='10000000-0000-0000-0000-000000000017' && owner.startsWith('20000000-'));
assert.equal(await fs.readFile(path.join(lab,'.resident-hybrid-qa'),'utf8'),'SYNTHETIC_RESIDENT_HYBRID_ONLY');
const properties=path.join(lab,'server.properties');
assert((await fs.readFile(properties,'utf8')).split(/\r?\n/).includes('rcon.port='+ports[1]) && ports[1]!==25575);
const rc=async text=>(await command(text,8000,{properties,port:ports[1]})).trim();
const leader='10000000-0000-0000-0000-000000000011';
const read=async file=>JSON.parse(await fs.readFile(file));
const write=async (file,value,flag='w')=>fs.writeFile(file,JSON.stringify(value,null,2),{flag});
const data=path.join(lab,'world/data');
const stateFile=path.join(data,'tlm-companion-travel-state',maid+'.json');
const receiptDir=path.join(data,'tlm-companion-travel',maid);
const lookup=async verb=>{
    const message=await rc('maidagent resident '+maid+' '+verb);
    assert(message.startsWith('MC_RESIDENT '),message);
    return JSON.parse(message.slice(12));
};

if(mode==='seed'){
    // ECONNREFUSED is the only acceptable result. An unavailable password or
    // hung socket does not prove that the test server is stopped.
    await assert.rejects(rc('minecraft:list'),e=>e.code==='ECONNREFUSED');
    const file=path.join(lab,'config/tlm-residents.json'),roles=await read(file);
    const role=roles.residents.find(x=>x.maidId===maid);
    assert(role.allies.includes(leader));
    role.expeditionLeader=leader;
    const s=await read(stateFile);
    assert(!s.pending && s.maidId===maid);
    s.pending=randomUUID();
    await write(path.join(receiptDir,s.pending+'.json'),{maidId:maid,requestId:s.pending,leaderId:leader,order:'expedition',status:'accepted',completed:false},'wx');
    await write(stateFile,s);
    await write(file,roles);
    await write(proofFile,{interrupted:s.pending,leader},'wx');
} else if(mode==='verify'){
    const proof=await read(proofFile), original=proof.interrupted;
    const root=path.join(lab,'plugins/numen_hosted/server');
    const {port}=await read(path.join(root,'hosted-bootstrap.json'));
    assert(port>40000 && port<65536);
    const client=hostedBootstrapClient({endpoint:'http://127.0.0.1:'+port+'/v1/hosted-role',controlKey:await fs.readFile(path.join(root,'hosted-model.key'))});
    const role={roleUuid:leader,numenOwnerUuid:'20000000-0000-0000-0000-000000000021',name:'QaKirito',serverId:'qa',ownerId:'qa'};
    assert.equal((await client.admit(role)).roleUuid,leader);
    assert((await rc('execute as '+leader+' if entity @s[name=QaKirito] run data get entity @s UUID')).includes('[I;'));
    await rc('minecraft:execute in minecraft:the_nether run minecraft:tp '+leader+' 315.5 89 296.5');
    const token=(await fs.readFile(path.join(lab,'private/maid.token'),'utf8')).trim();
    const envelope={ownerId:owner,maidId:maid,controllerId:randomUUID()};
    const post=async (operation,extra={})=>{
        const response=await fetch('http://127.0.0.1:'+ports[2]+'/maid-body',{
            method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify({...envelope,operation,...extra})});
        const result=await response.json();assert.equal(response.status,200,result.code);return result;
    };
    envelope.generation=(await post('bind')).generation;
    try{
        const requestId='qa-'+randomUUID();
        const guard=await post('call',{name:'mc_maids',requestId,arguments:{action:'guard',requestId}});
        assert(JSON.parse(guard.result.content[0].text).ok);
        await sleep(7600);
        const fenced=await lookup('status');
        assert.equal(fenced.expedition.pendingTravelRequestId,original);
        assert.equal(fenced.expedition.state,'inspect_original_travel');
        assert.equal(fenced.expedition.leaderDimension,'minecraft:the_nether');
        assert.equal(fenced.dimension,'minecraft:overworld');
        const unknown=await lookup('travel-receipt '+original);
        assert.equal(unknown.status,'unknown'); assert.equal(unknown.completed,false);
        const pos=(await rc('data get entity '+maid+' Pos')).match(/-?\d+(?:\.\d+)?d/g).map(v=>Number(v.slice(0,-1)));
        assert.equal(pos.length,3);
        const review=randomUUID(), evidence={dimension:fenced.dimension,x:pos[0],y:pos[1],z:pos[2],note:'QA verified the original seated body and its dimension.'};
        const inspected=await lookup('travel-inspect '+original+' '+review+' '+JSON.stringify(evidence));
        assert(inspected.completed && !inspected.originalCompleted);
        assert.equal((await lookup('status')).expedition.pendingTravelRequestId,original);
        assert((await lookup('travel-resume '+review)).resumed);
        assert((await lookup('travel-resume '+review)).resumed);
        let reunited;
        for(let i=0;i<90;i++){
            const row=await lookup('status');
            if(row.dimension==='minecraft:the_nether' && row.expedition.distanceBlocks<7){reunited=row;break;}
            await sleep(1000);
        }
        assert(reunited,'new journey to real hosted Numen body');
        const next=reunited.expedition.lastTravelRequestId;
        assert(next && next!==original);
        const result=await lookup('travel-receipt '+next);
        assert(result.completed && result.manaSpent===5 && result.leaderId===leader);
        assert.equal((await lookup('travel-receipt '+original)).status,'unknown');
        await write(proofFile,{...proof,inhibitedBeforeReview:true,originalOutcome:'unknown',newReceipt:next,actual:result.actualPosition,distance:reunited.expedition.distanceBlocks});
        console.log('cold restart preserved uncertainty; inspection did not replay; fresh spell reached the original hosted Numen teammate');
    }finally{await post('release');}
}else{throw Error('expected seed or verify');}
