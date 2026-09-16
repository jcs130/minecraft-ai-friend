// QiandengJi's control service: the generic fleet core bound to this project's
// topology. The compose entrypoint and every existing importer keep this path.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  createControlServer as createCore,
  inventory as coreInventory,
  buildPlan as coreBuildPlan,
  dockerRequest, redactLog,
} from './fleet/control-core.mjs';
import { QIANDENGJI, SERVICES } from './topology.qiandengji.mjs';
import { createEngineeringRunner } from './engineering-runner.mjs';

export { SERVICES, dockerRequest, redactLog };
export const inventory=(engine=dockerRequest)=>coreInventory(engine,QIANDENGJI);
export const buildPlan=(input,rows)=>coreBuildPlan(input,rows,QIANDENGJI);
export const createControlServer=(options={})=>createCore({...options,topology:QIANDENGJI});

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const tokenFile=process.env.QIANDENG_CONTROL_TOKEN_FILE||'/run/secrets/control-token';
  const token=(await fs.readFile(tokenFile,'utf8')).trim();
  createControlServer({token,
    stateDir:process.env.QIANDENG_CONTROL_STATE_DIR||'/control-state',
    maintenanceDir:process.env.QIANDENG_CONTROL_MAINTENANCE_DIR||'/maintenance',
  }).listen(Number(process.env.QIANDENG_CONTROL_PORT||3090),'0.0.0.0');
  // Optional fixed test queue uses this already supervised control process.
  // No model-supplied Docker options or production mounts reach the runner.
  if(process.env.QIANDENG_ENGINEERING_ENABLED==='1'){
    const runner=createEngineeringRunner({engine:dockerRequest,redact:redactLog});
    runner.start();
    process.once('SIGTERM',()=>runner.stop());
  }
}
