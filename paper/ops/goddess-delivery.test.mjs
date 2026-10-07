import assert from 'node:assert/strict';
import test from 'node:test';
import { deliverGift } from './goddess-delivery.mjs';
const request = '0123456789abcdef', hash = 'a'.repeat(64);
const recipe = { gift:'mending_book', item:'minecraft:enchanted_book', maxAmount:4, hash };
const decision = { decision:'approve',gift:'mending_book',amount:2 };
const receipt = { ok:true,phase:'verified',request,player:'BookAudit',selection:'gift:mending_book',
  item:'minecraft:enchanted_book',amount:2,before:0,after:2,recipeHash:hash };
function server(answers = {}) {
  const commands = [];
  return { commands, send: async command => {
    commands.push(command);
    if(command==='mycli admin giftcatalog')return 'MC_GIFT_CATALOG '+JSON.stringify({schema:1,ready:true,gifts:{mending_book:recipe}});
    if(command.startsWith('mycli admin giftstatus'))return 'MC_GIFT_RESULT '+JSON.stringify(answers.status??receipt);
    return 'MC_GIFT_RESULT '+JSON.stringify(answers.grant??receipt);
  }};
}
test('success requires an authoritative item and quantity receipt after delivery', async () => {
  const testServer=server();
  assert.equal((await deliverGift('BookAudit',decision,request,testServer.send)).ok,true);
  assert.equal(testServer.commands.length,3);
  for(const status of [{...receipt,after:1},{...receipt,phase:'prepared'},{...receipt,item:'minecraft:stone'},{...receipt,player:'Other'}, {...receipt,request:'1111111111111111'}])
    await assert.rejects(deliverGift('BookAudit',decision,request,server({status}).send));
});
test('preview sends no grant, invalid counts send no grant, failure never retries', async () => {
  const preview=server(); assert.equal((await deliverGift('BookAudit',decision,request,preview.send,true)).dryRun,true);
  assert.equal(preview.commands.length,1);
  const tooMany=server(); await assert.rejects(deliverGift('BookAudit',{...decision,amount:5},request,tooMany.send));
  assert.equal(tooMany.commands.length,1);
  const failed=server({grant:{ok:false,request,reason:'inventory'}});
  assert.equal((await deliverGift('BookAudit',decision,request,failed.send)).reason,'inventory');
  assert.equal(failed.commands.length,2);
  await assert.rejects(deliverGift('BookAudit',decision,request,async()=> 'QDJ-GIFT 0123456789abcdef OK'));
});
test('timeout reads the original receipt and never resends a grant', async () => {
  for (const phase of ['verified', 'prepared', 'missing']) {
    const testServer = server({status: {...receipt,phase,ok:phase==='verified'}});
    const send = async command => {
      if (command.startsWith('mycli admin gift ')) {
        testServer.commands.push(command);
        throw new Error('connection timeout');
      }
      return testServer.send(command);
    };
    const result = await deliverGift('BookAudit',decision,request,send);
    assert.equal(result.ok,phase==='verified');
    if (result.ok) assert.equal(result.recovered,true);
    else assert.equal(result.reason,'uncertain');
    assert.equal(testServer.commands.filter(c=>c.startsWith('mycli admin gift ')).length,1);
    assert.equal(testServer.commands.at(-1),`mycli admin giftstatus ${request}`);
  }
});
test('a changed preset between model selection and delivery cannot issue a different gift', async () => {
  const testServer = server();
  await assert.rejects(deliverGift('BookAudit',decision,request,testServer.send,false,'b'.repeat(64)),/changed after approval/);
  assert.equal(testServer.commands.length,1);
});
