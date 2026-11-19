import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {command} from '../../../ops/rcon-client.mjs';

const stage=process.env.INVENTORY_BATCH_STAGE, report=process.env.INVENTORY_BATCH_REPORT;
assert.equal(await readFile(stage+'/.inventory-quick-qa','utf8'),'SYNTHETIC_INVENTORY_QUICK_ONLY');
const settings=(await readFile(stage+'/server.properties','utf8')).split(/\r?\n/);
assert(settings.includes('server-ip=127.0.0.1')&&settings.includes('rcon.port=26985'));
const endpoint='http://127.0.0.1:26986/maid-body';
const token=(await readFile(stage+'/private-inventory-fixture.token','utf8')).trim();
const maid='10000000-0000-0000-0000-000000000014';
const envelope={ownerId:'20000000-0000-0000-0000-000000000014',maidId:maid,controllerId:randomUUID()};
const checks=[];
async function post(operation,args={}) {
    const response=await fetch(endpoint,{method:'POST',headers:{Authorization:'Bearer '+token},
        body:JSON.stringify({...envelope,operation,...args})});
    const row=await response.json();assert.equal(response.status,200,row.code);return row;
}
function check(label,value){assert(value,label);checks.push(label);console.log('PASS',label);}
async function call(action,requestId,extra={}) {
    const args={action,maidId:maid,...extra};
    if(requestId)args.requestId=requestId;
    const row=await post('call',{name:'mc_maids',...(requestId?{requestId}:{}),arguments:args});
    return JSON.parse(row.result.content[0].text);
}
const description=await post('bind');
envelope.generation=description.generation;
try {
    check('unified native body publishes three real actions', ['bag_clean','bag_store','bag_donate'].every(key=>
        description.tools[0].inputSchema.properties.action.enum.includes(key)));
    for (const action of ['bag_clean','bag_store','bag_donate']) {
        const request='qa-'+randomUUID();
        const preview=await call(action,request,{dryRun:true});
        const inner=preview.data?.observation?.inventoryReceipt;
        check('original native body previews '+action,preview.ok && inner?.playerUuid===maid && inner?.dryRun===true && !preview.data.goalCompleted);
        const again=await call(action,request,{dryRun:true});
        check('original request replay returns the same '+action+' receipt',JSON.stringify(again.data)===JSON.stringify(preview.data));
    }
    const rc=s=>command(s,15000,{properties:stage+'/server.properties',port:26985});
    // Only the synthetic registered maid may be seeded. Its normal body port performs the transfer.
    const inventory=await rc('minecraft:data get entity '+maid+' MaidInventory');
    assert(inventory.includes('['),'original native bag is not loaded: '+inventory.slice(0,120));
    const before=await call('inventory');
    const used=new Set((before.data.items||[]).map(row=>row.slot));
    const slot=before.data.usableSlotIndexes?.find(i=>!used.has(i));
    assert(Number.isInteger(slot),'synthetic bag has no spare slot');
    const seed='{Slot:'+slot+',id:"minecraft:string",count:13}';
    await rc('minecraft:data modify entity '+maid+' MaidInventory.Items append value '+seed);
    assert((await rc('minecraft:data get entity '+maid+' MaidInventory.Items[{Slot:'+slot+',id:"minecraft:string"}].count')).includes('13'));
    const request='qa-'+randomUUID();
    const actual=await call('bag_store',request);
    const inner=actual.data?.observation?.inventoryReceipt;
    check('native bag sends the synthetic string into its own personal box',actual.ok && inner?.items?.['minecraft:string']>=13 && inner.moved>=13);
    const repeat=await call('bag_store',request);
    check('native repeated write returns the unmodified transfer receipt',JSON.stringify(repeat.data)===JSON.stringify(actual.data));
} finally {
    await post('release');await writeFile(report,JSON.stringify({checks,syntheticOnly:true},null,2));
}

