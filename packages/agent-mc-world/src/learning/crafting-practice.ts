/** Deterministic recipe/stock fixture. Executes core methods; never connects to a server. */
import {createRequire} from 'node:module';
import {mkdirSync,readFileSync,writeFileSync,renameSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {MethodLibrary} from '../../core/method-library.ts';
import {procedureHash} from '../../core/support/procedure.ts';
import {MethodPracticeExecutor,PracticeUnknownEffect,assessPracticeTrial,validatePracticeCandidate,
  type PracticeBinding,type PracticeCandidate,type PracticeCase,type PracticeExecutionPort,type PracticeTrial} from './practice.ts';

const require=createRequire(import.meta.url);
const data=require('minecraft-data')('1.21.1');
const woods=['oak','birch','spruce'] as const;
const items=[...woods.flatMap(w=>[`${w}_log`,`${w}_planks`]),'stick','crafting_table','wooden_pickaxe'];
const recipes=Object.fromEntries(items.filter(i=>!i.endsWith('_log')).map(i=>[i,data.recipes[data.itemsByName[i].id]]));
export const CRAFTING_ENVIRONMENT=`java-1.21.1/recipe-stock-v1/${procedureHash(recipes).slice(0,16)}`;
export const CRAFTING_GUIDANCE='Acquire one NEW wooden pickaxe at an existing workbench. Offline recipe/stock evidence only; no live survival claim.';
/** Trusted driver is immutable. Candidate parameters only select wood and bounded stock. */
export const CRAFTING_CODE=`const state = await mc.state();
const wood = params.wood === 'observed' ? state.resources[0] : params.wood;
if (!wood) return {stopped: 'no observed logs'};
for (const step of [
  {skill:'collect',block:wood+'_log',count:params.logs},
  {skill:'craft',item:wood+'_planks',count:params.logs*4},
  {skill:'craft',item:'stick',count:4},
  {skill:'craft',item:'wooden_pickaxe',count:1}
]) {
  const receipt = await mc.do([step]);
  if (receipt.steps[0].outcome !== 'done') return {stopped:'action blocked'};
}
return {attempted:true};`;

export function craftingCandidate(params:{wood:'oak'|'birch'|'spruce'|'observed';logs:number}):PracticeCandidate {
  const candidate={code:CRAFTING_CODE,params:{...params},guidance:CRAFTING_GUIDANCE};
  validateCraftingCandidate(candidate);return candidate;
}
export function validateCraftingCandidate(candidate:PracticeCandidate):void {
  validatePracticeCandidate(candidate);
  if(candidate.code!==CRAFTING_CODE||candidate.guidance!==CRAFTING_GUIDANCE
    ||Object.keys(candidate.params).sort().join(',')!=='logs,wood'
    ||typeof candidate.params.wood!=='string'||!['oak','birch','spruce','observed'].includes(candidate.params.wood)
    ||!Number.isInteger(candidate.params.logs)||Number(candidate.params.logs)<1||Number(candidate.params.logs)>4)
    throw Error('Crafting experiment permits only wood and logs parameters; driver, guidance and limits are immutable');
}
/** Reusable guard for this experiment, also in front of an explicitly supplied real practice port. */
export function guardCraftingPractice(executor:PracticeExecutionPort):PracticeExecutionPort {
  const binding=structuredClone(executor.binding);
  return {binding,async execute(request,signal){
    validateCraftingCandidate(request.candidate);
    return executor.execute(structuredClone(request),signal);
  }};
}
interface StockCase extends PracticeCase { wood:typeof woods[number]; logs:number; existingPickaxes:number }
export function craftingFixtures():StockCase[] {
  return [
    {id:'train-oak',wood:'oak' as const,logs:4,existingPickaxes:0},
    {id:'holdout-birch',wood:'birch' as const,logs:3,existingPickaxes:0},
    {id:'holdout-spruce-existing',wood:'spruce' as const,logs:2,existingPickaxes:1},
  ].map(f=>({...f,snapshotId:`recipe-stock-v1-${f.id}`,environmentVersion:CRAFTING_ENVIRONMENT,
    goal:{kind:'inventory-gain' as const,item:'wooden_pickaxe',count:1,maxHealthLoss:0}}));
}
export interface CraftingAction {
  step:number;skill:'collect'|'craft';item:string;requested:number;
  outcome:'done'|'blocked';reason:string;inventory:Record<string,number>;
}
export interface CraftingEvidence {
  schema:'agent-mc.crafting-fixture/v1';evidenceKind:'deterministic-recipe-stock';
  requestHash:string;trial:PracticeTrial;actions:CraftingAction[];
  actionSteps:number;failedActions:number;modelCalls:0;inputTokens:null;outputTokens:null;costUsd:null;
}

export function createCraftingMethodPractice(options:{directory:string;binding:PracticeBinding}) {
  const directory=resolve(options.directory),binding=structuredClone(options.binding),fixtures=craftingFixtures();
  if(binding.isolated!==true)throw Error('Dedicated isolated fixture required');
  mkdirSync(directory,{recursive:true});
  const library=new MethodLibrary(join(directory,'methods')),evidenceDirectory=join(directory,'trials');
  mkdirSync(evidenceDirectory,{recursive:true});
  // An unresolved dispatch survives a process restart and blocks ALL new trial IDs.
  const activeFile=join(directory,'active.json');
  let inventory:Record<string,number>={},stock:Record<string,number>={},actions:CraftingAction[]=[],resets=0,busy=false;
  const write=(file:string,value:unknown)=>{
    const temp=join(directory,`${randomUUID()}.tmp`);
    writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});renameSync(temp,file);
  };
  const executor=new MethodPracticeExecutor({binding,library,
    reset:async fixture=>{
      const known=fixtures.find(f=>procedureHash(f)===procedureHash(fixture));
      if(!known)throw Error('Unknown or changed fixed crafting fixture');
      inventory=Object.fromEntries(items.map(i=>[i,i==='wooden_pickaxe'?known.existingPickaxes:0]));
      stock=Object.fromEntries(woods.map(w=>[w,w===known.wood?known.logs:0]));actions=[];resets++;
    },
    observe:async fixture=>({at:Date.now(),instanceId:binding.instanceId,snapshotId:fixture.snapshotId,
      environmentVersion:fixture.environmentVersion,dimension:'overworld',position:{x:0,y:64,z:0},
      health:20,inventory:structuredClone(inventory)}),
    host:{nativeMethods:[],call:async(method,args,signal)=>{
      signal.throwIfAborted();
      if(method==='state')return {resources:woods.filter(w=>stock[w]>0),snapshot:{inventory:structuredClone(inventory),health:20}};
      if(method!=='do'||!Array.isArray(args.steps)||args.steps.length!==1)throw Error('Fixture supports one bounded collect/craft action per SDK call');
      if(actions.length>=4)throw Error('Immutable action budget exhausted');
      const step=args.steps[0] as Record<string,unknown>,requested=Number(step.count);
      if(!Number.isSafeInteger(requested)||requested<1||requested>16)throw Error('Invalid stock action');
      let reason='unsupported-action',done=false,item=String(step.block??step.item);
      if(step.skill==='collect'&&woods.some(w=>item===`${w}_log`)){
        const wood=item.replace('_log','');
        if(stock[wood]>=requested){stock[wood]-=requested;inventory[item]+=requested;done=true;reason='observed-stock-collected';}
        else reason='insufficient-visible-logs';
      }else if(step.skill==='craft'&&Object.hasOwn(recipes,item)){
        // Use the installed, pinned Minecraft recipe data; count means NEW output units.
        for(const recipe of recipes[item] as any[]){
          const ids=(recipe.ingredients??recipe.inShape.flat()).filter((id:unknown)=>id!==null);
          const batches=Math.ceil(requested/recipe.result.count),needed:Record<string,number>={};
          for(const id of ids){const name=data.items[id].name;needed[name]=(needed[name]??0)+batches;}
          if(Object.entries(needed).every(([name,n])=>inventory[name]>=n)){
            for(const [name,n] of Object.entries(needed))inventory[name]-=n;
            inventory[item]+=batches*recipe.result.count;done=true;reason='recipe-output-observed';break;
          }
        }
        if(!done)reason='insufficient-recipe-inputs';
      }else throw Error('Action outside the trusted fixture contract');
      actions.push({step:actions.length+1,skill:step.skill as CraftingAction['skill'],item,requested,
        outcome:done?'done':'blocked',reason,inventory:structuredClone(inventory)});
      return {done:true,steps:[{outcome:done?'done':'blocked',why:reason}]};
    }},
    // Synchronous stock transitions have no outstanding keys, task or transport after return.
    settle:async()=> 'settled',
  });
  const guarded=guardCraftingPractice(executor);
  const port:PracticeExecutionPort={binding:structuredClone(binding),async execute(original,signal){
    const request=structuredClone(original);
    validateCraftingCandidate(request.candidate);signal.throwIfAborted();
    if(!/^[A-Za-z0-9_-]{1,100}$/.test(request.trialId)||!fixtures.some(f=>procedureHash(f)===procedureHash(request.fixture)))throw Error('Unknown trial or changed fixture');
    if(busy)throw new PracticeUnknownEffect();
    const requestHash=procedureHash({...request,binding}),file=join(evidenceDirectory,`${request.trialId}.json`);
    if(existsSync(activeFile)){
      const active=JSON.parse(readFileSync(activeFile,'utf8'));
      if(active.status!=='settled')throw new PracticeUnknownEffect();
    }
    if(existsSync(file)){
      const old=JSON.parse(readFileSync(file,'utf8')) as CraftingEvidence;
      if(old.requestHash!==requestHash)throw Error('Original trial identity changed');
      return structuredClone(old.trial);
    }
    busy=true;
    write(activeFile,{status:'pending',trialId:request.trialId,requestHash});
    try{
      const trial=await guarded.execute(request,signal);
      const evidence:CraftingEvidence={schema:'agent-mc.crafting-fixture/v1',evidenceKind:'deterministic-recipe-stock',
        requestHash,trial,actions:structuredClone(actions),actionSteps:actions.length,
        failedActions:actions.filter(a=>a.outcome==='blocked').length,modelCalls:0,inputTokens:null,outputTokens:null,costUsd:null};
      write(file,evidence);write(activeFile,{status:'settled',trialId:request.trialId,requestHash});
      return structuredClone(trial);
    }finally{busy=false;}
  }};
  return {executor:port,library,fixtures:structuredClone(fixtures),
    evidence(trialId:string):CraftingEvidence {
      if(!/^[A-Za-z0-9_-]{1,100}$/.test(trialId))throw Error('Invalid trial ID');
      return JSON.parse(readFileSync(join(evidenceDirectory,`${trialId}.json`),'utf8'));
    },
    stats:()=>({resets}),assess:(trial:PracticeTrial,fixture:PracticeCase)=>assessPracticeTrial(trial,fixture,binding)};
}
