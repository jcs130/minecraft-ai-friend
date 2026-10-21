/** Read-only distribution and tool-contract smoke. Never connects to Minecraft or invokes a model. */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(process.argv[2] || resolve(repo, 'packages/agent-mc-world'));
const report = { schemaVersion: 1, scope: 'mineflayer-work-package', checks: {}, modelRequests: 0, worldActions: 0,
  liveGameplayVerified: false, supervisedBy: 'owning-agent-mc-world-method-runner; no-new-daemon' };
const check = (name, value) => { report.checks[name] = !!value; };
try {
  const module = await import(pathToFileURL(resolve(root,'dist/runtime/core/work-routines.js')).href);
  const { MethodRunner } = await import(pathToFileURL(resolve(root,'dist/runtime/core/method-runner.js')).href);
  const { MINECRAFT_TOOL_DECLS } = await import(pathToFileURL(resolve(root,'dist/runtime/core/world.js')).href);
  const { NATIVE_API } = await import(pathToFileURL(resolve(root,'dist/runtime/core/method-mineflayer.js')).href);
  const { SKILL_NAMES } = await import(pathToFileURL(resolve(root,'dist/runtime/core/skills.js')).href);
  const { methodApiHelp } = await import(pathToFileURL(resolve(root,'dist/runtime/core/method-api.js')).href);
  check('native-mobility-apis',['elytraFly','mount','dismount','moveVehicle'].every(id=>typeof NATIVE_API[id]==='string'));
  check('swim-skill-registered',SKILL_NAMES.includes('swim'));
  check('swim-plan-sdk-help',methodApiHelp('mc.swimPlan').includes('oxygen'));
  const ids = ['farm_harvest','gather_logs','deposit_surplus','restock','navigate_route','swim_to','flight_route','swim_route','ride_route','portal_route'];
  check('catalog',JSON.stringify(module.listWorkRoutines().map(r=>r.id))===JSON.stringify(ids));
  check('tool-routine-schema',MINECRAFT_TOOL_DECLS.find(t=>t.name==='mc_script')?.parameters.properties.routine
    && MINECRAFT_TOOL_DECLS.find(t=>t.name==='mc_script').description.includes('routine'));
  const manifest=JSON.parse(await readFile(resolve(root,'dist/build.json'),'utf8'));
  for (const file of ['core/work-routines.ts','core/movement-routines.ts','core/swim-route.ts','core/status-effects.ts','core/skills-interact.ts','core/method-worker.mjs','core/skills-control.ts','core/skills-harvest.ts','core/skills-gather.ts','core/skills.ts',
    'core/executor.ts','core/world.ts','core/flight.ts','core/method-runner.ts','core/method-mineflayer.ts','core/precheck.ts','core/receipt.ts','core/method-api.ts','src/extension.ts']) {
    const digest=createHash('sha256').update(await readFile(resolve(root,file))).digest('hex');
    check(`source:${file}`,manifest.sourceFiles.some(row=>row.file===file&&row.sha256===digest));
  }
  for (const id of ids) {
    const params = id==='farm_harvest'?{dimension:'overworld',crop:'wheat',cells:[[1,64,0]]}
      :id==='gather_logs'?{dimension:'overworld',block:'oak_log',cells:[[1,64,0]]}
      :id==='navigate_route'||id==='flight_route'?{dimension:'overworld',waypoints:[[1,64,0]]}
      :id==='swim_to'||id==='swim_route'?{dimension:'overworld',at:[1,64,0]}
      :id==='ride_route'?{dimension:'overworld',target:'boat',entityId:9,waypoints:[[1,64,0]]}
      :id==='portal_route'?{dimension:'overworld',portals:[{at:[1,64,0],fromDimension:'overworld',toDimension:'the_nether'}]}
      :{dimension:'overworld',chest:[1,64,0],items:[{item:'dirt',count:1}]};
    const result=await new Promise(resolveRun=>{
      const runner=new MethodRunner({onFinish:resolveRun,call:()=>{throw Error('Read-only smoke attempted a World action');}});
      runner.start({...module.prepareWorkRoutine(id,params),validate:true});
    });
    check(`syntax:${id}`,result.status==='validated'&&result.trace.length===0&&result.routine?.id===id);
  }
  try {module.prepareWorkRoutine('restock',{chest:[0,64,0],items:[{item:'dirt',count:1}]});check('bad-params-rejected',false);}
  catch {check('bad-params-rejected',true);}
} catch(error) { report.error=String(error); }
report.ok=!report.error&&Object.values(report.checks).every(Boolean)&&Object.keys(report.checks).length>=35;
console.log(JSON.stringify(report));
if(!report.ok)process.exitCode=1;
