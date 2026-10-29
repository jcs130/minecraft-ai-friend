'use strict'
const {test}=require('node:test'),assert=require('node:assert/strict')
const {blockedCraft,craftFenceDeclaration,fenceVanillaRecipes,unavailableCraft,REASON}=require('../craft-fence.cjs')
test('rejects an unsupported craft batch before any preceding movement can be dispatched',()=>{
 const steps=[{skill:'goto',at:[1,64,1]},{skill:'craft',item:'oak_planks',count:16}];const before=structuredClone(steps);assert.equal(blockedCraft(steps),true);assert.deepEqual(steps,before);const out=unavailableCraft();assert.equal(out.failed,true);assert.equal(JSON.parse(out.text).completed,0);assert.equal(JSON.parse(out.text).remaining,'not_dispatched')
})
test('keeps supported skills and does not guess or rewrite malformed inputs',()=>{
 assert.equal(blockedCraft([{skill:'eat',item:'bread'},{skill:'goto',at:[1,64,1]}]),false);assert.equal(blockedCraft(undefined),false);assert.equal(blockedCraft([{skill:'crafting'}]),false)
})
test('publishes the transport restriction without mutating the shared core declaration',()=>{
 const base={name:'mc_do',tags:['act'],description:'Queue actions.',parameters:{type:'object',properties:{steps:{type:'array'}}}};const before=structuredClone(base),result=craftFenceDeclaration(base);assert.deepEqual(base,before);assert.equal(result.parameters.type,'object');assert.equal(result.parameters.allOf.at(-1).not.properties.steps.contains.properties.skill.const,'craft');assert.match(result.description,/UNAVAILABLE/);assert.deepEqual(result.tags,['act'])
})
test('fences vanilla helpers again after the core has installed its normal plugin fixes',async()=>{
 let calls=0;const bot={craft:async()=>calls++,recipesFor:()=>calls++};fenceVanillaRecipes(bot);assert.throws(()=>bot.recipesFor(),new RegExp(REASON));await assert.rejects(bot.craft(),new RegExp(REASON));assert.equal(calls,0)
})
