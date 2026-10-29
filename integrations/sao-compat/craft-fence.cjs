'use strict'
const REASON='forge_native_recipe_catalog_unavailable'
function blockedCraft(steps){return Array.isArray(steps)&&steps.some(step=>step?.skill==='craft')}
function craftFenceDeclaration(declaration){
 return {...declaration,
  description:declaration.description+' SAO Forge: automatic skill:"craft" is UNAVAILABLE until the native recipe catalog is implemented. It is excluded by this transport schema. Never use vanilla recipe IDs; query mc_native capabilities. Other skills keep the original contract.',
  parameters:{...structuredClone(declaration.parameters),allOf:[...(declaration.parameters.allOf??[]),{not:{type:'object',required:['steps'],properties:{steps:{type:'array',contains:{type:'object',properties:{skill:{const:'craft'}},required:['skill']}}}}}]}}
}
function fenceVanillaRecipes(bot){
 bot.recipesFor=bot.recipesAll=()=>{throw Error(REASON)}
 bot.craft=async()=>{throw Error(REASON)}
}
function unavailableCraft(){return {failed:true,text:JSON.stringify({status:'unavailable',reason:REASON,completed:0,remaining:'not_dispatched',retryable:false,next_safe_read:{tool:'mc_native',arguments:{section:'capabilities'}},goal_completed:false}),data:{status:'unavailable',reason:REASON,completed:0,retryable:false,goal_completed:false}}}
module.exports={blockedCraft,craftFenceDeclaration,fenceVanillaRecipes,unavailableCraft,REASON}
