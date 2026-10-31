/** Explicit, unpaid integration demo. Requires built/packed core and the pinned Google worker. */
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Harness2Runner,createHarness2Monitor,HARNESS2_REVISION} from 'agent-mc-world/decisions';
import {createCraftingMethodPractice,craftingCandidate,CRAFTING_ENVIRONMENT} from 'agent-mc-world/learning';

const config=JSON.parse(readFileSync(new URL('./harness2-crafting.json',import.meta.url),'utf8'));
export function createCraftingExperiment({directory,worker,model,id='crafting-v1'}){
  const practice=createCraftingMethodPractice({directory:join(directory,'practice'),
    binding:{instanceId:'offline-crafting-lab',realm:'recipe-stock-lab',account:'fixture',agent:'crafting',isolated:true}});
  const job={id,methodId:'crafting-pickaxe',sourceInstanceId:'reference-policy-no-online-body',
    scope:{realm:'reference-policy',account:'fixture',agent:'crafting'},
    task:'Acquire one NEW wooden_pickaxe at an already available workbench. Only params.json may change: wood is oak/birch/spruce/observed; logs is an integer 1..4. The immutable driver reads current resources, collects logs, crafts logs*4 planks, four sticks, then one pickaxe; it stops on a blocked action. Use observed receipts and net inventory changes. Do not change run.js, SKILL.md, recipes, fixtures, evaluator or budgets. Offline stock/recipe fixture; no movement, damage, server or live-survival claim.',
    baseline:craftingCandidate(config.baselineParams),train:practice.fixtures[0],holdout:practice.fixtures.slice(1),
    objective:config.objective,mode:config.mode,k:config.k,budget:config.budget};
  // Final validation occurs in the guarded practice port, independently of model compliance.
  const boundedModel={id:model.id,async generate(request,signal){
    const reply=await model.generate(request,signal);
    if(reply.files&&Object.keys(reply.files).some(p=>!config.editable.includes(p)))throw Error('Only params.json is editable for this experiment');
    return reply;
  }};
  const jobsDirectory=join(directory,'jobs'),runner=new Harness2Runner({directory:jobsDirectory,worker,model:boundedModel,practice:practice.executor});
  return {runner,job,practice,monitor:createHarness2Monitor({directory:jobsDirectory,jobs:[job],enabled:false})};
}

/** Scripted proposal fixture, NOT evidence that an LLM discovered this policy. */
export function scriptedCraftingModel(){
  const stages=[];
  return {id:'scripted-crafting-params/v1',stages,async generate(request,signal){
    signal.throwIfAborted();stages.push(request.stage);
    if(/holdout-birch|holdout-spruce-existing/.test(JSON.stringify(request)))throw Error('Held-out identity leaked into a model request');
    if(request.stage.startsWith('select.'))return {choice:Object.keys(request.files).find(p=>/^candidates\/[A-Z]+\.md$/.test(p)).split('/').at(-1).replace('.md','')};
    if(request.stage.startsWith('experience.'))return {experience:{cue:'Insufficient recipe inputs at an existing workbench',
      lesson:'Use observed wood and collect sufficient stock before this fixed craft sequence.',
      evidence:'Only deterministic recipe/stock executions were observed; the proposal was scripted.',
      confidence:'No real model, server, navigation, survival or generalization evidence.'}};
    return {files:{'skills/minecraft-method/scripts/params.json':JSON.stringify({wood:'observed',logs:2})},
      usage:{inputTokens:null,outputTokens:null,cachedTokens:null}};
  }};
}

export function craftingReport(experiment,result,model){
  if(model.id!=='scripted-crafting-params/v1')throw Error('This report format is only for the scripted fixture; real models need their own usage receipts');
  const rows=result.evidenceRefs.map(id=>{
    const evidence=experiment.practice.evidence(id),trial=evidence.trial;
    const fixture=[experiment.job.train,...experiment.job.holdout].find(f=>f.id===trial.caseId);
    return {trialId:id,executionId:trial.executionId,caseId:trial.caseId,
      role:trial.candidateHash===experiment.practice.evidence(result.evidenceRefs[0]).trial.candidateHash?'baseline':'candidate',
      assessment:experiment.practice.assess(trial,fixture),actionSteps:evidence.actionSteps,failedActions:evidence.failedActions,
      sdkCalls:trial.sdkCalls,reference:trial.reference,reviewId:trial.reviewId};
  });
  return {schema:'agent-mc.crafting-report/v1',evidenceKind:'deterministic-recipe-stock',
    upstreamRevision:HARNESS2_REVISION,environment:CRAFTING_ENVIRONMENT,modelId:model.id,config,
    fixtures:experiment.practice.fixtures,job:experiment.job,result,rows,
    costs:{scriptedOptimizerCalls:result.modelCalls,realModelApiCalls:0,taskModelCalls:0,
      inputTokens:result.optimizationUsage?.inputTokens??null,outputTokens:result.optimizationUsage?.outputTokens??null,costUsd:null},
    stages:model.stages??null,adopted:false,liveAgentModified:false,
    limitations:['Scripted proposal against a new reference baseline; not a current Agent A/B test.',
      'Actual core sandbox/MethodLibrary executions with deterministic stock transitions, not a running Minecraft server.',
      'Workbench, reach, collection and health are fixture assumptions. No navigation, hazards, combat, mods or latency.',
      'Held-out fixture identities never enter model requests. Passing these fixtures is not general survival improvement.']};
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const [mode,workerFile,destination,id]=process.argv.slice(2);
  if(mode!=='--scripted'||!workerFile||!destination||!id)throw Error('Usage: node examples/harness2-crafting.mjs --scripted worker.json NEW-evidence-directory UNIQUE-job-id');
  const directory=resolve(destination);mkdirSync(directory,{recursive:true});
  const model=scriptedCraftingModel(),experiment=createCraftingExperiment({directory,worker:JSON.parse(readFileSync(workerFile,'utf8')),model,id});
  const controller=new AbortController();process.once('SIGINT',()=>controller.abort());
  const result=await experiment.runner.run(experiment.job,controller.signal),reportFile=join(directory,'report.json');
  const report=existsSync(reportFile)?JSON.parse(readFileSync(reportFile,'utf8')):craftingReport(experiment,result,model);
  if(report.result.jobHash!==result.jobHash)throw Error('Existing report belongs to a different run; preserve it');
  if(!existsSync(reportFile))writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
  writeFileSync(join(directory,'monitor.json'),JSON.stringify(experiment.monitor.snapshot(),null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({evidenceKind:report.evidenceKind,gate:result.gate,modelCalls:result.modelCalls,trials:result.trials,
    rows:report.rows.map(({caseId,role,assessment,actionSteps,failedActions,sdkCalls})=>({caseId,role,achieved:assessment.achieved,actionSteps,failedActions,sdkCalls})),
    thisInvocationModelCalls:model.stages.length,realModelApiCalls:0,adopted:false,report:reportFile},null,2));
}
